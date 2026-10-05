import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.decorators.js';
import { BlockDto, RoleDto, UsersQueryDto } from './admin-users.dto.js';
import { AdminUsersService } from './admin-users.service.js';

@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() q: UsersQueryDto) {
    return this.users.list(q);
  }

  @Post(':id/block')
  block(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockDto) {
    return this.users.block(actor, id, dto);
  }

  @Delete(':id/block')
  unblock(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.unblock(actor, id);
  }

  @Roles('SUPER_ADMIN')
  @Patch(':id/role')
  setRole(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    return this.users.setRole(actor, id, dto.role);
  }
}
