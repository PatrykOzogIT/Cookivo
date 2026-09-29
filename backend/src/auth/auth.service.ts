import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import type { EmailTokenType, Locale } from '../generated/prisma/enums.js';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../legal/legal.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { generateToken, hashToken } from './tokens.js';
import { checkUsername, normalizeUsername } from './username-policy.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/** Parametry argon2id wg rekomendacji OWASP. */
const ARGON_OPTIONS = {
  type: argon2.argon2id as 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: User['role'];
  locale: Locale;
  emailVerified: boolean;
  createdAt: Date;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: PublicUser;
  /** Trafia do ciasteczka httpOnly, nigdy do body odpowiedzi. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    locale: user.locale,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  /** Hash do porównań, gdy user nie istnieje - wyrównuje czas odpowiedzi. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async usernameAvailable(username: string): Promise<{ available: boolean; reason?: string }> {
    const problem = checkUsername(username);
    if (problem) return { available: false, reason: problem };
    const taken = await this.prisma.user.findUnique({
      where: { usernameNormalized: normalizeUsername(username) },
      select: { id: true },
    });
    return taken ? { available: false, reason: 'USERNAME_TAKEN' } : { available: true };
  }

  async register(dto: RegisterDto, meta: RequestMeta): Promise<void> {
    const usernameProblem = checkUsername(dto.username);
    if (usernameProblem) throw new BadRequestException({ code: usernameProblem });

    const passwordProblem = await this.passwordPolicy.check(dto.password, [
      dto.username,
      dto.email,
      dto.email.split('@')[0],
    ]);
    if (passwordProblem) throw new BadRequestException({ code: passwordProblem });

    // Hashujemy zawsze, także gdy mail jest zajęty - żeby czas odpowiedzi nie zdradzał, czy konto istnieje.
    const passwordHash = await argon2.hash(dto.password, ARGON_OPTIONS);
    const locale = dto.locale ?? 'pl';
    const usernameNormalized = normalizeUsername(dto.username);

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      await this.mail.send(existing.email, 'accountExists', existing.locale, {
        username: existing.username,
        url: `${this.appUrl}/auth/forgot-password`,
      });
      return;
    }

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          username: dto.username.trim(),
          usernameNormalized,
          email: dto.email,
          passwordHash,
          locale,
          consents: {
            create: [
              { type: 'TERMS', version: TERMS_VERSION, ip: meta.ip },
              { type: 'PRIVACY_POLICY', version: PRIVACY_POLICY_VERSION, ip: meta.ip },
            ],
          },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta ?? {});
        if (target.includes('username')) throw new ConflictException({ code: 'USERNAME_TAKEN' });
        return; // wyścig na tym samym mailu - odpowiadamy jak przy sukcesie
      }
      throw err;
    }

    await this.sendVerificationMail(user);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const login = dto.login.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: login.includes('@') ? { email: login } : { usernameNormalized: login },
    });

    if (!user) {
      await argon2.verify(await this.getDummyHash(), dto.password).catch(() => false);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    // Zablokowane konto odpowiada tak samo jak złe hasło - nie zdradzamy, że istnieje.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    const valid = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLoginCount: failed },
      });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    const data: Prisma.UserUpdateInput = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    };
    if (argon2.needsRehash(user.passwordHash, ARGON_OPTIONS)) {
      data.passwordHash = await argon2.hash(dto.password, ARGON_OPTIONS);
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data });

    return this.startSession(updated, meta);
  }

  /** Rotacja refresh tokenu z wykrywaniem ponownego użycia. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    if (!refreshToken) throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    const hash = hashToken(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!session) {
      // Token już raz zrotowany = ktoś ma kopię. Unieważniamy całą sesję.
      await this.prisma.session.updateMany({
        where: { previousHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    }
    if (session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    }

    const newToken = generateToken();
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        tokenHash: hashToken(newToken),
        previousHash: hash,
        lastUsedAt: new Date(),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 512),
      },
    });

    return this.buildResult(session.user, newToken, session.expiresAt);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) await this.sendVerificationMail(user);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.createEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
    await this.mail.send(user.email, 'resetPassword', user.locale, {
      username: user.username,
      url: `${this.appUrl}/auth/reset-password?token=${token}`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.findValidEmailToken(token, 'RESET_PASSWORD');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });

    const problem = await this.passwordPolicy.check(password, [user.username, user.email]);
    if (problem) throw new BadRequestException({ code: problem });

    const passwordHash = await argon2.hash(password, ARGON_OPTIONS);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          // Link z maila potwierdza też własność adresu.
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      }),
      // Zmiana hasła wylogowuje wszystkie urządzenia.
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    return toPublicUser(user);
  }

  // ---------------------------------------------------------------------------

  private get appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  private async startSession(user: User, meta: RequestMeta): Promise<AuthResult> {
    const refreshToken = generateToken();
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 512),
      },
    });
    return this.buildResult(user, refreshToken, expiresAt);
  }

  private async buildResult(user: User, refreshToken: string, refreshExpiresAt: Date): Promise<AuthResult> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, ev: user.emailVerifiedAt !== null },
      { expiresIn },
    );
    return { accessToken, expiresIn, user: toPublicUser(user), refreshToken, refreshExpiresAt };
  }

  private async sendVerificationMail(user: User): Promise<void> {
    const token = await this.createEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    await this.mail.send(user.email, 'verifyEmail', user.locale, {
      username: user.username,
      url: `${this.appUrl}/auth/verify-email?token=${token}`,
    });
  }

  /** Nowy token unieważnia poprzednie tego samego typu. */
  private async createEmailToken(userId: string, type: EmailTokenType, ttlMs: number): Promise<string> {
    const token = generateToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.emailToken.create({
        data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + ttlMs) },
      }),
    ]);
    return token;
  }

  private async findValidEmailToken(token: string, type: EmailTokenType) {
    const record = await this.prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'TOKEN_INVALID' });
    }
    return record;
  }

  private async consumeEmailToken(token: string, type: EmailTokenType) {
    const record = await this.findValidEmailToken(token, type);
    await this.prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return record;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('cookivo-dummy-password', ARGON_OPTIONS);
    return this.dummyHash;
  }
}
