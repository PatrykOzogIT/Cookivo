import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { UnitEstimatesController } from './unit-estimates.controller.js';
import { UnitEstimatesService } from './unit-estimates.service.js';
import { UnitEstimator } from './unit-estimator.js';

@Module({
  imports: [AiModule, RecipesModule],
  controllers: [UnitEstimatesController],
  providers: [UnitEstimatesService, UnitEstimator],
})
export class UnitEstimatesModule {}
