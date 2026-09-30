import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { HealthConsentDto, SaveProfileDto, SetAllergensDto, SetPreferenceDto } from './profile.dto.js';
import { ProfileService } from './profile.service.js';

/** Wszystko pod /api/me dotyczy zalogowanego użytkownika (globalny guard wymaga logowania). */
@Controller('me')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('profile')
  get(@CurrentUser() user: AuthUser) {
    return this.profile.get(user.id);
  }

  @Put('profile')
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveProfileDto) {
    return this.profile.save(user.id, dto);
  }

  @Delete('profile')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser) {
    return this.profile.deleteProfile(user.id);
  }

  @Post('consents/health-data')
  @HttpCode(HttpStatus.OK)
  consent(@CurrentUser() user: AuthUser, @Body() dto: HealthConsentDto, @Req() req: Request) {
    return this.profile.setHealthConsent(user.id, dto.granted, req.ip);
  }

  @Put('allergens')
  allergens(@CurrentUser() user: AuthUser, @Body() dto: SetAllergensDto) {
    return this.profile.setAllergens(user.id, dto);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.profile.preferences(user.id);
  }

  @Put('preferences/ingredients/:id')
  ingredientPreference(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPreferenceDto,
  ) {
    return this.profile.setIngredientPreference(user.id, id, dto.level ?? null);
  }

  @Put('preferences/categories/:code')
  categoryPreference(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: SetPreferenceDto,
  ) {
    return this.profile.setCategoryPreference(user.id, code, dto.level ?? null);
  }
}
