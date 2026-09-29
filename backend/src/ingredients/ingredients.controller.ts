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
import { CurrentUser, Public, Roles, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import { ListIngredientsQuery, RejectIngredientDto, SaveIngredientDto } from './ingredients.dto.js';
import { IngredientsService } from './ingredients.service.js';

@Controller()
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  /** Słowniki: alergeny, kategorie, jednostki (dla formularzy i filtrów) */
  @Public()
  @Get('dictionaries')
  dictionaries() {
    return this.ingredients.dictionaries();
  }

  @Public()
  @Get('ingredients')
  list(@Query() query: ListIngredientsQuery, @CurrentUser() user?: AuthUser) {
    return this.ingredients.list(query, user);
  }

  @Public()
  @Get('ingredients/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.ingredients.get(id, user);
  }

  @RequireVerifiedEmail()
  @Post('ingredients')
  create(@Body() dto: SaveIngredientDto, @CurrentUser() user: AuthUser) {
    return this.ingredients.create(dto, user);
  }

  @RequireVerifiedEmail()
  @Patch('ingredients/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveIngredientDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ingredients.update(id, dto, user);
  }

  @Delete('ingredients/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.ingredients.remove(id, user);
  }

  @Roles('ADMIN')
  @Post('ingredients/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.ingredients.review(id, 'APPROVED', user);
  }

  @Roles('ADMIN')
  @Post('ingredients/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectIngredientDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ingredients.review(id, 'REJECTED', user, dto.reason);
  }
}
