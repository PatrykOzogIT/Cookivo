import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ageOn, calculateTargets, MAX_AGE, MIN_AGE } from './nutrition-calculator.js';
import type { SaveProfileDto, SetAllergensDto } from './profile.dto.js';

export const HEALTH_CONSENT_VERSION = '2026-09-30';

type Level = 'NEVER' | 'SOMETIMES' | 'LIKE' | 'LOVE';

/**
 * Profil żywieniowy, alergie i preferencje zalogowanego użytkownika.
 * Profil i alergie to dane o zdrowiu (art. 9 RODO) - wymagają aktywnej zgody HEALTH_DATA.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async hasHealthConsent(userId: string): Promise<boolean> {
    const latest = await this.prisma.consent.findFirst({
      where: { userId, type: 'HEALTH_DATA' },
      orderBy: { grantedAt: 'desc' },
    });
    return !!latest && !latest.revokedAt;
  }

  async get(userId: string) {
    const [profile, consent, allergens] = await Promise.all([
      this.prisma.nutritionProfile.findUnique({ where: { userId } }),
      this.hasHealthConsent(userId),
      this.prisma.userAllergen.findMany({
        where: { userId },
        include: { allergen: true },
        orderBy: { allergen: { sortOrder: 'asc' } },
      }),
    ]);
    return {
      healthConsent: consent,
      profile: profile
        ? {
            sex: profile.sex,
            birthDate: profile.birthDate.toISOString().slice(0, 10),
            heightCm: profile.heightCm,
            weightKg: profile.weightKg,
            activity: profile.activity,
            goal: profile.goal,
            customKcal: profile.customKcal,
            customProtein: profile.customProtein,
            customFat: profile.customFat,
            customCarbs: profile.customCarbs,
          }
        : null,
      targets: profile
        ? calculateTargets({
            sex: profile.sex,
            age: ageOn(profile.birthDate),
            heightCm: profile.heightCm,
            weightKg: profile.weightKg,
            activity: profile.activity,
            goal: profile.goal,
            customKcal: profile.customKcal,
            customProtein: profile.customProtein,
            customFat: profile.customFat,
            customCarbs: profile.customCarbs,
          })
        : null,
      allergens: allergens.map((a) => ({ code: a.allergen.code, severity: a.severity })),
    };
  }

  async save(userId: string, dto: SaveProfileDto) {
    await this.requireConsent(userId);
    const birthDate = new Date(`${dto.birthDate}T00:00:00Z`);
    const age = ageOn(birthDate);
    // Wzór Mifflina-St Jeora jest dla dorosłych - dzieci i młodzież potrzebują porady specjalisty
    if (Number.isNaN(age) || age < MIN_AGE || age > MAX_AGE)
      throw new BadRequestException({ code: 'AGE_OUT_OF_RANGE' });

    const data = {
      sex: dto.sex,
      birthDate,
      heightCm: dto.heightCm,
      weightKg: dto.weightKg,
      activity: dto.activity,
      goal: dto.goal,
      customKcal: dto.customKcal ?? null,
      customProtein: dto.customProtein ?? null,
      customFat: dto.customFat ?? null,
      customCarbs: dto.customCarbs ?? null,
    };
    await this.prisma.nutritionProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.get(userId);
  }

  async deleteProfile(userId: string): Promise<void> {
    await this.prisma.nutritionProfile.deleteMany({ where: { userId } });
  }

  /** Udzielenie albo wycofanie zgody. Wycofanie usuwa profil i alergie (dane o zdrowiu). */
  async setHealthConsent(userId: string, granted: boolean, ip?: string) {
    const active = await this.hasHealthConsent(userId);
    if (granted && !active) {
      await this.prisma.consent.create({
        data: { userId, type: 'HEALTH_DATA', version: HEALTH_CONSENT_VERSION, ip },
      });
    }
    if (!granted && active) {
      await this.prisma.$transaction([
        this.prisma.consent.updateMany({
          where: { userId, type: 'HEALTH_DATA', revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.nutritionProfile.deleteMany({ where: { userId } }),
        this.prisma.userAllergen.deleteMany({ where: { userId } }),
        // Bez zgody na dane o zdrowiu nie ma też czego udostępniać domownikom
        this.prisma.householdMember.updateMany({ where: { userId }, data: { shareAllergies: false } }),
        this.prisma.consent.updateMany({
          where: { userId, type: 'HOUSEHOLD_ALLERGIES', revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    }
    return this.get(userId);
  }

  async setAllergens(userId: string, dto: SetAllergensDto) {
    await this.requireConsent(userId);
    const codes = dto.allergens.map((a) => a.code);
    if (new Set(codes).size !== codes.length) throw new BadRequestException({ code: 'ALLERGEN_UNKNOWN' });
    const found = await this.prisma.allergen.findMany({ where: { code: { in: codes } } });
    if (found.length !== codes.length) throw new BadRequestException({ code: 'ALLERGEN_UNKNOWN' });
    const idByCode = new Map(found.map((a) => [a.code, a.id]));

    await this.prisma.$transaction([
      this.prisma.userAllergen.deleteMany({ where: { userId } }),
      this.prisma.userAllergen.createMany({
        data: dto.allergens.map((a) => ({ userId, allergenId: idByCode.get(a.code)!, severity: a.severity })),
      }),
    ]);
    return this.get(userId);
  }

  // --- Preferencje (nie są danymi o zdrowiu - nie wymagają zgody) ----------------------

  async preferences(userId: string) {
    const [ingredients, categories] = await Promise.all([
      this.prisma.ingredientPreference.findMany({
        where: { userId },
        include: {
          ingredient: {
            select: { id: true, namePl: true, nameEn: true, category: { select: { icon: true } } },
          },
        },
        orderBy: { ingredient: { namePl: 'asc' } },
      }),
      this.prisma.categoryPreference.findMany({ where: { userId }, include: { category: true } }),
    ]);
    return {
      ingredients: ingredients.map((p) => ({
        id: p.ingredient.id,
        namePl: p.ingredient.namePl,
        nameEn: p.ingredient.nameEn,
        icon: p.ingredient.category.icon,
        level: p.level,
      })),
      categories: categories.map((p) => ({ code: p.category.code, level: p.level })),
    };
  }

  async setIngredientPreference(userId: string, ingredientId: string, level: Level | null) {
    const ingredient = await this.prisma.ingredient.findUnique({ where: { id: ingredientId } });
    if (!ingredient || (ingredient.status !== 'APPROVED' && ingredient.createdById !== userId)) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    if (level) {
      await this.prisma.ingredientPreference.upsert({
        where: { userId_ingredientId: { userId, ingredientId } },
        create: { userId, ingredientId, level },
        update: { level },
      });
    } else {
      await this.prisma.ingredientPreference.deleteMany({ where: { userId, ingredientId } });
    }
    return this.preferences(userId);
  }

  async setCategoryPreference(userId: string, code: string, level: Level | null) {
    const category = await this.prisma.ingredientCategory.findUnique({ where: { code } });
    if (!category) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (level) {
      await this.prisma.categoryPreference.upsert({
        where: { userId_categoryId: { userId, categoryId: category.id } },
        create: { userId, categoryId: category.id, level },
        update: { level },
      });
    } else {
      await this.prisma.categoryPreference.deleteMany({ where: { userId, categoryId: category.id } });
    }
    return this.preferences(userId);
  }

  private async requireConsent(userId: string): Promise<void> {
    if (!(await this.hasHealthConsent(userId)))
      throw new ForbiddenException({ code: 'HEALTH_CONSENT_REQUIRED' });
  }
}
