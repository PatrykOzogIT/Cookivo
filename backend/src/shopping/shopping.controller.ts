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
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { AddItemDto, ClearDto, FromPlanDto, FromRecipeDto, UpdateItemDto } from './shopping.dto.js';
import { ShoppingService } from './shopping.service.js';

@Controller('shopping')
export class ShoppingController {
  constructor(private readonly shopping: ShoppingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.shopping.list(user.id);
  }

  @Post('from-plan')
  fromPlan(@CurrentUser() user: AuthUser, @Body() dto: FromPlanDto) {
    return this.shopping.addFromPlan(user.id, dto.from, dto.to);
  }

  @Post('from-recipe')
  fromRecipe(@CurrentUser() user: AuthUser, @Body() dto: FromRecipeDto) {
    return this.shopping.addFromRecipe(user, dto.recipeId, dto.servings);
  }

  @Post('items')
  add(@CurrentUser() user: AuthUser, @Body() dto: AddItemDto) {
    return this.shopping.addItem(user, dto);
  }

  @Patch('items/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.shopping.update(user.id, id, dto);
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shopping.remove(user.id, id);
  }

  @Post('clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@CurrentUser() user: AuthUser, @Body() dto: ClearDto) {
    return this.shopping.clear(user.id, dto.checkedOnly);
  }

  @Post('to-pantry')
  toPantry(@CurrentUser() user: AuthUser) {
    return this.shopping.toPantry(user.id);
  }
}
