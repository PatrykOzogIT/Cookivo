import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthenticatedRequest } from './auth.decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret!' });

function context(req: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorWith(meta: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  const token = () => jwt.signAsync({ sub: 'u1', role: 'USER', ev: true });

  it('wpuszcza z poprawnym tokenem i ustawia req.user', async () => {
    const req: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${await token()}` } };
    await expect(new JwtAuthGuard(jwt, reflectorWith({})).canActivate(context(req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'u1', role: 'USER', emailVerified: true });
  });

  it('odrzuca brak tokenu na chronionym endpoincie', async () => {
    const guard = new JwtAuthGuard(jwt, reflectorWith({}));
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('odrzuca podrobiony token', async () => {
    const forged = await new JwtService({ secret: 'inny-sekret-inny-sekret-inny-sekret' }).signAsync({
      sub: 'u1',
      role: 'SUPER_ADMIN',
    });
    const guard = new JwtAuthGuard(jwt, reflectorWith({}));
    await expect(
      guard.canActivate(context({ headers: { authorization: `Bearer ${forged}` } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('wpuszcza gościa na endpoint @Public()', async () => {
    const req: Partial<AuthenticatedRequest> = { headers: {} };
    const guard = new JwtAuthGuard(jwt, reflectorWith({ [IS_PUBLIC_KEY]: true }));
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.user).toBeUndefined();
  });

  it('na endpoincie @Public() ignoruje nieważny token zamiast rzucać błąd', async () => {
    const guard = new JwtAuthGuard(jwt, reflectorWith({ [IS_PUBLIC_KEY]: true }));
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer zepsuty' } }))).resolves.toBe(
      true,
    );
  });
});

describe('RolesGuard', () => {
  const run = (required: string[] | undefined, role?: string) =>
    new RolesGuard(reflectorWith({ [ROLES_KEY]: required })).canActivate(
      context({ user: role ? { id: 'u', role: role as never, emailVerified: true } : undefined }),
    );

  it('przepuszcza, gdy endpoint nie wymaga ról', () => {
    expect(run(undefined, 'USER')).toBe(true);
  });

  it('przepuszcza admina i super admina na endpoint ADMIN', () => {
    expect(run(['ADMIN'], 'ADMIN')).toBe(true);
    expect(run(['ADMIN'], 'SUPER_ADMIN')).toBe(true);
  });

  it('blokuje usera na endpoincie ADMIN', () => {
    expect(() => run(['ADMIN'], 'USER')).toThrow(ForbiddenException);
  });

  it('blokuje admina na endpoincie SUPER_ADMIN', () => {
    expect(() => run(['SUPER_ADMIN'], 'ADMIN')).toThrow(ForbiddenException);
  });

  it('blokuje gościa', () => {
    expect(() => run(['ADMIN'])).toThrow(ForbiddenException);
  });
});
