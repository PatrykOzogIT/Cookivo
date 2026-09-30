import { Global, Module } from '@nestjs/common';
import { HouseholdModule } from '../household/household.module.js';
import { PhotosModule } from '../photos/photos.module.js';
import { RecipeCalculatorService } from './recipe-calculator.service.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService } from './recipes.service.js';

/** Global - kalkulator przepisów jest potrzebny też w module składników (przeliczenie po zmianie składnika). */
@Global()
@Module({
  imports: [PhotosModule, HouseholdModule],
  controllers: [RecipesController],
  providers: [RecipesService, RecipeCalculatorService],
  exports: [RecipeCalculatorService],
})
export class RecipesModule {}
