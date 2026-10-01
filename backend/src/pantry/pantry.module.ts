import { Module } from '@nestjs/common';
import { PantryController } from './pantry.controller.js';
import { PantryService } from './pantry.service.js';

/** RecipeCalculatorService pochodzi z globalnego RecipesModule */
@Module({
  controllers: [PantryController],
  providers: [PantryService],
  exports: [PantryService],
})
export class PantryModule {}
