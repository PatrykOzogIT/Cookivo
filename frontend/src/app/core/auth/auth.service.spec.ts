import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import type { AuthResponse } from './auth.models';
import { AuthService } from './auth.service';

const session = (token: string, role: AuthResponse['user']['role'] = 'USER'): AuthResponse => ({
  accessToken: token,
  expiresIn: 900,
  user: {
    id: 'u1',
    username: 'Kasia',
    email: 'kasia@example.com',
    role,
    locale: 'pl',
    emailVerified: true,
    createdAt: '2026-09-29T00:00:00Z',
  },
});

/** Pozwala obsłużyć odpowiedzi HTTP, które startują w kolejnych mikrozadaniach. */
const flushMicrotasks = () => new Promise((r) => setTimeout(r));

describe('AuthService + authInterceptor', () => {
  let auth: AuthService;
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('login zapisuje sesję i wysyła ciasteczka', async () => {
    const promise = auth.login('kasia', 'haslo');
    const req = backend.expectOne('/api/auth/login');
    expect(req.request.withCredentials).toBe(true);
    req.flush(session('A1'));
    await promise;

    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.user()?.username).toBe('Kasia');
    expect(auth.token).toBe('A1');
  });

  it('restoreSession bez ważnego ciasteczka ustawia gościa', async () => {
    const promise = auth.restoreSession();
    await flushMicrotasks();
    backend
      .expectOne('/api/auth/refresh')
      .flush({ code: 'SESSION_EXPIRED' }, { status: 401, statusText: 'x' });
    await promise;
    expect(auth.status()).toBe('anonymous');
  });

  it('równoległe odświeżenia dzielą jedno żądanie', async () => {
    const a = auth.refresh();
    const b = auth.refresh();
    await flushMicrotasks();
    backend.expectOne('/api/auth/refresh').flush(session('A2'));
    expect(await a).toBe(true);
    expect(await b).toBe(true);
  });

  it('interceptor dokleja token tylko do /api', async () => {
    const login = auth.login('kasia', 'haslo');
    backend.expectOne('/api/auth/login').flush(session('A1'));
    await login;

    void firstValueFrom(http.get('/api/auth/me'));
    expect(backend.expectOne('/api/auth/me').request.headers.get('Authorization')).toBe('Bearer A1');

    void firstValueFrom(http.get('https://example.com/x'));
    expect(backend.expectOne('https://example.com/x').request.headers.has('Authorization')).toBe(false);
  });

  it('po 401 odświeża token i ponawia żądanie', async () => {
    const login = auth.login('kasia', 'haslo');
    backend.expectOne('/api/auth/login').flush(session('OLD'));
    await login;

    const result = firstValueFrom(http.get<{ ok: boolean }>('/api/auth/me'));
    backend.expectOne('/api/auth/me').flush({ code: 'TOKEN_INVALID' }, { status: 401, statusText: 'x' });
    await flushMicrotasks();
    backend.expectOne('/api/auth/refresh').flush(session('NEW'));
    await flushMicrotasks();
    const retry = backend.expectOne('/api/auth/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer NEW');
    retry.flush({ ok: true });

    expect(await result).toEqual({ ok: true });
  });

  it('gdy odświeżenie się nie uda, wylogowuje i zwraca błąd', async () => {
    const login = auth.login('kasia', 'haslo');
    backend.expectOne('/api/auth/login').flush(session('OLD'));
    await login;

    const result = firstValueFrom(http.get('/api/auth/me'));
    backend.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'x' });
    await flushMicrotasks();
    backend.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'x' });

    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('hasRole uwzględnia hierarchię ról', async () => {
    const login = auth.login('szef', 'haslo');
    backend.expectOne('/api/auth/login').flush(session('A', 'SUPER_ADMIN'));
    await login;
    expect(auth.hasRole('USER')).toBe(true);
    expect(auth.hasRole('ADMIN')).toBe(true);
    expect(auth.isAdmin()).toBe(true);
  });
});
