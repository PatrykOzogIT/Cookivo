import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators.js';
import { RateDto, RatingsPageDto } from './ratings.dto.js';
import { RatingsService } from './ratings.service.js';

@Controller('recipes/:id')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Put('rating')
  rate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RateDto) {
    return this.ratings.rate(user, id, dto.stars, dto.comment);
  }

  @Delete('rating')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ratings.remove(user, id);
  }

  @Public()
  @Get('ratings')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: RatingsPageDto, @CurrentUser() user?: AuthUser) {
    return this.ratings.list(id, q.page, user);
  }
}
