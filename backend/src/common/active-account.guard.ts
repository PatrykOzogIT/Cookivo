import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeBlock, blockedError } from './account-block.js';
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthenticatedRequest } from './auth.decorators.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Access token żyje 15 min, więc blokada i zmiana roli nie mogą czekać na jego wygaśnięcie.
 * Przy zapisach i na endpointach z @Roles sprawdzamy konto w bazie: zablokowany dostaje 403,
 * a rola w req.user jest bieżąca (odebranie ADMIN działa od razu). Odczyty bez ról - bez zapytania.
 */
@Injectable()
export class ActiveAccountGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) return true;
    // Publiczne (m.in. wylogowanie) - bez sprawdzania
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])
    ) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (READ_METHODS.has(req.method) && !roles?.length) return true;

    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, blockedAt: true, blockedUntil: true, blockReason: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    const block = activeBlock(user);
    if (block) throw blockedError(block);
    req.user.role = user.role;
    return true;
  }
}
