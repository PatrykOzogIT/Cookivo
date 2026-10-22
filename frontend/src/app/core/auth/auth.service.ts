import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { AuthResponse, RegisterRequest, Role, User, UsernameAvailability } from './auth.models';
import { hasRole } from './auth.models';
import type { AccountBlock } from './account-block';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

const API = '/api/auth';
/** Najdłużej czekamy na przywrócenie sesji przy starcie (potem strona i tak się pokazuje) */
const RESTORE_WAIT_MS = 8000;
/** Najdłużej czekamy na blokadę odświeżania trzymaną przez inną kartę */
const LOCK_WAIT_MS = 5000;

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
  readonly isSuperAdmin = computed(() => hasRole(this.userState(), 'SUPER_ADMIN'));
  /** Ostatnia informacja o blokadzie konta - pokazywana na stronie logowania */
  readonly blocked = signal<AccountBlock | null>(null);

  get token(): string | null {
    return this.accessToken();
  }

  hasRole(role: Role): boolean {
    return hasRole(this.userState(), role);
  }

  /**
   * Przy starcie aplikacji: próbujemy odtworzyć sesję z ciasteczka, ale strona nie czeka dłużej
   * niż kilka sekund (uśpiony serwer po przerwie, blokada trzymana przez uśpioną kartę).
   * Odświeżenie kończy się w tle - sesja podepnie się, gdy wróci odpowiedź.
   */
  async restoreSession(maxWaitMs = RESTORE_WAIT_MS): Promise<void> {
    await Promise.race([this.refresh(), new Promise((resolve) => setTimeout(resolve, maxWaitMs))]);
  }

  /** Czeka na trwające przywracanie sesji (strażnicy tras przy starcie) */
  async settled(): Promise<void> {
    if (this.refreshInFlight) await this.refreshInFlight;
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
        this.http.post<AuthResponse | null>(`${API}/refresh`, {}, { withCredentials: true }),
      );
      // 204 = brak ciasteczka sesji (gość)
      if (!res?.accessToken) {
        this.clearSession();
        return false;
      }
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

  /**
   * Blokada między kartami - ale nie dłużej niż kilka sekund: uśpiona karta w tle potrafi trzymać
   * ją bez końca. Wtedy odświeżamy bez niej (serwer toleruje poprzedni token tuż po wymianie).
   */
  private async withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks || !AbortSignal?.timeout) return fn();
    try {
      return await locks.request('cookivo-auth-refresh', { signal: AbortSignal.timeout(LOCK_WAIT_MS) }, fn);
    } catch (err) {
      if ((err as DOMException)?.name === 'TimeoutError' || (err as DOMException)?.name === 'AbortError') {
        return fn();
      }
      throw err;
    }
  }
}
