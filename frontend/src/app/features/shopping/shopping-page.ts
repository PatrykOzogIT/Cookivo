import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe, parseDecimal } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { HouseholdApi } from '../household/household.api';
import { IngredientsApi } from '../ingredients/ingredients.api';
import type { Ingredient, Localized } from '../ingredients/ingredients.models';
import { IngredientPickerComponent } from '../pantry/ingredient-picker';
import { addDays, isoDay, mondayOf } from '../planner/plan-math';
import { AmountLabelPipe } from '../recipes/amount-label.pipe';
import type { LineItem } from '../recipes/recipe-units';
import {
  defaultShoppingUnit,
  formatShoppingAmount,
  groupByCategory,
  shoppingUnitOptions,
} from './shopping-format';
import { formatMoney } from '../prices/prices.api';
import { ShoppingApi, type AddResult, type ShoppingCost, type ShoppingItem } from './shopping.api';

/** Co ile sekund odświeżać wspólną listę (domownicy odhaczają w tym samym czasie) */
const POLL_MS = 15_000;

/** Składnik z bazy w formularzu ilości: nowy do dodania albo pozycja z listy (id) */
interface Draft {
  id: string | null;
  ingredient: Localized & {
    id: string;
    density: number | null;
    units: (Localized & { code: string; grams: number })[];
    category: { icon: string };
  };
  amount: string;
  unitCode: string;
  note: string;
}

@Component({
  selector: 'app-shopping-page',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    TranslocoDirective,
    LocalizedPipe,
    IngredientPickerComponent,
  ],
  templateUrl: './shopping-page.html',
  styleUrls: ['../pantry/pantry-page.scss', './shopping-page.scss'],
})
export class ShoppingPage implements OnInit {
  private readonly api = inject(ShoppingApi);
  private readonly transloco = inject(TranslocoService);
  protected readonly lang = inject(LanguageService).current;
  protected readonly household = inject(HouseholdApi).current;
  private readonly dictionaries = toSignal(inject(IngredientsApi).dictionaries$);
  private readonly amountLabel = new AmountLabelPipe();
  private readonly injector = inject(Injector);

  protected readonly items = signal<ShoppingItem[]>([]);
  protected readonly cost = signal<ShoppingCost | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<AddResult | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Zakres planu do listy: domyślnie bieżący tydzień */
  protected readonly planFrom = signal(mondayOf(isoDay(new Date())));
  protected readonly planTo = signal(addDays(mondayOf(isoDay(new Date())), 6));
  protected readonly showPlan = signal(false);
  /** Własna pozycja: nazwa czeka na opcjonalny opis ilości */
  protected readonly customName = signal<string | null>(null);
  protected customNote = '';
  /** Składnik z bazy czeka na ilość i jednostkę (np. ryż 5 kg, banany 5 szt.) */
  protected readonly draft = signal<Draft | null>(null);
  protected readonly units = computed(() => {
    const d = this.draft();
    if (!d) return [];
    const item: LineItem = {
      kind: 'ingredient',
      id: d.ingredient.id,
      name: d.ingredient,
      density: d.ingredient.density,
      units: d.ingredient.units,
    };
    return shoppingUnitOptions(item, this.dictionaries()?.units ?? []);
  });
  /** Wpisano coś, co nie jest liczbą dodatnią */
  protected readonly amountInvalid = computed(() => {
    const n = parseDecimal(this.draft()?.amount);
    return n !== null && (Number.isNaN(n) || n <= 0);
  });

  protected readonly toBuy = computed(() => groupByCategory(this.items().filter((i) => !i.checked)));
  protected readonly bought = computed(() => this.items().filter((i) => i.checked));

  constructor() {
    // Wspólna lista: odświeżamy co jakiś czas, gdy karta jest widoczna
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.busy()) void this.load(true);
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected setWeek(offset: number): void {
    const monday = addDays(mondayOf(isoDay(new Date())), offset * 7);
    this.planFrom.set(monday);
    this.planTo.set(addDays(monday, 6));
  }

  protected async fromPlan(): Promise<void> {
    await this.run(async () => {
      this.result.set(await this.api.fromPlan(this.planFrom(), this.planTo()));
      this.showPlan.set(false);
      await this.load();
    });
  }

