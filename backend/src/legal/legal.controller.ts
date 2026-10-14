import { Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { LegalService } from './legal.service.js';

@Controller('me/legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /** Oczekujące nowe wersje dokumentów + historia zgód */
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.legal.status(user.id);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.legal.accept(user.id, req.ip);
  }
}
