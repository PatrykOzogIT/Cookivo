import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.decorators.js';
import { UnitEstimatesService } from './unit-estimates.service.js';

class UnitGramsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  grams?: number;
}

class SetUnitDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  grams!: number;
}

class EstimatesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;
}

@Controller()
export class UnitEstimatesController {
  constructor(private readonly units: UnitEstimatesService) {}

  /** Waga miary kuchennej składnika: znana, szacunek AI (zapisany dla wszystkich) albo pytanie do autora */
  @Post('ingredients/:id/units/:code/estimate')
  @HttpCode(HttpStatus.OK)
  estimate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.units.estimate(id, code, user);
  }

  @Roles('ADMIN')
  @Get('admin/units/suggestions')
  suggestions() {
    return this.units.suggestions();
  }

  @Roles('ADMIN')
  @Get('admin/units/estimates')
  estimates(@Query() q: EstimatesQuery) {
    return this.units.estimates(q.q, q.page);
  }

  @Roles('ADMIN')
  @Post('admin/units/suggestions/:id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitGramsDto) {
    return this.units.approve(id, dto.grams);
  }

  @Roles('ADMIN')
  @Post('admin/units/suggestions/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.units.reject(id);
  }

  /** Admin potwierdza albo poprawia wagę miary (np. szacunek AI) */
  @Roles('ADMIN')
  @Put('admin/units/:ingredientId/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  set(
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
    @Param('code') code: string,
    @Body() dto: SetUnitDto,
  ) {
    return this.units.setUnit(ingredientId, code, dto.grams);
  }
}
