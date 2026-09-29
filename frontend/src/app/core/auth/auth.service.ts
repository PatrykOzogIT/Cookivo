import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { AuthResponse, RegisterRequest, Role, User, UsernameAvailability } from './auth.models';
import { hasRole } from './auth.models';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

const API = '/api/auth';

/**
 * Stan logowania. Access token trzymamy tylko w pamięci (odporny na XSS
 * czytający localStorage), refresh token żyje w ciasteczku httpOnly.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly userState = signal<User | null>(null);
  private readonly statusState = signal<AuthStatus>('unknown');
  private refreshInFlight: Promise<boolean> | null = null;

  readonly user = this.userState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly isLoggedIn = computed(() => this.statusState() === 'authenticated');
  readonly isAdmin = computed(() => hasRole(this.userState(), 'ADMIN'));

  get token(): string | null {
    return this.accessToken();
  }

  hasRole(role: Role): boolean {
    return hasRole(this.userState(), role);
  }

  /** Przy starcie aplikacji: próbujemy odtworzyć sesję z ciasteczka. */
  async restoreSession(): Promise<void> {
    await this.refresh();
  }

  async login(login: string, password: string): Promise<User> {
    const res = await firstValueFrom(
      this.http.post<AuthResponse>(`${API}/login`, { login, password }, { withCredentials: true }),
    );
    this.applySession(res);
    return res.user;
  }

  register(data: RegisterRequest): Promise<unknown> {
    return firstValueFrom(this.http.post(`${API}/register`, data));
  }

  usernameAvailable(username: string): Promise<UsernameAvailability> {
    return firstValueFrom(
      this.http.get<UsernameAvailability>(`${API}/username-available`, { params: { username } }),
    );
  }

  verifyEmail(token: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${API}/verify-email`, { token }));
  }

  resendVerification(email: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${API}/resend-verification`, { email }));
  }

  forgotPassword(email: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${API}/forgot-password`, { email }));
  }

  resetPassword(token: string, password: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${API}/reset-password`, { token, password }));
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${API}/logout`, {}, { withCredentials: true }));
    } finally {
      this.clearSession();
      await this.router.navigateByUrl('/');
    }
  }

  /**
   * Odświeża access token. Równoległe wywołania dzielą jedno żądanie,
   * a Web Locks API synchronizuje karty przeglądarki - dzięki temu dwie karty
   * nie zrotują tego samego refresh tokenu (co backend uznałby za kradzież).
   */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.withCrossTabLock(() => this.doRefresh()).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  clearSession(): void {
    this.accessToken.set(null);
    this.userState.set(null);
    this.statusState.set('anonymous');
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<AuthResponse>(`${API}/refresh`, {}, { withCredentials: true }),
      );
      this.applySession(res);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  private applySession(res: AuthResponse): void {
    this.accessToken.set(res.accessToken);
    this.userState.set(res.user);
    this.statusState.set('authenticated');
  }

  private withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request('cookivo-auth-refresh', fn) : fn();
  }
}
