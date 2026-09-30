import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Endpoint dostępny bez logowania (gość). Jeśli token jest, i tak zostanie odczytany. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Endpoint wymaga jednej z ról. SUPER_ADMIN ma dostęp wszędzie tam, gdzie ADMIN. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  role: Role;
  emailVerified: boolean;
  /** Id sesji (urządzenia), z której pochodzi token - do oznaczenia "to urządzenie" */
  sessionId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
