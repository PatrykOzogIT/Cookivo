import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { PantryModule } from '../pantry/pantry.module.js';
import { PricesModule } from '../prices/prices.module.js';
import { ReceiptExtractor } from './receipt-extractor.js';
import { ReceiptImportController } from './receipt-import.controller.js';
import { ReceiptImportService } from './receipt-import.service.js';

/** RecipeCalculatorService pochodzi z globalnego RecipesModule */
@Module({
  imports: [AiModule, IngredientsModule, PantryModule, PricesModule],
  controllers: [ReceiptImportController],
  providers: [ReceiptImportService, ReceiptExtractor],
})
export class ReceiptImportModule {}
