import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { apiErrorCode } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LocalizedPipe, NumberPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { PageLayoutComponent } from '../../layout/page-layout/page-layout';
import { CatalogTabsComponent } from '../../shared/catalog-tabs';
import { IngredientsApi } from '../ingredients/ingredients.api';
import { RecipesApi } from './recipes.api';
import type { RecipeQuery, RecipeSummary } from './recipes.models';

const PAGE_SIZE = 24;
export const KCAL_LIMITS = [300, 500, 700] as const;
export const TIME_LIMITS = [15, 30, 60] as const;
type Sort = NonNullable<RecipeQuery['sort']>;

@Component({
  selector: 'app-recipes-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    TranslocoDirective,
    PageLayoutComponent,
    CatalogTabsComponent,
    LocalizedPipe,
    NumberPipe,
  ],
  templateUrl: './recipes-page.html',
  styleUrl: './recipes-page.scss',
})
export class RecipesPage {
  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;
  protected readonly dictionaries = toSignal(inject(IngredientsApi).dictionaries$);

  // Filtry w adresie URL
  readonly q = input<string>();
  readonly meal = input<string>();
  readonly allergens = input<string>();
  readonly kcal = input<string>();
  readonly time = input<string>();
  readonly asIngredient = input<string>();
  readonly mine = input<string>();
  readonly sort = input<Sort>();

  protected readonly kcalLimits = KCAL_LIMITS;
  protected readonly timeLimits = TIME_LIMITS;
  protected readonly sorts: Sort[] = ['newest', 'name', 'kcal', 'time'];
  protected readonly search = new FormControl('', { nonNullable: true });

  protected readonly items = signal<RecipeSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly meals = computed(() => new Set(splitList(this.meal())));
  protected readonly excluded = computed(() => new Set(splitList(this.allergens())));
  protected readonly activeFilters = computed(
    () =>
      this.meals().size +
      this.excluded().size +
      (this.kcal() ? 1 : 0) +
      (this.time() ? 1 : 0) +
      (this.asIngredient() ? 1 : 0) +
      (this.mine() ? 1 : 0),
  );
  protected readonly hasMore = computed(() => this.items().length < this.total());

  private readonly query = computed<RecipeQuery>(() => ({
    q: this.q(),
    mealTypes: [...this.meals()],
    excludeAllergens: [...this.excluded()],
    maxKcal: toNumber(this.kcal()),
    maxMinutes: toNumber(this.time()),
    canBeIngredient: this.asIngredient() === '1',
    mine: this.mine() === '1',
    sort: this.sort() ?? 'newest',
    lang: this.lang(),
    pageSize: PAGE_SIZE,
  }));

  constructor() {
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

  protected toggleIn(param: 'meal' | 'allergens', current: Set<string>, code: string, on: boolean): void {
    const next = new Set(current);
    if (on) next.add(code);
    else next.delete(code);
    this.setParams({ [param]: [...next].join(',') || null });
  }

  protected setParams(params: Record<string, string | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected clearFilters(): void {
    this.setParams({ meal: null, allergens: null, kcal: null, time: null, asIngredient: null, mine: null });
  }

  protected loadMore(): void {
    void this.load(this.query(), this.page() + 1);
  }

  protected totalMinutes(r: RecipeSummary): number | null {
    const t = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
    return t > 0 ? t : null;
  }

  private async load(query: RecipeQuery, page: number): Promise<void> {
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

function splitList(v: string | undefined): string[] {
  return (v ?? '').split(',').filter(Boolean);
}

function toNumber(v: string | undefined): number | undefined {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
