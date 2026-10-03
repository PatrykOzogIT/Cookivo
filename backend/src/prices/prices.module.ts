import { Module } from '@nestjs/common';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

/** RecipesService i RecipeCalculatorService pochodzą z globalnego RecipesModule */
@Module({
  controllers: [PricesController],
  providers: [PricesService],
  exports: [PricesService],
})
export class PricesModule {}
