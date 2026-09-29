import {
  Component,
  DOCUMENT,
  type ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { LocalizedPipe } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { AmountLabelPipe } from '../amount-label.pipe';
import { groupLines } from '../detail/recipe-detail-page';
import { scaleAmount } from '../recipe-units';
import { RecipesApi } from '../recipes.api';
import type { RecipeDetail, RecipeLine } from '../recipes.models';
import { formatClock, pause, resume, secondsLeft, startTimer, type CookTimer } from './timers';

@Component({
  selector: 'app-cooking-mode-page',
  imports: [MatButtonModule, MatCheckboxModule, TranslocoDirective, LocalizedPipe, AmountLabelPipe],
  templateUrl: './cooking-mode-page.html',
  styleUrl: './cooking-mode-page.scss',
  host: { '(document:keydown)': 'onKey($event)', '(document:visibilitychange)': 'onVisibility()' },
})
export class CookingModePage implements OnInit, OnDestroy {
  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);
  protected readonly lang = inject(LanguageService).current;

  readonly id = input.required<string>();
  /** ?servings= z przycisku "Gotuj" */
  readonly servings = input<string>();

  protected readonly recipe = signal<RecipeDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  /** 0 = karta składników, 1..n = kroki */
  protected readonly index = signal(0);
  protected readonly checked = signal<ReadonlySet<string>>(new Set());
  protected readonly timers = signal<CookTimer[]>([]);
  protected readonly now = signal(Date.now());
  protected readonly wakeLockActive = signal(false);
  protected readonly announcement = signal('');

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  private wakeLock: WakeLockSentinel | null = null;
  private tick?: ReturnType<typeof setInterval>;
  private scrollRaf = 0;

  protected readonly portions = computed(() => {
    const r = this.recipe();
    const n = Number(this.servings());
    return r ? (Number.isInteger(n) && n > 0 ? n : r.servings) : 1;
  });
  protected readonly factor = computed(() => this.portions() / (this.recipe()?.servings ?? 1));
  protected readonly groups = computed(() => groupLines(this.recipe()?.ingredients ?? []));
  protected readonly cardCount = computed(() => 1 + (this.recipe()?.steps.length ?? 0));

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.api.get(this.id());
      this.recipe.set(r);
      this.title.setTitle(`${this.transloco.translate('recipes.cook.title')}: ${r.title} · Cookivo`);
      await this.requestWakeLock();
      this.tick = setInterval(() => this.onTick(), 1000);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.tick);
    void this.wakeLock?.release().catch(() => undefined);
  }

  // --- Nawigacja między kartami ------------------------------------------------

  protected go(index: number): void {
    const target = Math.max(0, Math.min(this.cardCount() - 1, index));
    const track = this.track()?.nativeElement;
    this.index.set(target);
    track?.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
  }

  /** Przewijanie palcem → ustal bieżącą kartę */
  protected onScroll(): void {
    cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      const track = this.track()?.nativeElement;
      if (track) this.index.set(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
    });
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]')) return;
    if (event.key === 'ArrowRight') this.go(this.index() + 1);
    else if (event.key === 'ArrowLeft') this.go(this.index() - 1);
    else if (event.key === 'Escape') this.exit();
  }

  protected exit(): void {
    void this.router.navigate(['/recipes', this.id()]);
  }

  // --- Składniki ------------------------------------------------------------------

  protected scaled(line: RecipeLine): number {
    return scaleAmount(line.amount, this.factor(), line.unitCode);
  }

  protected toggle(lineId: string, on: boolean): void {
    this.checked.update((set) => {
      const next = new Set(set);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  // --- Minutniki ------------------------------------------------------------------

  protected timerFor(step: number): CookTimer | undefined {
    return this.timers().find((t) => t.step === step);
  }

  protected clock(t: CookTimer): string {
    return formatClock(secondsLeft(t, this.now()));
  }

  protected startTimer(step: number, minutes: number): void {
    this.unlockAudio();
    this.timers.update((list) => [
      ...list.filter((t) => t.step !== step),
      startTimer(step, minutes, Date.now()),
    ]);
  }

  protected togglePause(step: number): void {
    this.timers.update((list) =>
      list.map((t) =>
        t.step !== step ? t : t.pausedLeft !== null ? resume(t, Date.now()) : pause(t, Date.now()),
      ),
    );
  }

  protected stopTimer(step: number): void {
    this.timers.update((list) => list.filter((t) => t.step !== step));
  }

  private onTick(): void {
    const now = Date.now();
    this.now.set(now);
    const finished = this.timers().filter(
      (t) => !t.done && t.pausedLeft === null && secondsLeft(t, now) === 0,
    );
    if (!finished.length) return;
    this.timers.update((list) => list.map((t) => (finished.includes(t) ? { ...t, done: true } : t)));
    for (const t of finished) {
      this.announcement.set(this.transloco.translate('recipes.cook.timerDone', { step: t.step }));
    }
    this.alarm();
  }

  // --- Ekran nie gaśnie (Wake Lock) i sygnał minutnika --------------------------------

  private async requestWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      this.wakeLockActive.set(!!this.wakeLock);
      this.wakeLock?.addEventListener('release', () => this.wakeLockActive.set(false));
    } catch {
      // np. tryb oszczędzania baterii - działa dalej, tylko ekran może zgasnąć
      this.wakeLockActive.set(false);
    }
  }

  /** Blokada jest zwalniana, gdy karta znika z ekranu - wznawiamy po powrocie */
  protected onVisibility(): void {
    if (this.document.visibilityState === 'visible' && this.recipe()) void this.requestWakeLock();
  }

  private audio?: AudioContext;

  /** iOS pozwala na dźwięk tylko po geście użytkownika - "odblokowujemy" przy starcie minutnika */
  private unlockAudio(): void {
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch {
      /* brak Web Audio */
    }
  }

  private alarm(): void {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
    const ctx = this.audio;
    if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(ctx.destination);
      const start = ctx.currentTime + i * 0.4;
      osc.start(start);
      osc.stop(start + 0.25);
    }
  }
}
