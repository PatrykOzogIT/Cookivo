import { Component, DestroyRef, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LanguageService } from '../../core/i18n/language.service';
import { addDays, formatDay, formatServings, isoDay } from '../planner/plan-math';
import { PlannerApi } from '../planner/planner.api';
import { formatClock, secondsLeft, startTimer, type CookTimer } from '../recipes/cook/timers';
import { AssistantApi, type PrepResult, type PrepStep } from './assistant.api';
import { AssistantStore } from './assistant.store';
import { backgroundsAfter, clockAt, duration, stepKey } from './prep-view';

/** Najwięcej dań w jednym harmonogramie (tyle ogarnia jedna osoba w domowej kuchni) */
const MAX_DISHES = 4;

interface CookOption {
  id: string;
  date: string;
  title: string;
  servings: number;
}

/**
 * Plan gotowania (meal prep): wybór partii z planu na najbliższy tydzień → asystent układa kroki
 * w jedną kolejność → oś czasu "Ty / W tle" z odhaczaniem i minutnikami.
 */
@Component({
  selector: 'app-prep-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
  ],
  templateUrl: './prep-page.html',
  styleUrl: './prep-page.scss',
})
export class PrepPage implements OnInit {
  private readonly api = inject(AssistantApi);
  private readonly planner = inject(PlannerApi);
  protected readonly store = inject(AssistantStore);
  protected readonly lang = inject(LanguageService).current;

  /** ?from=YYYY-MM-DD z planera (domyślnie dziś) */
  readonly from = input<string>();

  protected readonly day = computed(() => {
    const today = isoDay(new Date());
    const from = this.from();
    return from && /^\d{4}-\d{2}-\d{2}$/.test(from) && from > today ? from : today;
  });
  protected readonly cooks = signal<CookOption[] | null>(null);
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly start = signal(this.store.prep()?.start ?? '10:00');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly timers = signal<Record<string, CookTimer>>({});
  protected readonly now = signal(Date.now());
  protected readonly announcement = signal('');
  protected readonly max = MAX_DISHES;

  protected readonly result = computed(() => this.store.prep()?.result ?? null);
  protected readonly done = computed(() => this.store.prep()?.done ?? new Set<string>());
  protected readonly current = computed(() => {
    const r = this.result();
    return r?.steps.find((s) => !this.done().has(stepKey(s))) ?? null;
  });
  protected readonly titles = computed(
    () => new Map((this.result()?.dishes ?? []).map((d) => [d.letter, d.title] as const)),
  );

  private tick?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.tick));
  }

  async ngOnInit(): Promise<void> {
    try {
      const from = this.day();
      const week = await this.planner.get(from, addDays(from, 6));
      const byId = new Map<string, CookOption>();
      for (const m of week.meals) {
        // Partie ugotowane przed tym dniem to resztki - już gotowe
        if (m.cook.date < from || byId.has(m.cook.id)) continue;
        byId.set(m.cook.id, {
          id: m.cook.id,
          date: m.cook.date,
          title: m.recipe.title,
          servings: m.cook.servings,
        });
      }
      const list = [...byId.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
      );
      this.cooks.set(list);
      this.chosen.set(new Set(list.slice(0, MAX_DISHES).map((c) => c.id)));
    } catch (err) {
      this.error.set(apiErrorCode(err));
      this.cooks.set([]);
    }
  }

  protected toggleCook(id: string, checked: boolean): void {
    this.chosen.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected canGenerate(): boolean {
    const n = this.chosen().size;
    return !this.busy() && n >= 1 && n <= MAX_DISHES && !!this.store.status()?.remaining;
  }

  protected async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.prep([...this.chosen()], this.lang());
      this.store.prep.set({ result, start: this.start(), done: new Set() });
      this.timers.set({});
      this.store.status.update((s) => (s ? { ...s, remaining: Math.max(0, s.remaining - 1) } : s));
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected setStart(value: string): void {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    this.start.set(value);
    this.store.prep.update((p) => (p ? { ...p, start: value } : p));
  }

  protected toggleDone(s: PrepStep, checked: boolean): void {
    this.store.prep.update((p) => {
      if (!p) return p;
      const done = new Set(p.done);
      if (checked) done.add(stepKey(s));
      else done.delete(stepKey(s));
      return { ...p, done };
    });
  }

  protected again(): void {
    this.store.prep.set(null);
    this.timers.set({});
  }

  protected print(): void {
    window.print();
  }

  // --- Minutniki (te same zasady co w trybie gotowania) --------------------------------------

  protected startTimer(s: PrepStep): void {
    if (!s.timerMinutes) return;
    const now = Date.now();
    this.now.set(now);
    this.timers.update((t) => ({ ...t, [stepKey(s)]: startTimer(s.index, s.timerMinutes!, now) }));
    this.ensureTick();
  }

  protected stopTimer(s: PrepStep): void {
    this.timers.update((t) => {
      const next = { ...t };
      delete next[stepKey(s)];
      return next;
    });
  }

  protected left(s: PrepStep): string | null {
    const t = this.timers()[stepKey(s)];
    return t ? formatClock(secondsLeft(t, this.now())) : null;
  }

  private ensureTick(): void {
    if (this.tick) return;
    this.tick = setInterval(() => {
      const now = Date.now();
      this.now.set(now);
      const timers = this.timers();
      for (const [key, t] of Object.entries(timers)) {
        if (!t.done && secondsLeft(t, now) === 0) {
          this.timers.update((all) => ({ ...all, [key]: { ...t, done: true } }));
          this.announcement.set(key);
          navigator.vibrate?.([300, 150, 300]);
        }
      }
    }, 1000);
  }

  // --- Widok ---------------------------------------------------------------------------------

  protected key = stepKey;

  protected clock(offset: number): string {
    return clockAt(this.start(), offset);
  }

  protected length(minutes: number): string {
    return duration(minutes);
  }

  protected backgrounds(r: PrepResult, s: PrepStep) {
    return backgroundsAfter(r.steps, s);
  }

  protected dayLabel(iso: string): string {
    return formatDay(iso, this.lang());
  }

  protected servings(n: number): string {
    return formatServings(n, this.lang());
  }
}
