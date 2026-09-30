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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators.js';
import { CreateInviteDto, HouseholdNameDto, InviteTokenDto, ShareAllergiesDto } from './household.dto.js';
import { HouseholdService } from './household.service.js';

@Controller('household')
export class HouseholdController {
  constructor(private readonly household: HouseholdService) {}

  /** Moje gospodarstwo albo null */
  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    return { household: await this.household.mine(user.id) };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: HouseholdNameDto) {
    return this.household.create(user.id, dto.name);
  }

  @Patch()
  rename(@CurrentUser() user: AuthUser, @Body() dto: HouseholdNameDto) {
    return this.household.rename(user.id, dto.name);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invites')
  invite(@CurrentUser() user: AuthUser, @Body() dto: CreateInviteDto) {
    return this.household.invite(user.id, dto.email);
  }

  @Delete('invites/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvite(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.household.revokeInvite(user.id, id);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('invites/preview')
  preview(@Query() dto: InviteTokenDto) {
    return this.household.preview(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('join')
  join(@CurrentUser() user: AuthUser, @Body() dto: InviteTokenDto) {
    return this.household.join(user.id, dto.token);
  }

  @Post('leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: AuthUser) {
    return this.household.leave(user.id);
  }

  @Delete('members/:userId')
  removeMember(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) memberId: string) {
    return this.household.removeMember(user.id, memberId);
  }

  @Post('members/:userId/owner')
  transfer(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) memberId: string) {
    return this.household.transferOwnership(user.id, memberId);
  }

  @Put('share-allergies')
  share(@CurrentUser() user: AuthUser, @Body() dto: ShareAllergiesDto, @Req() req: Request) {
    return this.household.setShareAllergies(user.id, dto.share, req.ip);
  }
}
