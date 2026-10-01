import { Module } from '@nestjs/common';
import { PantryModule } from '../pantry/pantry.module.js';
import { ShoppingController } from './shopping.controller.js';
import { ShoppingService } from './shopping.service.js';

/** RecipesService i RecipeCalculatorService pochodzą z globalnego RecipesModule */
@Module({
  imports: [PantryModule],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
