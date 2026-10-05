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
import { HideRecipeDto, ListRecipesQuery, SaveRecipeDto } from './recipes.dto.js';
import { RecipesService } from './recipes.service.js';

@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Public()
  @Get()
  list(@Query() query: ListRecipesQuery, @CurrentUser() user?: AuthUser) {
    return this.recipes.list(query, user);
  }

  @Public()
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.recipes.get(id, user);
  }

  @RequireVerifiedEmail()
  @Post()
  create(@Body() dto: SaveRecipeDto, @CurrentUser() user: AuthUser) {
    return this.recipes.create(dto, user);
  }

  @RequireVerifiedEmail()
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveRecipeDto, @CurrentUser() user: AuthUser) {
    return this.recipes.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recipes.remove(id, user);
  }

  /** "Zrób własną wersję" - prywatna kopia jako wariant oryginału */
  @RequireVerifiedEmail()
  @Post(':id/variant')
  createVariant(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recipes.createVariant(id, user);
  }

  @Public()
  @Get(':id/variants')
  variants(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.recipes.variants(id, user);
  }

  /** Admin ukrywa przepis (np. nieodpowiednia treść) - widzi go dalej autor z podanym powodem */
  @Roles('ADMIN')
  @Post(':id/hide')
  @HttpCode(HttpStatus.OK)
  hide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HideRecipeDto, @CurrentUser() user: AuthUser) {
    return this.recipes.setHidden(id, user, dto.reason);
  }

  @Roles('ADMIN')
  @Post(':id/unhide')
  @HttpCode(HttpStatus.OK)
  unhide(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recipes.setHidden(id, user, null);
  }
}
