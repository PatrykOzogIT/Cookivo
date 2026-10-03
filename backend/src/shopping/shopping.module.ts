import { Module } from '@nestjs/common';
import { PantryModule } from '../pantry/pantry.module.js';
import { PricesModule } from '../prices/prices.module.js';
import { ShoppingController } from './shopping.controller.js';
import { ShoppingService } from './shopping.service.js';

/** RecipesService i RecipeCalculatorService pochodzą z globalnego RecipesModule */
@Module({
  imports: [PantryModule, PricesModule],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
