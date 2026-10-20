import { HttpClient } from '@angular/common/http';
import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export interface AdminSummary {
  /** Sprawy w kolejce zgłoszeń (po celu, jak w panelu) */
  openReports: number;
  pendingIngredients: number;
  /** Otwarte prośby o dodanie składnika */
  ingredientRequests: number;
  total: number;
}

/** Co ile minut odświeżamy licznik, gdy karta jest otwarta */
const REFRESH_MS = 5 * 60 * 1000;
/** Nie częściej niż co 30 s (np. przy szybkim klikaniu po stronach) */
const MIN_GAP_MS = 30 * 1000;

/**
 * Licznik spraw do załatwienia dla admina (zgłoszenia + składniki do akceptacji) - cyfra przy nicku.
 * Odświeżany po zalogowaniu, przy zmianie strony, po powrocie do karty i co 5 minut; tylko dla adminów.
 */
@Injectable({ providedIn: 'root' })
export class AdminSummaryService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly summary = signal<AdminSummary | null>(null);
  private lastAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this.auth.isAdmin()) {
        void this.refresh(true);
        this.timer ??= setInterval(() => void this.refresh(), REFRESH_MS);
      } else {
        this.summary.set(null);
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      }
    });
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => void this.refresh());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.refresh();
      });
    }
  }

  /** force = zaraz po akcji admina (rozpatrzenie zgłoszenia, akceptacja składnika) */
  async refresh(force = false): Promise<void> {
    if (!this.auth.isAdmin()) return;
    if (!force && Date.now() - this.lastAt < MIN_GAP_MS) return;
    this.lastAt = Date.now();
    try {
      this.summary.set(await firstValueFrom(this.http.get<AdminSummary>('/api/admin/summary')));
    } catch {
      // Licznik jest pomocniczy - błąd sieci nie może psuć strony
    }
  }
}
