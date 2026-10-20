import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { PantryModule } from '../pantry/pantry.module.js';
import { PlannerModule } from '../planner/planner.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { RecipeImportModule } from '../recipe-import/recipe-import.module.js';
import { ShoppingModule } from '../shopping/shopping.module.js';
import { AssistantAi } from './assistant-ai.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';

/** RecipesService pochodzi z globalnego RecipesModule */
@Module({
  imports: [AiModule, PantryModule, PlannerModule, ProfileModule, RecipeImportModule, ShoppingModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantAi],
})
export class AssistantModule {}
