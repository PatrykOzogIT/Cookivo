import { Module } from '@nestjs/common';
import { PricesModule } from '../prices/prices.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { PlannerController } from './planner.controller.js';
import { PlannerService } from './planner.service.js';

/** RecipesService pochodzi z globalnego RecipesModule */
@Module({
  imports: [ProfileModule, PricesModule],
  controllers: [PlannerController],
  providers: [PlannerService],
})
export class PlannerModule {}
