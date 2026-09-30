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
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import {
  AddMealDto,
  CookWeightDto,
  CopyDto,
  MealEatersDto,
  CustomSlotDto,
  PlannerSettingsDto,
  RangeQueryDto,
  UpdateCookDto,
  UpdateMealDto,
} from './planner.dto.js';
import { PlannerService } from './planner.service.js';

/** Plan należy do gospodarstwa zalogowanego (albo do niego samego) - rozstrzyga serwis. */
@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto) {
    return this.planner.get(user, q.from, q.to);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto) {
    return this.planner.clear(user.id, q.from, q.to);
  }

  @Post('meals')
  addMeal(@CurrentUser() user: AuthUser, @Body() dto: AddMealDto) {
    return this.planner.addMeal(user, dto);
  }

  @Patch('meals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateMeal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMealDto,
  ) {
    return this.planner.updateMeal(user.id, id, dto);
  }

  @Put('meals/:id/eaters')
  @HttpCode(HttpStatus.NO_CONTENT)
  setEaters(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MealEatersDto,
  ) {
    return this.planner.setAbsent(user, id, dto.absent);
  }

  @Put('cooks/:id/weight')
  @HttpCode(HttpStatus.NO_CONTENT)
  setWeight(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CookWeightDto,
  ) {
    return this.planner.setCookWeight(user.id, id, dto.cookedGrams ?? null);
  }

  @Delete('meals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMeal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.planner.deleteMeal(user.id, id);
  }

  @Patch('cooks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateCook(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCookDto,
  ) {
    return this.planner.updateCook(user.id, id, dto.servings);
  }

  @Delete('cooks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCook(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.planner.deleteCook(user.id, id);
  }

  @Post('copy')
  copy(@CurrentUser() user: AuthUser, @Body() dto: CopyDto) {
    return this.planner.copy(user.id, dto);
  }

  @Put('settings')
  settings(@CurrentUser() user: AuthUser, @Body() dto: PlannerSettingsDto) {
    return this.planner.saveSettings(user.id, dto);
  }

  @Post('slots')
  addSlot(@CurrentUser() user: AuthUser, @Body() dto: CustomSlotDto) {
    return this.planner.addSlot(user.id, dto.name);
  }

  @Patch('slots/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  renameSlot(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomSlotDto,
  ) {
    return this.planner.renameSlot(user.id, id, dto.name);
  }

  @Delete('slots/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSlot(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.planner.deleteSlot(user.id, id);
  }
}
