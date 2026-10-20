import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import {
  CreateIngredientRequestDto,
  IngredientRequestsQueryDto,
  ResolveIngredientRequestDto,
} from './ingredient-requests.dto.js';
import { IngredientRequestsService } from './ingredient-requests.service.js';

@Controller()
export class IngredientRequestsController {
  constructor(private readonly requests: IngredientRequestsService) {}

  /** "Zgłoś brakujący produkt" (np. z importu paragonu) */
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ingredient-requests')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIngredientRequestDto) {
    return this.requests.create(user, dto);
  }

  @Roles('ADMIN')
  @Get('admin/ingredient-requests')
  list(@Query() q: IngredientRequestsQueryDto) {
    return this.requests.list(q.status ?? 'OPEN');
  }

  /** Składnik dodany (albo istniał) - zamyka prośbę i zapamiętuje powiązanie z paragonem */
  @Roles('ADMIN')
  @Post('admin/ingredient-requests/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveIngredientRequestDto) {
    return this.requests.resolve(id, dto.ingredientId);
  }

  @Roles('ADMIN')
  @Post('admin/ingredient-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.reject(id);
  }
}
