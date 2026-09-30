import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, type AuthenticatedRequest, type AuthUser } from './auth.decorators.js';

interface AccessTokenPayload {
  sub: string;
  role: AuthUser['role'];
  ev: boolean;
  sid?: string;
}

/**
 * Globalny guard: domyślnie każdy endpoint wymaga ważnego access tokenu.
 * Endpointy oznaczone @Public() przepuszczają gości.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(req);

    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
        req.user = { id: payload.sub, role: payload.role, emailVerified: payload.ev, sessionId: payload.sid };
      } catch {
        if (!isPublic) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
      }
    }

    if (!isPublic && !req.user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    return true;
  }

  private extractToken(req: AuthenticatedRequest): string | undefined {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
