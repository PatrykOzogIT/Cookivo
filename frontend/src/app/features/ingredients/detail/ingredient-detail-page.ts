import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalizedPipe, NumberPipe, formatNumber, parseDecimal } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { NutritionTableComponent } from '../../../shared/nutrition-table/nutrition-table';
import { IngredientsApi } from '../ingredients.api';
import type { Ingredient } from '../ingredients.models';
import { portionGrams, portionUnits } from '../portion';

@Component({
  selector: 'app-ingredient-detail-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslocoDirective,
    NutritionTableComponent,
    LocalizedPipe,
    NumberPipe,
  ],
  templateUrl: './ingredient-detail-page.html',
  styleUrl: './ingredient-detail-page.scss',
})
export class IngredientDetailPage implements OnInit {
  private readonly api = inject(IngredientsApi);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;

  /** Parametr trasy :id */
  readonly id = input.required<string>();

  protected readonly ingredient = signal<Ingredient | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly rejecting = signal(false);
  protected readonly confirmDelete = signal(false);
  protected rejectReason = '';

  private readonly dictionaries = toSignal(this.api.dictionaries$);
  protected readonly units = computed(() => {
    const i = this.ingredient();
    return i ? portionUnits(i, this.dictionaries()?.units ?? []) : [];
  });

  // Kalkulator porcji
  protected readonly amountText = signal('1');
  protected readonly unitCode = signal('g');
  protected readonly portion = computed(() => {
    const unit = this.units().find((u) => u.code === this.unitCode());
    return portionGrams(parseDecimal(this.amountText()) ?? Number.NaN, unit);
  });
  protected readonly portionLabel = computed(() => {
    const g = this.portion();
    if (!g) return '';
    const unit = this.units().find((u) => u.code === this.unitCode());
    if (unit?.code === 'g') return `${formatNumber(g, this.lang())} g`;
    return `${this.amountText()} × ${this.unitLabel(unit)} (${formatNumber(g, this.lang())} g)`;
  });

  async ngOnInit(): Promise<void> {
    try {
      const ingredient = await this.api.get(this.id());
      this.ingredient.set(ingredient);
      // Tytuł karty = nazwa składnika (czytniki ekranu i historia przeglądarki)
      const name = this.lang() === 'en' && ingredient.nameEn ? ingredient.nameEn : ingredient.namePl;
      this.title.setTitle(`${name} · Cookivo`);
      // Domyślnie pierwsza "kuchenna" jednostka, jeśli jest (np. 1 sztuka jajka)
      const first = ingredient.units[0];
      if (first) this.unitCode.set(first.code);
      else this.amountText.set('100');
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }

  protected unitLabel(unit: ReturnType<typeof portionUnits>[number] | undefined): string {
    if (!unit) return '';
    if (unit.key) return unit.key === 'units.ml' ? 'ml' : 'g';
    return this.lang() === 'en' && unit.name?.nameEn ? unit.name.nameEn : (unit.name?.namePl ?? '');
  }

  protected usdaUrl(i: Ingredient): string {
    return `https://fdc.nal.usda.gov/food-details/${i.sourceRef}/nutrients`;
  }

  protected async approve(): Promise<void> {
    await this.act(() => this.api.approve(this.id()));
  }

  protected async reject(): Promise<void> {
    if (this.rejectReason.trim().length < 3) return;
    await this.act(() => this.api.reject(this.id(), this.rejectReason.trim()));
    this.rejecting.set(false);
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.remove(this.id());
      await this.router.navigate(['/ingredients'], {
        queryParams: { mine: this.auth.isAdmin() ? null : '1' },
      });
    } catch (err) {
      this.actionError.set(apiErrorCode(err));
      this.busy.set(false);
    }
  }

  private async act(fn: () => Promise<Ingredient>): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.ingredient.set(await fn());
    } catch (err) {
      this.actionError.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
