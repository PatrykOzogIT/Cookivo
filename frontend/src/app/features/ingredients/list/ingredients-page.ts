import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalizedPipe, NumberPipe } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { PageLayoutComponent } from '../../../layout/page-layout/page-layout';
import { CatalogTabsComponent } from '../../../shared/catalog-tabs';
import { PREFERENCE_ICONS } from '../../profile/preference-toggle';
import { IngredientsApi } from '../ingredients.api';
import type { Ingredient, IngredientQuery, IngredientStatus } from '../ingredients.models';

const PAGE_SIZE = 24;

@Component({
  selector: 'app-ingredients-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSlideToggleModule,
    TranslocoDirective,
    PageLayoutComponent,
    CatalogTabsComponent,
    LocalizedPipe,
    NumberPipe,
  ],
  templateUrl: './ingredients-page.html',
  styleUrl: './ingredients-page.scss',
})
export class IngredientsPage {
  private readonly api = inject(IngredientsApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;

  // Stan filtrów żyje w adresie URL (?q=&category=&allergens=&mine=&status=)
  readonly q = input<string>();
  readonly category = input<string>();
  readonly allergens = input<string>();
  readonly mine = input<string>();
  readonly status = input<IngredientStatus>();
  /** "Dla mnie" jest domyślnie włączone dla zalogowanych; forMe=0 wyłącza */
  readonly forMe = input<string>();
  protected readonly prefIcons = PREFERENCE_ICONS;
  protected readonly personalOn = computed(() => this.auth.isLoggedIn() && this.forMe() !== '0');

  protected readonly dictionaries = toSignal(this.api.dictionaries$);
  protected readonly search = new FormControl('', { nonNullable: true });

  protected readonly items = signal<Ingredient[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly excluded = computed(() => new Set((this.allergens() ?? '').split(',').filter(Boolean)));
  protected readonly activeFilters = computed(
    () => (this.category() ? 1 : 0) + this.excluded().size + (this.mine() ? 1 : 0) + (this.status() ? 1 : 0),
  );
  protected readonly hasMore = computed(() => this.items().length < this.total());

  private readonly query = computed<IngredientQuery>(() => ({
    q: this.q(),
    category: this.category(),
    excludeAllergens: [...this.excluded()],
    mine: this.mine() === '1',
    forMe: this.personalOn(),
    status: this.status(),
    lang: this.lang(),
    pageSize: PAGE_SIZE,
  }));

  constructor() {
    // Zmiana filtrów → pierwsza strona od nowa
    effect(() => {
      const query = this.query();
      untracked(() => {
        this.search.setValue(query.q ?? '', { emitEvent: false });
        void this.load(query, 1);
      });
    });

    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((q) => this.setParams({ q: q.trim() || null }));
  }

  protected loadMore(): void {
    void this.load(this.query(), this.page() + 1);
  }

  protected setCategory(code: string): void {
    this.setParams({ category: code || null });
  }

  protected toggleAllergen(code: string, exclude: boolean): void {
    const next = new Set(this.excluded());
    if (exclude) next.add(code);
    else next.delete(code);
    this.setParams({ allergens: [...next].join(',') || null });
  }

  protected setMine(mine: boolean): void {
    this.setParams({ mine: mine ? '1' : null, status: null });
  }

  protected setPendingOnly(pending: boolean): void {
    this.setParams({ status: pending ? 'PENDING' : null, mine: null });
  }

  protected clearFilters(): void {
    this.setParams({ category: null, allergens: null, mine: null, status: null });
  }

  /** Poziom preferencji do pokazania na karcie (składnik ma pierwszeństwo przed kategorią) */
  protected preference(i: Ingredient) {
    return i.personal?.preference ?? i.personal?.categoryPreference ?? null;
  }

  protected isMyAllergen(i: Ingredient, code: string): boolean {
    return i.personal?.myAllergens.includes(code) ?? false;
  }

  /** Energia i makro w skrócie do karty */
  protected macros(i: Ingredient) {
    return [
      { key: 'protein', value: i.nutrition.protein },
      { key: 'fat', value: i.nutrition.fat },
      { key: 'carbs', value: i.nutrition.carbs },
    ];
  }

  protected setParams(params: Record<string, string | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private async load(query: IngredientQuery, page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.list({ ...query, page });
      this.items.update((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
      this.total.set(res.total);
      this.page.set(page);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }
}
