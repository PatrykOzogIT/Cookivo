import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { LabelExtractor } from './label-extractor.js';
import { LabelImportController } from './label-import.controller.js';
import { LabelImportService } from './label-import.service.js';

@Module({
  imports: [AiModule, IngredientsModule],
  controllers: [LabelImportController],
  providers: [LabelImportService, LabelExtractor],
})
export class LabelImportModule {}
