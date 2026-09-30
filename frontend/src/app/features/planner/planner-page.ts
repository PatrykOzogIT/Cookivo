import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, map } from 'rxjs';
import { apiErrorCode } from '../../core/api-error';
import { NumberPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { HouseholdApi } from '../household/household.api';
import { pluralForm } from '../recipes/unit-plural';
import { AddMealDialog, type AddMealData } from './add-meal-dialog';
import { EditMealDialog, type EditMealData } from './edit-meal-dialog';
import {
  addDays,
  balanceStatus,
  dayTotals,
  formatDay,
  formatServings,
  isoDay,
  weekDays,
  weekFromParam,
} from './plan-math';
import { PlannerApi, SLOT_MEAL_TYPE, type PlanMeal, type PlanSlot, type PlanWeek } from './planner.api';
import { PlannerSettingsDialog, type SettingsData } from './planner-settings-dialog';

const DIALOG = { width: '560px', maxWidth: '100vw', autoFocus: 'first-heading' as const };

@Component({
  selector: 'app-planner-page',
  imports: [RouterLink, MatButtonModule, MatMenuModule, MatProgressBarModule, TranslocoDirective, NumberPipe],
  templateUrl: './planner-page.html',
  styleUrl: './planner-page.scss',
})
export class PlannerPage {
  private readonly api = inject(PlannerApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly transloco = inject(TranslocoService);
  protected readonly lang = inject(LanguageService).current;
  protected readonly household = inject(HouseholdApi).current;

  /** Poniedziałek tygodnia z adresu (?week=2026-10-05) */
  readonly week = input<string>();
  readonly day = input<string>();

  protected readonly today = isoDay(new Date());
  protected readonly monday = computed(() => weekFromParam(this.week()));
  protected readonly days = computed(() => weekDays(this.monday()));
  /** Na węższych ekranach pokazujemy jeden dzień */
  protected readonly wide = toSignal(
    inject(BreakpointObserver)
      .observe('(min-width: 1100px)')
      .pipe(map((s) => s.matches)),
    { initialValue: false },
  );
  protected readonly selectedDay = computed(() => {
    const d = this.day();
    if (d && this.days().includes(d)) return d;
    return this.days().includes(this.today) ? this.today : this.monday();
  });

  protected readonly data = signal<PlanWeek | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly confirmClear = signal(false);

  /** Widoczne posiłki: nieukryte, plus ukryte, jeśli coś w nich zaplanowano */
  protected readonly slots = computed(() => {
    const d = this.data();
    if (!d) return [];
    const used = new Set(d.meals.map((m) => m.slot));
    return d.slots.filter((s) => !s.hidden || used.has(s.key));
  });
  protected readonly mealsByCell = computed(() => {
    const map = new Map<string, PlanMeal[]>();
    for (const m of this.data()?.meals ?? []) {
      const key = `${m.date}|${m.slot}`;
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  });
  /** Tryb dokładny: osoba, której bilans oglądamy (domyślnie ja) */
  protected readonly exact = computed(() => this.data()?.settings.exactPortions ?? false);
  protected readonly personKey = signal<string | null>(null);
  protected readonly person = computed(() => {
    const persons = this.data()?.persons ?? [];
    return persons.find((p) => p.key === this.personKey()) ?? persons.find((p) => p.isMe) ?? null;
  });
  /** Cel dnia wybranej osoby: moje pełne cele z profilu, u innych tylko kcal */
  protected readonly dayTarget = computed(() => {
    const d = this.data();
    const p = this.person();
    if (!d) return null;
    if (!this.exact() || !p || p.isMe) return d.targets;
    return { kcal: p.kcal, protein: 0, fat: 0, carbs: 0 };
  });

  protected readonly totals = computed(() => {
    const byDay = new Map<string, PlanMeal[]>();
    for (const m of this.data()?.meals ?? []) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]);
    const key = this.exact() ? this.person()?.key : undefined;
    return new Map(this.days().map((d) => [d, dayTotals(byDay.get(d) ?? [], key)]));
  });

  constructor() {
    effect(() => {
      const from = this.monday();
      untracked(() => void this.load(from));
    });
  }

  // --- Nawigacja --------------------------------------------------------------------

  protected goWeek(offset: number): void {
    void this.router.navigate([], {
      queryParams: { week: addDays(this.monday(), offset * 7), day: null },
      queryParamsHandling: 'merge',
    });
  }

  protected goToday(): void {
    void this.router.navigate([], { queryParams: { week: null, day: null } });
  }

  protected selectDay(d: string): void {
    void this.router.navigate([], {
      queryParams: { day: d },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // --- Posiłki ----------------------------------------------------------------------

  protected cell(date: string, slot: string): PlanMeal[] {
    return this.mealsByCell().get(`${date}|${slot}`) ?? [];
  }

  protected slotLabel(s: PlanSlot): string {
    return s.code ? this.transloco.translate(`planner.slots.${s.code}`) : (s.name ?? '');
  }

  protected async addMeal(date: string, slot: PlanSlot): Promise<void> {
    const d = this.data()!;
    const data: AddMealData = {
      date,
      slot: slot.key,
      heading: `${this.slotLabel(slot)} · ${this.dayLabel(date)}`,
      people: d.people,
      freshDays: d.freshDays,
      // Z zapasu tylko partie ugotowane najpóźniej tego dnia
      leftovers: d.leftovers.filter((l) => l.date <= date),
      mealType: slot.code ? SLOT_MEAL_TYPE[slot.code] : null,
      household: d.scope === 'HOUSEHOLD',
      lang: this.lang(),
    };
    const ref = this.dialog.open(AddMealDialog, { ...DIALOG, data });
    if (await firstValueFrom(ref.afterClosed())) await this.load(this.monday());
  }

  protected async editMeal(meal: PlanMeal): Promise<void> {
    const data: EditMealData = {
      meal,
      days: this.days(),
      slots: this.slots().map((s) => ({ key: s.key, label: this.slotLabel(s) })),
      lang: this.lang(),
      persons: this.exact() ? (this.data()?.persons ?? []) : [],
    };
    const ref = this.dialog.open(EditMealDialog, { ...DIALOG, data });
    if (await firstValueFrom(ref.afterClosed())) await this.load(this.monday());
  }

  protected async openSettings(): Promise<void> {
    const d = this.data();
    if (!d) return;
    const data: SettingsData = { settings: d.settings, slots: d.slots };
    const ref = this.dialog.open(PlannerSettingsDialog, { ...DIALOG, data });
    await firstValueFrom(ref.afterClosed());
    await this.load(this.monday());
  }

  protected async copyToNextWeek(): Promise<void> {
    await this.run(async () => {
      const { copied } = await this.api.copy(this.monday(), addDays(this.monday(), 7), 7);
      this.notice.set(this.transloco.translate('planner.copied', { count: copied }));
    });
  }

  protected async copyDayToNext(date: string): Promise<void> {
    await this.run(async () => {
      const { copied } = await this.api.copy(date, addDays(date, 1), 1);
      this.notice.set(this.transloco.translate('planner.copiedDay', { count: copied }));
      await this.load(this.monday());
    });
  }

  protected async clearWeek(): Promise<void> {
    await this.run(async () => {
      await this.api.clear(this.monday(), addDays(this.monday(), 6));
      this.confirmClear.set(false);
      await this.load(this.monday());
    });
  }

  // --- Formatowanie -----------------------------------------------------------------

  protected dayLabel(iso: string, long = false): string {
    return formatDay(iso, this.lang(), long);
  }

  /** Skrót dnia tygodnia: "pon." / "Mon" */
  protected dow(iso: string): string {
    return new Intl.DateTimeFormat(this.lang() === 'en' ? 'en-GB' : 'pl-PL', { weekday: 'short' }).format(
      new Date(`${iso}T12:00:00`),
    );
  }

  protected weekLabel(): string {
    const fmt = new Intl.DateTimeFormat(this.lang() === 'en' ? 'en-GB' : 'pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const [first, last] = [this.days()[0], this.days()[6]];
    return fmt.formatRange(new Date(`${first}T12:00:00`), new Date(`${last}T12:00:00`));
  }

  protected portions(n: number): string {
    const forms = this.transloco.translate('planner.portionForms');
    return `${formatServings(n, this.lang())} ${pluralForm(forms, n, this.lang())}`;
  }

  protected myKcal(m: PlanMeal): number {
    return m.recipe.perServing.kcal * m.myServings;
  }

  protected status(date: string) {
    return balanceStatus(this.totals().get(date)?.kcal ?? 0, this.dayTarget()?.kcal);
  }

  /** Porcja wybranej osoby w posiłku (tryb dokładny) */
  protected share(m: PlanMeal) {
    return m.shares?.find((s) => s.key === this.person()?.key) ?? null;
  }

  protected absentNames(m: PlanMeal): string {
    const persons = this.data()?.persons ?? [];
    return m.absent
      .map((k) => persons.find((p) => p.key === k)?.name ?? '')
      .filter(Boolean)
      .join(', ');
  }

  protected percent(value: number, target: number | undefined): number {
    return target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  }

  // ---------------------------------------------------------------------------

  private async load(from: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.get(from, addDays(from, 6)));
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }
}
