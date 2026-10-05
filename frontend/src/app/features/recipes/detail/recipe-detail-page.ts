import { Component, computed, effect, inject, input, signal, untracked, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalizedPipe, NumberPipe } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { NutritionTableComponent } from '../../../shared/nutrition-table/nutrition-table';
import { AmountLabelPipe } from '../amount-label.pipe';
import { scaleAmount } from '../recipe-units';
import { formatMoney, PricesApi, type Cost } from '../../prices/prices.api';
import { ShoppingApi, type AddResult } from '../../shopping/shopping.api';
import { RecipesApi } from '../recipes.api';
import { ReportDialog, type ReportDialogData } from '../../moderation/report-dialog';
import { RecipeCommunityComponent } from './recipe-community';
import { StarsComponent } from './stars';
import type { RatingSummary, RecipeDetail, RecipeLine } from '../recipes.models';

export interface LineGroup {
  name: string | null;
  lines: RecipeLine[];
}

/** Grupuje pozycje po nazwie grupy, zachowując kolejność pierwszego wystąpienia. */
export function groupLines(lines: RecipeLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const name = line.groupName ?? null;
    const last = groups.at(-1);
    if (last && last.name === name) last.lines.push(line);
    else groups.push({ name, lines: [line] });
  }
  return groups;
}

@Component({
  selector: 'app-recipe-detail-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
    NutritionTableComponent,
    RecipeCommunityComponent,
    MatMenuModule,
    StarsComponent,
    LocalizedPipe,
    NumberPipe,
    AmountLabelPipe,
  ],
  templateUrl: './recipe-detail-page.html',
  styleUrl: './recipe-detail-page.scss',
})
export class RecipeDetailPage implements OnInit {
  private readonly api = inject(RecipesApi);
  private readonly shopping = inject(ShoppingApi);
  protected readonly shoppingBusy = signal(false);
  protected readonly shoppingResult = signal<AddResult | null>(null);
  private readonly pricesApi = inject(PricesApi);
  /** Szacowany koszt wg domyślnego cennika (undefined = jeszcze nie wiadomo) */
  protected readonly cost = signal<Cost | null | undefined>(undefined);
  private costTimer?: ReturnType<typeof setTimeout>;
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;

  readonly id = input.required<string>();

  protected readonly recipe = signal<RecipeDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly servings = signal(1);

  constructor() {
    // Ta sama strona dla innego przepisu (Angular używa ponownie komponentu) - wczytujemy od nowa
    let loadedId: string | undefined;
    effect(() => {
      const id = this.id();
      if (loadedId !== undefined && id !== loadedId) untracked(() => void this.load(id));
      loadedId = id;
    });
    // Koszt przeliczamy po zmianie porcji (z krótkim opóźnieniem przy szybkim klikaniu)
    effect(() => {
      const r = this.recipe();
      const servings = this.servings();
      if (!r || !this.auth.isLoggedIn()) return;
      untracked(() => {
        clearTimeout(this.costTimer);
        this.costTimer = setTimeout(async () => {
          this.cost.set(await this.pricesApi.recipeCost(r.id, servings).catch(() => null));
        }, 250);
      });
    });
  }

  private readonly dialog = inject(MatDialog);

  /** Zgłoszenie przepisu albo jego autora */
  protected report(targetType: 'RECIPE' | 'USER'): void {
    const r = this.recipe();
    if (!r) return;
    const data: ReportDialogData =
      targetType === 'RECIPE'
        ? { target: { targetType, recipeId: r.id }, label: r.title }
        : { target: { targetType, userId: r.author!.id }, label: r.author!.username };
    this.dialog.open(ReportDialog, { width: '480px', maxWidth: '100vw', data });
  }

  /** Po ocenie: nowa średnia w nagłówku */
  protected onRated(summary: RatingSummary): void {
    this.recipe.update((r) => (r ? { ...r, ...summary } : r));
  }

  protected money(cents: number, currency: string): string {
    return formatMoney(cents, currency, this.lang());
  }

  protected missingNames(c: Cost): string {
    const lang = this.lang();
    return c.missing.map((m) => (lang === 'en' && m.nameEn ? m.nameEn : m.namePl)).join(', ');
  }

  /** Składniki na wybraną liczbę porcji (z podprzepisami) trafiają na wspólną listę zakupów */
  protected async toShopping(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    this.shoppingBusy.set(true);
    try {
      this.shoppingResult.set(await this.shopping.fromRecipe(r.id, this.servings()));
    } finally {
      this.shoppingBusy.set(false);
    }
  }
  protected readonly photoIndex = signal(0);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly hiding = signal(false);
  protected hideReason = '';

  protected readonly factor = computed(() => {
    const r = this.recipe();
    return r ? this.servings() / r.servings : 1;
  });
  /** Alergeny z listy użytkownika obecne w przepisie (nazwy po przecinku) */
  protected readonly myAllergenNames = computed(() => {
    const r = this.recipe();
    const mine = new Set(r?.myAllergens ?? []);
    const lang = this.lang();
    return (r?.allergens ?? [])
      .filter((a) => mine.has(a.code))
      .map((a) => (lang === 'en' && a.nameEn ? a.nameEn : a.namePl))
      .join(', ');
  });
  protected readonly groups = computed(() => groupLines(this.recipe()?.ingredients ?? []));
  protected readonly photo = computed(() => this.recipe()?.photos[this.photoIndex()] ?? null);

  async ngOnInit(): Promise<void> {
    await this.load(this.id());
  }

  /** Wczytanie przepisu - także po przejściu na inny przepis z tej samej strony (link do oryginału, podprzepisu) */
  private async load(id: string): Promise<void> {
    this.error.set(null);
    this.shoppingResult.set(null);
    this.cost.set(undefined);
    this.photoIndex.set(0);
    this.confirmDelete.set(false);
    this.hiding.set(false);
    try {
      const r = await this.api.get(id);
      this.recipe.set(r);
      this.servings.set(r.servings);
      this.title.setTitle(`${r.title} · Cookivo`);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }

  protected scaled(line: RecipeLine): number {
    return scaleAmount(line.amount, this.factor(), line.unitCode);
  }

  protected changeServings(delta: number): void {
    this.servings.update((s) => Math.min(100, Math.max(1, s + delta)));
  }

  protected totalMinutes(r: RecipeDetail): number {
    return (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.remove(this.id());
      await this.router.navigate(['/recipes'], { queryParams: { mine: '1' } });
    } catch (err) {
      this.actionError.set(apiErrorCode(err));
      this.busy.set(false);
    }
  }

  protected async setHidden(hide: boolean): Promise<void> {
    if (hide && this.hideReason.trim().length < 3) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.recipe.set(
        hide ? await this.api.hide(this.id(), this.hideReason.trim()) : await this.api.unhide(this.id()),
      );
      this.hiding.set(false);
    } catch (err) {
      this.actionError.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
