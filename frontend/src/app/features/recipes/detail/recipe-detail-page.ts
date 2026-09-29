import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
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
import { RecipesApi } from '../recipes.api';
import type { RecipeDetail, RecipeLine } from '../recipes.models';

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
    LocalizedPipe,
    NumberPipe,
    AmountLabelPipe,
  ],
  templateUrl: './recipe-detail-page.html',
  styleUrl: './recipe-detail-page.scss',
})
export class RecipeDetailPage implements OnInit {
  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;

  readonly id = input.required<string>();

  protected readonly recipe = signal<RecipeDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly servings = signal(1);
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
  protected readonly groups = computed(() => groupLines(this.recipe()?.ingredients ?? []));
  protected readonly photo = computed(() => this.recipe()?.photos[this.photoIndex()] ?? null);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.api.get(this.id());
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
