import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe, parseDecimal } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { HouseholdApi } from '../household/household.api';
import { IngredientsApi } from '../ingredients/ingredients.api';
import type { Ingredient, Localized } from '../ingredients/ingredients.models';
import { IngredientPickerComponent } from '../pantry/ingredient-picker';
import { AmountLabelPipe } from '../recipes/amount-label.pipe';
import { unitOptions } from '../recipes/recipe-units';
import {
  CURRENCIES,
  formatMoney,
  PricesApi,
  type Currency,
  type PriceEntries,
  type PriceEntry,
  type PriceList,
} from './prices.api';

interface Draft {
  ingredient: Localized & {
    id: string;
    density?: number | null;
    units?: (Localized & { code: string; grams: number })[];
  };
  packageAmount: string;
  packageUnitCode: string;
  price: string;
}

@Component({
  selector: 'app-prices-page',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    TranslocoDirective,
    LocalizedPipe,
    AmountLabelPipe,
    IngredientPickerComponent,
  ],
  templateUrl: './prices-page.html',
  styleUrls: ['../pantry/pantry-page.scss', './prices-page.scss'],
})
export class PricesPage implements OnInit {
  private readonly api = inject(PricesApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly lang = inject(LanguageService).current;
  protected readonly household = inject(HouseholdApi).current;
  private readonly ingredientsApi = inject(IngredientsApi);
  private readonly dictionaries = toSignal(this.ingredientsApi.dictionaries$);

  /** Wybrany cennik z adresu (?list=...) */
  readonly list = input<string>();

  protected readonly currencies = CURRENCIES;
  protected readonly lists = signal<PriceList[]>([]);
  protected readonly data = signal<PriceEntries | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly renaming = signal(false);
  protected readonly confirmDelete = signal(false);

  protected newName = '';
  protected newCurrency: Currency = 'PLN';
  protected renameValue = '';

  protected readonly selected = computed<PriceList | null>(() => {
    const all = this.lists();
    return all.find((l) => l.id === this.list()) ?? all.find((l) => l.isDefault) ?? all.at(0) ?? null;
  });

  /** Jednostki opakowania: g, kg, ml, l (płyny) i jednostki kuchenne składnika */
  protected readonly units = computed(() => {
    const d = this.draft();
    if (!d) return [];
    const kitchen = unitOptions(
      {
        kind: 'ingredient',
        id: d.ingredient.id,
        name: d.ingredient,
        density: d.ingredient.density,
        units: d.ingredient.units ?? [],
      },
      this.dictionaries()?.units ?? [],
    )
      .filter((u) => u.code !== 'g' && u.code !== 'ml')
      .map((u) => ({ code: u.code, label: this.unitLabel(u.code, u.key, u.name) }));
    const weight = [
      { code: 'g', label: 'g' },
      { code: 'kg', label: 'kg' },
    ];
    const volume = d.ingredient.density
      ? [
          { code: 'ml', label: 'ml' },
          { code: 'l', label: 'l' },
        ]
      : [];
    return [...weight, ...volume, ...kitchen];
  });

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      this.lists.set(await this.api.lists());
      await this.loadEntries();
    });
    this.loading.set(false);
  }

  protected async selectList(id: string): Promise<void> {
    await this.router.navigate([], { queryParams: { list: id }, replaceUrl: true });
    this.draft.set(null);
    this.renaming.set(false);
    this.confirmDelete.set(false);
    await this.run(() => this.loadEntries());
  }

  protected async createList(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    await this.run(async () => {
      const lists = await this.api.create(name, this.newCurrency);
      this.lists.set(lists);
      this.newName = '';
      const created = lists.find((l) => l.name === name && !this.data()?.list.id) ?? lists.at(-1);
      if (created) await this.selectList(created.id);
    });
  }

  protected startRename(): void {
    this.renameValue = this.selected()?.name ?? '';
    this.renaming.set(true);
  }

  protected async saveRename(): Promise<void> {
    const s = this.selected();
    const name = this.renameValue.trim();
    if (!s || !name) return;
    await this.run(async () => {
      this.lists.set(await this.api.update(s.id, { name }));
      this.renaming.set(false);
      await this.loadEntries();
    });
  }

  protected async setCurrency(currency: Currency): Promise<void> {
    const s = this.selected();
    if (!s) return;
    await this.run(async () => {
      this.lists.set(await this.api.update(s.id, { currency }));
      await this.loadEntries();
    });
  }

  protected async makeDefault(): Promise<void> {
    const s = this.selected();
    if (!s) return;
    await this.run(async () => this.lists.set(await this.api.update(s.id, { isDefault: true })));
  }

  protected async removeList(): Promise<void> {
    const s = this.selected();
    if (!s) return;
    await this.run(async () => {
      this.lists.set(await this.api.remove(s.id));
      this.confirmDelete.set(false);
      await this.router.navigate([], { queryParams: { list: null }, replaceUrl: true });
      await this.loadEntries();
    });
  }

  protected startEntry(ingredient: Ingredient): void {
    const existing = this.data()?.entries.find((e) => e.ingredient.id === ingredient.id);
    this.draft.set({
      ingredient,
      packageAmount: existing ? this.num(existing.packageAmount) : '1',
      packageUnitCode:
        existing?.packageUnitCode ?? (ingredient.units.some((u) => u.code === 'PIECE') ? 'PIECE' : 'kg'),
      price: existing ? this.num(existing.priceCents / 100) : '',
    });
  }

  /** Edycja z listy: pełne dane składnika (jednostki kuchenne, gęstość) pobieramy z bazy */
  protected async editEntry(e: PriceEntry): Promise<void> {
    await this.run(async () => this.startEntry(await this.ingredientsApi.get(e.ingredient.id)));
  }

  protected patchDraft(patch: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected async saveEntry(): Promise<void> {
    const d = this.draft();
    const s = this.selected();
    if (!d || !s) return;
    const amount = parseDecimal(d.packageAmount);
    const price = parseDecimal(d.price);
    if (!amount || Number.isNaN(amount) || price === null || Number.isNaN(price)) {
      this.error.set('PRICE_INVALID');
      return;
    }
    await this.run(async () => {
      this.data.set(
        await this.api.setEntry(s.id, {
          ingredientId: d.ingredient.id,
          packageAmount: amount,
          packageUnitCode: d.packageUnitCode,
          price,
        }),
      );
      this.draft.set(null);
      this.lists.set(await this.api.lists());
    });
  }

  protected async removeEntry(e: PriceEntry): Promise<void> {
    const s = this.selected();
    if (!s) return;
    await this.run(async () => {
      this.data.set(await this.api.removeEntry(s.id, e.id));
      this.lists.set(await this.api.lists());
    });
  }

  protected money(cents: number): string {
    return formatMoney(cents, this.data()?.list.currency ?? 'PLN', this.lang());
  }

  protected packageLabel(e: PriceEntry): string {
    if (e.packageUnitCode === 'kg' || e.packageUnitCode === 'l') {
      return `${this.num(e.packageAmount)} ${e.packageUnitCode}`;
    }
    return '';
  }

  protected perLabel(per: 'kg' | 'l' | 'PIECE'): string {
    return per === 'PIECE' ? this.transloco.translate('prices.perPiece') : `/ ${per}`;
  }

  private num(n: number): string {
    return new Intl.NumberFormat(this.lang() === 'en' ? 'en-GB' : 'pl-PL', {
      maximumFractionDigits: 3,
      useGrouping: false,
    }).format(n);
  }

  private unitLabel(code: string, key?: string, name?: Localized): string {
    if (key) return this.transloco.translate(key);
    return this.lang() === 'en' && name?.nameEn ? name.nameEn : (name?.namePl ?? code);
  }

  private async loadEntries(): Promise<void> {
    const s = this.selected();
    this.data.set(s ? await this.api.entries(s.id) : null);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
