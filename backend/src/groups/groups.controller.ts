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
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators.js';
import { GroupInviteDto, GroupTokenDto, SaveGroupDto } from './groups.dto.js';
import { GroupsService } from './groups.service.js';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.groups.mine(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveGroupDto) {
    return this.groups.create(user.id, dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('invites/preview')
  preview(@Query() dto: GroupTokenDto) {
    return this.groups.preview(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('join')
  join(@CurrentUser() user: AuthUser, @Body() dto: GroupTokenDto) {
    return this.groups.join(user.id, dto.token);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveGroupDto) {
    return this.groups.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.remove(user.id, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/invites')
  invite(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupInviteDto) {
    return this.groups.invite(user.id, id, dto.email);
  }

  @Delete(':id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.groups.revokeInvite(user.id, id, inviteId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.leave(user.id, id);
  }

  @Post(':id/members/:userId/approve')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ) {
    return this.groups.approve(user.id, id, memberId);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ) {
    return this.groups.removeMember(user.id, id, memberId);
  }

  @Post(':id/members/:userId/owner')
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ) {
    return this.groups.transferOwnership(user.id, id, memberId);
  }
}
