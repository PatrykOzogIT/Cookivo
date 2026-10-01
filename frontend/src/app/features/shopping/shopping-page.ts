import { Component, DestroyRef, computed, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { HouseholdApi } from '../household/household.api';
import type { Ingredient } from '../ingredients/ingredients.models';
import { IngredientPickerComponent } from '../pantry/ingredient-picker';
import { addDays, isoDay, mondayOf } from '../planner/plan-math';
import { formatShoppingAmount, groupByCategory } from './shopping-format';
import { ShoppingApi, type AddResult, type ShoppingItem } from './shopping.api';

/** Co ile sekund odświeżać wspólną listę (domownicy odhaczają w tym samym czasie) */
const POLL_MS = 15_000;

@Component({
  selector: 'app-shopping-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
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

  protected readonly items = signal<ShoppingItem[]>([]);
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

  protected async addIngredient(ingredient: Ingredient): Promise<void> {
    await this.run(async () => {
      await this.api.add({ ingredientId: ingredient.id });
      await this.load();
    });
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
      this.items.set(await this.api.list());
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
