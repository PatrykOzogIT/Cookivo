import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { INITIAL_SLIDE, SLIDES, stepIndex, type ShowcaseSlide } from './showcase.data';

/**
 * Prezentacja możliwości w hero: siatka zakładek od podstaw do zaawansowanych, strzałki, przesunięcie palcem.
 * Bez automatycznego przewijania. Wzorzec ARIA "tabs": strzałki/Home/End przenoszą fokus i wybór.
 */
@Component({
  selector: 'app-feature-showcase',
  imports: [RouterLink, MatButtonModule, TranslocoDirective],
  templateUrl: './feature-showcase.html',
  styleUrl: './feature-showcase.scss',
})
export class FeatureShowcaseComponent {
  protected readonly auth = inject(AuthService);

  protected readonly slides = SLIDES;
  protected readonly index = signal(
    Math.max(
      0,
      SLIDES.findIndex((s) => s.key === INITIAL_SLIDE),
    ),
  );
  protected readonly current = computed(() => SLIDES[this.index()]);
  /** Czy zmiana nastąpiła z ręki użytkownika - dopiero wtedy ogłaszamy ją czytnikowi ekranu */
  protected readonly announced = signal(false);

  private pointerStart: { x: number; y: number } | null = null;

  /** Dokąd prowadzi przycisk: gość przy funkcji dla zalogowanych → rejestracja z powrotem do funkcji */
  protected ctaLink(slide: ShowcaseSlide): { path: string; query: Record<string, string> | null } {
    if (slide.access === 'account' && !this.auth.isLoggedIn()) {
      return { path: '/auth/register', query: { returnUrl: slide.path } };
    }
    return { path: slide.path, query: null };
  }

  protected select(i: number, focus = false): void {
    this.index.set(stepIndex(i, 0, SLIDES.length));
    this.announced.set(true);
    if (focus) {
      queueMicrotask(() => document.getElementById(this.tabId(this.index()))?.focus());
    }
  }

  protected step(delta: number): void {
    this.select(stepIndex(this.index(), delta, SLIDES.length));
  }

  protected onTabKey(event: KeyboardEvent): void {
    const keys: Record<string, number | 'first' | 'last'> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      Home: 'first',
      End: 'last',
    };
    const k = keys[event.key];
    if (k === undefined) return;
    event.preventDefault();
    const target =
      k === 'first' ? 0 : k === 'last' ? SLIDES.length - 1 : stepIndex(this.index(), k, SLIDES.length);
    this.select(target, true);
  }

  // Przesunięcie palcem (tylko dotyk/pióro, poziome, ≥ 50 px)
  protected onPointerDown(event: PointerEvent): void {
    this.pointerStart = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY };
  }

  protected onPointerUp(event: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.step(dx < 0 ? 1 : -1);
  }

  protected tabId(i: number): string {
    return `ck-showcase-tab-${SLIDES[i].key}`;
  }
}
