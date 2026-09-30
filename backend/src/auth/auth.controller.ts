import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators.js';
import type { Env } from '../config/env.js';
import { EmailDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto, UsernameQueryDto } from './auth.dto.js';
import { AuthService, type AuthResult, type RequestMeta } from './auth.service.js';

export const REFRESH_COOKIE = 'cookivo_rt';
/** Wrażliwe endpointy: 5 prób na minutę z jednego IP. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Get('username-available')
  usernameAvailable(@Query() query: UsernameQueryDto) {
    return this.auth.usernameAvailable(query.username);
  }

  @Public()
  @Throttle(STRICT)
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    await this.auth.register(dto, meta(req));
    // Ta sama odpowiedź niezależnie od tego, czy mail był już zajęty.
    return { status: 'CHECK_EMAIL' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.login(dto, meta(req)));
  }

  @Public()
  // Luźniej: token ma 256 bitów, a wiele osób za jednym NAT-em odświeża sesje
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.withCookie(res, await this.auth.refresh(readCookie(req), meta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Public()
  @Throttle(STRICT)
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Body() dto: EmailDto) {
    await this.auth.resendVerification(dto.email);
    return { status: 'CHECK_EMAIL' };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto.email);
    return { status: 'CHECK_EMAIL' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Throttle(STRICT)
  @Post('confirm-email-change')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmEmailChange(@Body() dto: TokenDto) {
    return this.auth.confirmEmailChange(dto.token);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  // ---------------------------------------------------------------------------

  private withCookie(res: Response, result: AuthResult) {
    const { refreshToken, refreshExpiresAt, ...body } = result;
    res.cookie(REFRESH_COOKIE, refreshToken, { ...this.cookieOptions(), expires: refreshExpiresAt });
    return body;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict',
      path: '/api/auth',
    };
  }
}

function readCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
