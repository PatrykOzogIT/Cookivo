import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PhotosModule } from '../photos/photos.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

@Module({
  imports: [AuthModule, PhotosModule, ProfileModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
