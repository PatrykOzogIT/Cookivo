import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { RecipeExtractor } from './recipe-extractor.js';
import { RecipeImportController } from './recipe-import.controller.js';
import { RecipeImportService } from './recipe-import.service.js';

/** RecipeCalculatorService pochodzi z globalnego RecipesModule */
@Module({
  imports: [AiModule, IngredientsModule],
  controllers: [RecipeImportController],
  providers: [RecipeImportService, RecipeExtractor],
})
export class RecipeImportModule {}
