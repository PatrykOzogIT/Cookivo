import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe, parseDecimal } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { IngredientsApi } from '../ingredients/ingredients.api';
import type { Ingredient } from '../ingredients/ingredients.models';
import { AmountLabelPipe } from '../recipes/amount-label.pipe';
import { pluralForm } from '../recipes/unit-plural';
import { unitOptions, type LineItem } from '../recipes/recipe-units';
import { IngredientPickerComponent } from './ingredient-picker';
import { PantryApi, type PantryIngredient, type PantryItem } from './pantry.api';

interface Draft {
  /** Edytowany wpis (null = nowy) */
  id: string | null;
  ingredient: PantryIngredient | Ingredient;
  amount: string;
  unitCode: string;
  expiresOn: string;
}

@Component({
  selector: 'app-pantry-page',
  imports: [
    FormsModule,
    RouterLink,
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
  templateUrl: './pantry-page.html',
  styleUrl: './pantry-page.scss',
})
export class PantryPage implements OnInit {
  private readonly api = inject(PantryApi);
  private readonly transloco = inject(TranslocoService);
  protected readonly lang = inject(LanguageService).current;
  private readonly dictionaries = toSignal(inject(IngredientsApi).dictionaries$);

  protected readonly items = signal<PantryItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal<Draft | null>(null);

  protected readonly expiring = computed(() => this.items().filter((i) => i.expiring));
  protected readonly groups = computed(() => {
    const map = new Map<string, { category: PantryIngredient['category']; items: PantryItem[] }>();
    for (const item of this.items()) {
      const c = item.ingredient.category;
      map.set(c.code, { category: c, items: [...(map.get(c.code)?.items ?? []), item] });
    }
    return [...map.values()];
  });
  /** Jednostki dla wybranego składnika: g, ml (płyny), jednostki kuchenne */
  protected readonly units = computed(() => {
    const d = this.draft();
    if (!d) return [];
    const item: LineItem = {
      kind: 'ingredient',
      id: d.ingredient.id,
      name: d.ingredient,
      density: d.ingredient.density,
      units: 'units' in d.ingredient ? d.ingredient.units : [],
    };
    return unitOptions(item, this.dictionaries()?.units ?? []);
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected startAdd(ingredient: Ingredient): void {
    const existing = this.items().find((i) => i.ingredient.id === ingredient.id);
    if (existing) {
      this.startEdit(existing);
      return;
    }
    this.draft.set({ id: null, ingredient, amount: '', unitCode: 'g', expiresOn: '' });
  }

  protected startEdit(item: PantryItem): void {
    this.draft.set({
      id: item.id,
      ingredient: item.ingredient,
      amount: item.amount ? String(item.amount).replace('.', this.lang() === 'en' ? '.' : ',') : '',
      unitCode: item.unitCode ?? 'g',
      expiresOn: item.expiresOn ?? '',
    });
  }

  protected patchDraft(patch: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    const n = parseDecimal(d.amount);
    const amount = n !== null && !Number.isNaN(n) && n > 0 ? n : null;
    const body = {
      amount,
      unitCode: amount ? d.unitCode : null,
      expiresOn: d.expiresOn || null,
    };
    await this.run(async () => {
      if (d.id) await this.api.update(d.id, body);
      else await this.api.upsert({ ingredientId: d.ingredient.id, ...body });
      this.draft.set(null);
      await this.load();
    });
  }

  protected async remove(item: PantryItem): Promise<void> {
    await this.run(async () => {
      await this.api.remove(item.id);
      this.items.update((list) => list.filter((i) => i.id !== item.id));
    });
  }

  protected expiryLabel(item: PantryItem): string {
    if (item.daysLeft === null) return '';
    if (item.daysLeft < 0) return this.transloco.translate('pantry.expired');
    if (item.daysLeft === 0) return this.transloco.translate('pantry.expiresToday');
    const forms = this.transloco.translate('pantry.dayForms');
    return this.transloco.translate('pantry.expiresIn', {
      days: `${item.daysLeft} ${pluralForm(forms, item.daysLeft, this.lang())}`,
    });
  }

  protected unitLabel(code: string): string {
    const u = this.units().find((x) => x.code === code);
    if (!u) return code;
    if (u.key) return this.transloco.translate(u.key);
    return this.lang() === 'en' && u.name?.nameEn ? u.name.nameEn : (u.name?.namePl ?? code);
  }

  private async load(): Promise<void> {
    try {
      this.items.set(await this.api.list());
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
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
