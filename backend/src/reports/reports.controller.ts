import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.decorators.js';
import { CreateReportDto, QueueQueryDto, ResolveDto } from './reports.dto.js';
import { ReportsService } from './reports.service.js';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('reports')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }

  @Get('reports/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.reports.mine(user.id);
  }

  @Roles('ADMIN')
  @Get('admin/reports')
  queue(@Query() q: QueueQueryDto) {
    return this.reports.queue(q.status);
  }

  @Roles('ADMIN')
  @Post('admin/reports/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentUser() admin: AuthUser, @Body() dto: ResolveDto) {
    return this.reports.resolve(admin, dto);
  }
}