  protected addIngredient(ingredient: Ingredient): void {
    this.customName.set(null);
    this.draft.set({
      id: null,
      ingredient,
      amount: '',
      unitCode: defaultShoppingUnit({
        kind: 'ingredient',
        id: ingredient.id,
        name: ingredient,
        units: ingredient.units,
      }),
      note: '',
    });
    this.focusAmount();
  }

  /** Zmiana ilości pozycji z listy - zaczynamy od tego, co widać (np. 3 szt. albo 1,5 kg) */
  protected edit(item: ShoppingItem): void {
    if (!item.ingredient) return;
    const a = item.amount;
    this.draft.set({
      id: item.id,
      ingredient: item.ingredient,
      amount: a ? String(a.amount).replace('.', this.lang() === 'en' ? '.' : ',') : '',
      unitCode:
        a?.unit ?? defaultShoppingUnit({ kind: 'ingredient', ...item.ingredient, name: item.ingredient }),
      note: item.note ?? '',
    });
    this.focusAmount();
  }

  protected patchDraft(patch: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected async saveDraft(): Promise<void> {
    const d = this.draft();
    if (!d || this.amountInvalid()) return;
    const amount = parseDecimal(d.amount);
    const note = d.note.trim();
    await this.run(async () => {
      if (d.id) {
        await this.api.update(d.id, { amount, unitCode: amount ? d.unitCode : null, note });
      } else {
        await this.api.add({
          ingredientId: d.ingredient.id,
          ...(amount ? { amount, unitCode: d.unitCode } : {}),
          note: note || undefined,
        });
      }
      this.draft.set(null);
      await this.load();
    });
  }

  protected unitName(code: string): string {
    const u = this.units().find((x) => x.code === code);
    if (!u) return code;
    if (u.key) return this.transloco.translate(u.key);
    return this.lang() === 'en' && u.name?.nameEn ? u.name.nameEn : (u.name?.namePl ?? code);
  }

  private focusAmount(): void {
    afterNextRender(() => document.getElementById('draft-amount')?.focus(), { injector: this.injector });
  }

  protected async addCustom(): Promise<void> {
    const name = this.customName();
    if (!name) return;
    await this.run(async () => {
      await this.api.add({ name, note: this.customNote.trim() || undefined });
      this.customName.set(null);
      this.customNote = '';
      await this.load();
    });
  }

  protected async toggle(item: ShoppingItem, checked: boolean): Promise<void> {
    // Od razu w interfejsie - w sklepie liczy się szybkość
    this.items.update((list) => list.map((i) => (i.id === item.id ? { ...i, checked } : i)));
    await this.run(async () => {
      const saved = await this.api.update(item.id, { checked });
      this.items.update((list) => list.map((i) => (i.id === saved.id ? saved : i)));
    });
  }

  protected async remove(item: ShoppingItem): Promise<void> {
    await this.run(async () => {
      await this.api.remove(item.id);
      this.items.update((list) => list.filter((i) => i.id !== item.id));
    });
  }

  protected async toPantry(): Promise<void> {
    await this.run(async () => {
      const { moved } = await this.api.toPantry();
      this.notice.set(this.transloco.translate('shopping.moved', { count: moved }));
      await this.load();
    });
  }

  protected async clear(checkedOnly: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.clear(checkedOnly);
      await this.load();
    });
  }

  protected money(cents: number): string {
    return formatMoney(cents, this.cost()?.currency ?? 'PLN', this.lang());
  }

  protected label(item: ShoppingItem): string {
    if (!item.ingredient) return item.name ?? '';
    return this.lang() === 'en' && item.ingredient.nameEn ? item.ingredient.nameEn : item.ingredient.namePl;
  }

  protected amount(item: ShoppingItem): string {
    if (!item.amount) return '';
    return formatShoppingAmount(
      item.amount,
      this.lang(),
      this.transloco.translate('shopping.pieces'),
      this.transloco.translate('shopping.about'),
      (unitCode, n) => this.amountLabel.transform(n, unitCode, this.lang()),
    );
  }

  protected skippedNames(): string {
    const lang = this.lang();
    return (this.result()?.inPantry ?? [])
      .map((i) => (lang === 'en' && i.nameEn ? i.nameEn : i.namePl))
      .join(', ');
  }

  private async load(silent = false): Promise<void> {
    try {
      const res = await this.api.list();
      this.items.set(res.items);
      this.cost.set(res.cost);
    } catch (err) {
      if (!silent) this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
      await this.load(true);
    } finally {
      this.busy.set(false);
    }
  }
}
