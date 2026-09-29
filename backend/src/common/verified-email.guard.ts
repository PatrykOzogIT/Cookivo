import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth.decorators.js';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/** Akcja wymaga potwierdzonego adresu e-mail (np. dodawanie treści). */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user?.emailVerified) throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED' });
    return true;
  }
}
