import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordPolicyService } from './password-policy.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordPolicyService],
  exports: [AuthService, PasswordPolicyService],
})
export class AuthModule {}
