import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module.js';
import { PlannerController } from './planner.controller.js';
import { PlannerService } from './planner.service.js';

/** RecipesService pochodzi z globalnego RecipesModule */
@Module({
  imports: [ProfileModule],
  controllers: [PlannerController],
  providers: [PlannerService],
})
export class PlannerModule {}
