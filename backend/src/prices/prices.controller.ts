import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { PriceEntryDto, PriceListDto, RecipeCostQueryDto, UpdatePriceListDto } from './prices.dto.js';
import { PricesService } from './prices.service.js';

@Controller()
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('prices')
  lists(@CurrentUser() user: AuthUser) {
    return this.prices.lists(user.id);
  }

  @Post('prices')
  create(@CurrentUser() user: AuthUser, @Body() dto: PriceListDto) {
    return this.prices.create(user.id, dto);
  }

  @Patch('prices/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceListDto,
  ) {
    return this.prices.update(user.id, id, dto);
  }

  @Delete('prices/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prices.remove(user.id, id);
  }

  @Get('prices/:id/entries')
  entries(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prices.entries(user.id, id);
  }

  @Put('prices/:id/entries')
  setEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PriceEntryDto,
  ) {
    return this.prices.setEntry(user, id, dto);
  }

  @Delete('prices/:id/entries/:entryId')
  removeEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.prices.removeEntry(user.id, id, entryId);
  }

  /** Szacowany koszt przepisu wg domyślnego cennika */
  @Get('recipes/:id/cost')
  recipeCost(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: RecipeCostQueryDto,
  ) {
    return this.prices.recipeCost(user, id, q.servings);
  }
}
