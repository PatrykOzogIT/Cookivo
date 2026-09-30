import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { REFRESH_COOKIE } from '../auth/auth.controller.js';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { ChangeEmailDto, ChangePasswordDto, DeleteAccountDto, UpdateSettingsDto } from './account.dto.js';
import { AccountService } from './account.service.js';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Patch('settings')
  settings(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.account.updateSettings(user.id, dto.locale);
  }

  @Throttle(STRICT)
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  password(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(user.id, dto.currentPassword, dto.newPassword, user.sessionId);
  }

  @Throttle(STRICT)
  @Post('email')
  @HttpCode(HttpStatus.ACCEPTED)
  async email(@CurrentUser() user: AuthUser, @Body() dto: ChangeEmailDto) {
    await this.account.requestEmailChange(user.id, dto.newEmail, dto.password);
    return { status: 'CHECK_EMAIL' };
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.account.sessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.revokeSession(user.id, id);
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.account.revokeOtherSessions(user.id, user.sessionId);
  }

  /** Pobranie wszystkich danych (RODO) jako plik JSON */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="cookivo-dane-${date}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return this.account.export(user.id);
  }

  @Throttle(STRICT)
  @Post('delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.account.deleteAccount(user.id, dto.password);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}
