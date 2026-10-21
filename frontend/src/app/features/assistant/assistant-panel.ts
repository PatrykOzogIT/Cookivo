import { A11yModule } from '@angular/cdk/a11y';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { AmountLabelPipe } from '../recipes/amount-label.pipe';
import { formatMoney } from '../prices/prices.api';
import { formatShoppingAmount } from '../shopping/shopping-format';
import { ShoppingApi } from '../shopping/shopping.api';
import {
  AssistantApi,
  type AssistantAction,
  type AssistantResult,
  type PlanResult,
  type ShoppingResult,
  type ShoppingSuggestion,
  type VariantKind,
} from './assistant.api';
import { AssistantStore, type Entry } from './assistant.store';

/**
 * Asystent: przycisk w rogu ekranu otwiera panel (z prawej na komputerze, od dołu na telefonie).
 * Szybkie akcje albo własna prośba → szkic (plan, przepisy, zakupy) do zatwierdzenia.
 * Z przepisu: tryb "Zrób z tego wersję…" → szkic w formularzu przepisu.
 */
@Component({
  selector: 'app-assistant-panel',
  imports: [
    A11yModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
    LocalizedPipe,
  ],
  templateUrl: './assistant-panel.html',
  styleUrl: './assistant-panel.scss',
  host: { '(document:keydown.escape)': 'close()' },
})
export class AssistantPanel {
  private readonly api = inject(AssistantApi);
  private readonly shoppingApi = inject(ShoppingApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly amountLabel = new AmountLabelPipe();
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;
  protected readonly s = inject(AssistantStore);

  protected readonly status = this.s.status;
  protected readonly busy = signal(false);
  protected text = '';
  /** Zaznaczona szybka akcja (wysyłana razem z dopiskiem) */
  protected readonly selected = signal<AssistantAction | null>(null);
  protected wish = '';
  protected readonly variantKind = signal<VariantKind>('LIGHTER');
  protected readonly kinds: VariantKind[] = [
    'VEGAN',
    'GLUTEN_FREE',
    'LACTOSE_FREE',
    'LIGHTER',
    'FASTER',
    'FROM_PANTRY',
  ];
  /** Odznaczone pozycje zakupów (id wpisu → id składników) */
  protected readonly skipped = signal<Record<number, string[]>>({});
  /** Wynik zatwierdzenia wpisu (komunikat) */
  protected readonly applied = signal<Record<number, string>>({});

  private readonly fab = viewChild<ElementRef<HTMLButtonElement>>('fab');
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  protected readonly visible = computed(() => this.auth.isLoggedIn() && !!this.status()?.enabled);

  constructor() {
    // Status (włączony? limit) po zalogowaniu
    effect(() => {
      if (!this.auth.isLoggedIn()) {
        this.status.set(null);
        return;
      }
      untracked(() => void this.refresh());
    });
    // Nowy wpis - przewijamy na dół
    effect(() => {
      this.s.entries();
      afterNextRender(() => this.log()?.nativeElement.scrollTo({ top: 1e6 }), { injector: this.injector });
    });
  }

  protected toggle(): void {
    if (this.s.open()) this.close();
    else this.s.openFor(null);
  }

  protected close(): void {
    if (!this.s.open()) return;
    this.s.open.set(false);
    this.s.variantOf.set(null);
    afterNextRender(() => this.fab()?.nativeElement.focus(), { injector: this.injector });
  }

  // --- Prośby --------------------------------------------------------------------------

  /** Szybka akcja tylko się zaznacza - użytkownik może dopisać życzenia i wysłać, kiedy chce */
  protected select(action: AssistantAction): void {
    this.selected.update((current) => (current === action ? null : action));
    afterNextRender(() => document.getElementById('assistant-input')?.focus(), { injector: this.injector });
  }

  protected canSend(): boolean {
    const action = this.selected();
    if (this.busy() || (!this.text.trim() && !action)) return false;
    // Uzupełnianie zakupów działa bez AI - także po wyczerpaniu limitu
    return action === 'SHOPPING' || !!this.status()?.remaining;
  }

  protected async send(): Promise<void> {
    if (!this.canSend()) return;
    const text = this.text.trim();
    const action = this.selected();
    const label = action ? this.transloco.translate(`assistant.quick.${action}`) : '';
    this.text = '';
    this.selected.set(null);
    this.s.add({ kind: 'user', text: label && text ? `${label}: ${text}` : label || text });
    await this.run(() =>
      this.api.ask({ ...(action ? { action } : {}), ...(text ? { text } : {}), lang: this.lang() }),
    );
  }

  /** Koszt planu: porcje × osoby; null, gdy żaden posiłek nie ma ceny */
  protected planCost(plan: PlanResult): { cents: number; missing: number } | null {
    const meals = plan.days.flatMap((d) => d.meals);
    const priced = meals.filter((m) => m.recipe.costPerServingCents != null);
    if (!priced.length) return null;
    return {
      cents: priced.reduce((sum, m) => sum + m.recipe.costPerServingCents! * plan.people, 0),
      missing: meals.length - priced.length,
    };
  }

  protected money(cents: number, currency: string): string {
    return formatMoney(cents, currency, this.lang());
  }

  protected async makeVariant(): Promise<void> {
    const recipe = this.s.variantOf();
    if (!recipe || this.busy()) return;
    this.busy.set(true);
    try {
      const res = await this.api.variant({
        recipeId: recipe.id,
        kind: this.variantKind(),
        wish: this.wish.trim() || undefined,
        lang: this.lang(),
      });
      this.s.variantDraft.set({ ...res, originalTitle: recipe.title });
      this.wish = '';
      this.close();
      await this.router.navigate(['/recipes/new'], { queryParams: { variantOf: recipe.id } });
    } catch (err) {
      this.s.add({ kind: 'error', code: apiErrorCode(err) });
    } finally {
      this.busy.set(false);
      void this.refresh();
    }
  }

  // --- Plan -----------------------------------------------------------------------------

  /** "Zamień": następna propozycja na ten posiłek (poprzednia trafia na koniec kolejki) */
  protected swap(entry: Entry, day: number, index: number): void {
    this.updatePlan(entry, (plan) => {
      const meal = plan.days[day].meals[index];
      const [next, ...rest] = meal.alternatives;
      if (!next) return;
      plan.days[day].meals[index] = {
        ...meal,
        recipe: next,
        alternatives: [...rest, meal.recipe],
        leftover: false,
      };
    });
  }

  protected removeMeal(entry: Entry, day: number, index: number): void {
    this.updatePlan(entry, (plan) => plan.days[day].meals.splice(index, 1));
  }

  protected async applyPlan(entry: Entry, plan: PlanResult): Promise<void> {
    const meals = plan.days.flatMap((d) =>
      d.meals.map((m) => ({ date: d.date, slot: m.slot, recipeId: m.recipe.id, leftover: m.leftover })),
    );
    if (!meals.length) return;
    await this.act(entry, async () => {
      const res = await this.api.applyPlan(meals);
      return this.transloco.translate('assistant.plan.saved', { count: res.added });
    });
  }

  protected planMeals(plan: PlanResult): number {
    return plan.days.reduce((sum, d) => sum + d.meals.length, 0);
  }

  // --- Lodówka i zakupy ------------------------------------------------------------------

  protected async addMissing(entry: Entry, recipeId: string, servings: number): Promise<void> {
    await this.act(
      entry,
      async () => {
        const res = await this.shoppingApi.fromRecipe(recipeId, servings);
        return this.transloco.translate('assistant.pantry.added', { count: res.added });
      },
      false,
    );
  }

  protected isSkipped(entry: Entry, id: string): boolean {
    return (this.skipped()[entry.id] ?? []).includes(id);
  }

  protected toggleItem(entry: Entry, id: string, checked: boolean): void {
    this.skipped.update((all) => {
      const list = all[entry.id] ?? [];
      return { ...all, [entry.id]: checked ? list.filter((x) => x !== id) : [...list, id] };
    });
  }

  protected selectedItems(entry: Entry, r: ShoppingResult): ShoppingSuggestion[] {
    return [...r.plan, ...r.regular].filter((i) => !this.isSkipped(entry, i.ingredient.id));
  }

  protected async applyShopping(entry: Entry, r: ShoppingResult): Promise<void> {
    const items = this.selectedItems(entry, r).map((i) => ({
      ingredientId: i.ingredient.id,
      grams: i.grams,
    }));
    if (!items.length) return;
    await this.act(entry, async () => {
      const res = await this.api.applyShopping(items);
      return this.transloco.translate('assistant.shopping.added', { count: res.added });
    });
  }

  protected amount(i: ShoppingSuggestion): string {
    return formatShoppingAmount(
      i.amount,
      this.lang(),
      this.transloco.translate('shopping.pieces'),
      this.transloco.translate('shopping.about'),
      (unitCode, n) => this.amountLabel.transform(n, unitCode, this.lang()),
    );
  }

  protected dayLabel(iso: string): string {
    return new Intl.DateTimeFormat(this.lang(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
      new Date(`${iso}T12:00:00`),
    );
  }

  // ---------------------------------------------------------------------------

  private updatePlan(entry: Entry, fn: (plan: PlanResult) => void): void {
    this.s.entries.update((list) =>
      list.map((e) => {
        if (e.id !== entry.id || e.kind !== 'result' || e.result.type !== 'PLAN') return e;
        const plan = structuredClone(e.result);
        fn(plan);
        return { ...e, result: plan };
      }),
    );
  }

  /** Zatwierdzenie szkicu - wynik jako komunikat przy wpisie (jednorazowo, gdy `once`) */
  private async act(entry: Entry, fn: () => Promise<string>, once = true): Promise<void> {
    if (this.busy() || (once && this.applied()[entry.id])) return;
    this.busy.set(true);
    try {
      const message = await fn();
      this.applied.update((all) => ({ ...all, [entry.id]: message }));
    } catch (err) {
      this.s.add({ kind: 'error', code: apiErrorCode(err) });
    } finally {
      this.busy.set(false);
    }
  }

  private async run(fn: () => Promise<AssistantResult>): Promise<void> {
    this.busy.set(true);
    try {
      this.s.add({ kind: 'result', result: await fn() });
    } catch (err) {
      this.s.add({ kind: 'error', code: apiErrorCode(err) });
    } finally {
      this.busy.set(false);
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.status.set(await this.api.status());
    } catch {
      this.status.set(null);
    }
  }
}
