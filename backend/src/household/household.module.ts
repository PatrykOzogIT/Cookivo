import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module.js';
import { HouseholdController } from './household.controller.js';
import { HouseholdService } from './household.service.js';

@Module({
  imports: [ProfileModule],
  controllers: [HouseholdController],
  providers: [HouseholdService],
  exports: [HouseholdService],
})
export class HouseholdModule {}
