import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../generated/prisma/enums.js';
import { ROLES_KEY, type AuthenticatedRequest } from './auth.decorators.js';

const ROLE_RANK: Record<Role, number> = { USER: 1, ADMIN: 2, SUPER_ADMIN: 3 };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    const minRank = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (!user || ROLE_RANK[user.role] < minRank) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return true;
  }
}
