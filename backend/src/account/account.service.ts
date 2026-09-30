import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { ARGON_OPTIONS } from '../auth/auth.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordPolicyService } from '../auth/password-policy.service.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { photoUrls, PhotosService } from '../photos/photos.service.js';
import { HouseholdService } from '../household/household.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly mail: MailService,
    private readonly photos: PhotosService,
    private readonly profile: ProfileService,
    private readonly household: HouseholdService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async updateSettings(userId: string, locale: 'pl' | 'en') {
    await this.prisma.user.update({ where: { id: userId }, data: { locale } });
    return this.auth.me(userId);
  }

  /** Zmiana hasła - wymaga starego hasła; wylogowuje inne urządzenia (bieżąca sesja zostaje). */
  async changePassword(
    userId: string,
    current: string,
    next: string,
    currentSessionId?: string,
  ): Promise<void> {
    const user = await this.verifyPassword(userId, current);
    const problem = await this.passwordPolicy.check(next, [user.username, user.email]);
    if (problem) throw new BadRequestException({ code: problem });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(next, ARGON_OPTIONS) },
      }),
      this.prisma.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.mail.send(user.email, 'passwordChanged', user.locale, { username: user.username });
  }

  /**
   * Zmiana adresu: link idzie na NOWY adres, stary dostaje powiadomienie.
   * Zajęty adres - odpowiadamy tak samo (nie zdradzamy istnienia kont).
   */
  async requestEmailChange(userId: string, newEmail: string, password: string): Promise<void> {
    const user = await this.verifyPassword(userId, password);
    if (newEmail === user.email) throw new BadRequestException({ code: 'EMAIL_SAME' });
    const taken = await this.prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
    if (taken) return;

    const token = await this.auth.createEmailToken(userId, 'CHANGE_EMAIL', DAY_MS, newEmail);
    const appUrl = this.config.get('APP_URL', { infer: true });
    await this.mail.send(newEmail, 'changeEmail', user.locale, {
      username: user.username,
      url: `${appUrl}/auth/confirm-email?token=${token}`,
    });
    await this.mail.send(user.email, 'emailChangeRequested', user.locale, { username: user.username });
  }

  // --- Sesje (zalogowane urządzenia) --------------------------------------------------

  async sessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  async revokeOtherSessions(userId: string, currentSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  // --- RODO ---------------------------------------------------------------------------

  /** Art. 15 i 20 RODO - komplet danych użytkownika w formacie JSON. */
  async export(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        consents: { orderBy: { grantedAt: 'asc' } },
        householdMember: { include: { household: { select: { name: true } } } },
        // Osobisty plan (plan gospodarstwa należy do gospodarstwa)
        planMeals: {
          include: { cook: { include: { recipe: { select: { title: true } } } }, customSlot: true },
          orderBy: { date: 'asc' },
        },
        customSlots: true,
        plannerSettings: true,
        sessions: { orderBy: { createdAt: 'asc' } },
        ingredientsCreated: { include: { category: true } },
        recipes: {
          include: {
            mealTypes: true,
            ingredients: {
              include: { ingredient: { select: { namePl: true } }, subRecipe: { select: { title: true } } },
            },
            steps: { orderBy: { position: 'asc' } },
            photos: true,
          },
        },
      },
    });
    const [profile, preferences] = await Promise.all([
      this.profile.get(userId),
      this.profile.preferences(userId),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: {
        username: user.username,
        email: user.email,
        role: user.role,
        locale: user.locale,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      consents: user.consents.map((c) => ({
        type: c.type,
        version: c.version,
        grantedAt: c.grantedAt,
        revokedAt: c.revokedAt,
        ip: c.ip,
      })),
      nutritionProfile: profile.profile,
      targets: profile.targets,
      allergens: profile.allergens,
      preferences,
      planner: {
        settings: user.plannerSettings
          ? {
              hiddenSlots: user.plannerSettings.hiddenSlots,
              exactPortions: user.plannerSettings.exactPortions,
            }
          : null,
        customMeals: user.customSlots.map((s) => s.name),
        meals: user.planMeals.map((m) => ({
          date: m.date.toISOString().slice(0, 10),
          meal: m.slotCode ?? m.customSlot?.name ?? null,
          recipe: m.cook.recipe.title,
          servings: m.servings,
          cookedOn: m.cook.date.toISOString().slice(0, 10),
        })),
      },
      household: user.householdMember
        ? {
            name: user.householdMember.household.name,
            role: user.householdMember.role,
            joinedAt: user.householdMember.joinedAt,
            shareAllergies: user.householdMember.shareAllergies,
          }
        : null,
      sessions: user.sessions.map((s) => ({
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        userAgent: s.userAgent,
        ip: s.ip,
        active: !s.revokedAt && s.expiresAt > new Date(),
      })),
      ingredientsCreated: user.ingredientsCreated.map((i) => ({
        namePl: i.namePl,
        nameEn: i.nameEn,
        category: i.category.code,
        status: i.status,
        kcal: i.kcal,
        protein: i.protein,
        fat: i.fat,
        carbs: i.carbs,
        createdAt: i.createdAt,
      })),
      recipes: user.recipes.map((r) => ({
        title: r.title,
        description: r.description,
        visibility: r.visibility,
        servings: r.servings,
        mealTypes: r.mealTypes.map((m) => m.mealTypeCode),
        ingredients: r.ingredients.map((l) => ({
          name: l.ingredient?.namePl ?? l.subRecipe?.title,
          amount: l.amount,
          unit: l.unitCode,
          note: l.note,
        })),
        steps: r.steps.map((s) => s.text),
        photos: r.photos.map((p) => photoUrls(p.id).large),
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Art. 17 RODO - usunięcie konta. Przepisy publiczne zostają zanonimizowane (bez autora),
   * prywatne i niezatwierdzone składniki są usuwane, reszta danych kaskadowo z kontem.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.verifyPassword(userId, password);

    // Usuwamy prywatne i "dla gospodarstwa" - te drugie zostają (bez autora) tylko,
    // gdy są podprzepisem w przepisach innych osób, żeby nie zepsuć im wyliczeń
    const privateRecipes = await this.prisma.recipe.findMany({
      where: {
        authorId: userId,
        OR: [
          { visibility: 'PRIVATE' },
          {
            visibility: 'HOUSEHOLD',
            usedIn: { none: { recipe: { OR: [{ authorId: null }, { authorId: { not: userId } }] } } },
          },
        ],
      },
      select: { id: true, photos: { select: { id: true } } },
    });
    const privateIds = privateRecipes.map((r) => r.id);
    const photoIds = privateRecipes.flatMap((r) => r.photos.map((p) => p.id));

    const inHousehold = await this.prisma.householdMember.findUnique({ where: { userId } });
    await this.prisma.$transaction(async (tx) => {
      // Gospodarstwo: przekazanie roli właściciela albo zamknięcie, gdy byłem sam
      if (inHousehold) await this.household.leave(userId, tx);
      // Prywatne przepisy mogą używać się nawzajem jako składników - najpierw pozycje, potem przepisy
      await tx.recipeIngredient.deleteMany({ where: { recipeId: { in: privateIds } } });
      await tx.recipe.deleteMany({ where: { id: { in: privateIds } } });
      await tx.recipe.updateMany({ where: { authorId: userId }, data: { authorId: null } });
      await tx.ingredient.deleteMany({
        where: { createdById: userId, status: { not: 'APPROVED' }, usedIn: { none: {} } },
      });
      await tx.user.delete({ where: { id: userId } });
    });
    await this.photos.delete(photoIds);
    await this.mail.send(user.email, 'accountDeleted', user.locale, { username: user.username });
  }

  private async verifyPassword(userId: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw new BadRequestException({ code: 'PASSWORD_INCORRECT' });
    return user;
  }
}
