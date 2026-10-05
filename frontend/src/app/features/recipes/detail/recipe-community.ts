import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalizedPipe, NumberPipe } from '../../../core/i18n/format.pipes';
import { RecipesApi } from '../recipes.api';
import type { RatingItem, RatingSummary, RecipeDetail, VariantSummary } from '../recipes.models';
import { StarInputComponent } from './star-input';
import { StarsComponent } from './stars';

/** Różnice wariantu względem oglądanego przepisu: kcal na porcję i alergeny */
export function variantDiff(current: RecipeDetail, v: VariantSummary) {
  const own = new Set(current.allergens.map((a) => a.code));
  const theirs = new Set(v.allergens.map((a) => a.code));
  return {
    kcal: Math.round(v.kcalPerServing - current.kcalPerServing),
    without: current.allergens.filter((a) => !theirs.has(a.code)),
    with: v.allergens.filter((a) => !own.has(a.code)),
  };
}

@Component({
  selector: 'app-recipe-community',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
    LocalizedPipe,
    NumberPipe,
    StarsComponent,
    StarInputComponent,
  ],
  templateUrl: './recipe-community.html',
  styleUrl: './recipe-community.scss',
})
export class RecipeCommunityComponent {
  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  readonly recipe = input.required<RecipeDetail>();
  readonly lang = input('pl');
  /** Nowa średnia po ocenie - rodzic aktualizuje nagłówek */
  readonly rated = output<RatingSummary>();

  protected readonly variants = signal<VariantSummary[]>([]);
  protected readonly ratings = signal<RatingItem[]>([]);
  protected readonly ratingsTotal = signal(0);
  private ratingsPage = 1;

  protected readonly stars = signal<number | null>(null);
  protected comment = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  protected readonly canRate = computed(() => this.auth.isLoggedIn() && !this.recipe().isOwn);
  protected readonly hasMoreRatings = computed(() => this.ratings().length < this.ratingsTotal());

  constructor() {
    effect(() => {
      const r = this.recipe();
      untracked(() => {
        this.stars.set(r.myRating?.stars ?? null);
        this.comment = r.myRating?.comment ?? '';
        void this.load(r);
      });
    });
  }

  protected diff(v: VariantSummary) {
    return variantDiff(this.recipe(), v);
  }

  /** "Zrób własną wersję": kopia i od razu formularz edycji */
  protected async makeVariant(): Promise<void> {
    await this.run(async () => {
      const created = await this.api.createVariant(this.recipe().id);
      await this.router.navigate(['/recipes', created.id, 'edit']);
    });
  }

  protected async saveRating(): Promise<void> {
    const s = this.stars();
    if (!s) return;
    await this.run(async () => {
      this.rated.emit(await this.api.rate(this.recipe().id, s, this.comment.trim() || undefined));
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 3000);
      await this.loadRatings(1);
    });
  }

  protected async removeRating(): Promise<void> {
    await this.run(async () => {
      this.rated.emit(await this.api.removeRating(this.recipe().id));
      this.stars.set(null);
      this.comment = '';
      await this.loadRatings(1);
    });
  }

  protected async moreRatings(): Promise<void> {
    await this.run(() => this.loadRatings(this.ratingsPage + 1));
  }

  private async load(r: RecipeDetail): Promise<void> {
    const [variants] = await Promise.all([
      r.variantsCount > 0 || r.variantOf ? this.api.variants(r.id).catch(() => null) : null,
      this.loadRatings(1).catch(() => undefined),
    ]);
    this.variants.set(variants?.items ?? []);
  }

  private async loadRatings(page: number): Promise<void> {
    const res = await this.api.ratings(this.recipe().id, page);
    this.ratings.update((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
    this.ratingsTotal.set(res.total);
    this.ratingsPage = page;
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
