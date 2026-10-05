import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller.js';
import { RatingsService } from './ratings.service.js';

/** RecipesService pochodzi z globalnego RecipesModule */
@Module({
  controllers: [RatingsController],
  providers: [RatingsService],
})
export class RatingsModule {}
