import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged, startWith } from 'rxjs';
import { apiErrorCode } from '../../core/api-error';
import { NumberPipe } from '../../core/i18n/format.pipes';
import { RecipesApi } from '../recipes/recipes.api';
import { pluralForm } from '../recipes/unit-plural';
import type { RecipeSummary } from '../recipes/recipes.models';
import { formatDay, formatServings } from './plan-math';
import { PlannerApi, type Leftover } from './planner.api';
import { ServingsStepperComponent } from './servings-stepper';

export interface AddMealData {
  date: string;
  slot: string;
  /** Np. "Obiad · pon. 5 paź" */
  heading: string;
  people: number;
  freshDays: number;
  leftovers: Leftover[];
  /** Typ posiłku do podpowiedzi przepisów (null dla własnych posiłków) */
  mealType: string | null;
  household: boolean;
  lang: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-add-meal-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    TranslocoDirective,
    NumberPipe,
    ServingsStepperComponent,
  ],
  templateUrl: './add-meal-dialog.html',
  styleUrl: './planner-dialogs.scss',
})
export class AddMealDialog {
  protected readonly data = inject<AddMealData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<AddMealDialog, boolean>);
  private readonly recipesApi = inject(RecipesApi);
  private readonly planner = inject(PlannerApi);
  private readonly transloco = inject(TranslocoService);

  protected readonly source = signal<'recipe' | 'leftover'>(
    this.data.leftovers.length ? 'leftover' : 'recipe',
  );
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly matchSlot = signal(!!this.data.mealType);
  protected readonly results = signal<RecipeSummary[]>([]);
  protected readonly searching = signal(false);
  protected readonly selected = signal<RecipeSummary | null>(null);
  protected readonly leftover = signal<Leftover | null>(null);

  protected readonly servings = signal(this.data.people);
  protected readonly cookAhead = signal(false);
  protected readonly cookServings = signal(this.data.people * 2);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly maxFromLeftover = computed(() => this.leftover()?.remaining ?? 50);
  /** Resztki starsze niż próg świeżości w dniu posiłku */
  protected readonly leftoverStale = computed(() => {
    const l = this.leftover();
    if (!l) return false;
    return (Date.parse(this.data.date) - Date.parse(l.date)) / DAY_MS > this.data.freshDays;
  });
  protected readonly fmt = (n: number) => formatServings(n, this.data.lang);
  /** "2 porcje" / "5 porcji" */
  protected readonly portions = (n: number) =>
    `${this.fmt(n)} ${pluralForm(this.transloco.translate('planner.portionForms'), n, this.data.lang)}`;
  protected readonly day = (iso: string) => formatDay(iso, this.data.lang);

  constructor() {
    this.search.valueChanges
      .pipe(startWith(''), debounceTime(250), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => void this.load());
  }

  protected setMatchSlot(on: boolean): void {
    this.matchSlot.set(on);
    void this.load();
  }

  protected pickLeftover(l: Leftover): void {
    this.leftover.set(l);
    this.servings.set(Math.min(this.data.people, l.remaining));
  }

  protected setCookAhead(on: boolean): void {
    this.cookAhead.set(on);
    if (on && this.cookServings() <= this.servings()) this.cookServings.set(this.servings() * 2);
  }

  protected canSave(): boolean {
    return this.source() === 'recipe' ? !!this.selected() : !!this.leftover();
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const base = { date: this.data.date, slot: this.data.slot, servings: this.servings() };
      if (this.source() === 'recipe') {
        const cookServings = this.cookAhead() ? Math.max(this.cookServings(), this.servings()) : undefined;
        await this.planner.addMeal({ ...base, recipeId: this.selected()!.id, cookServings });
      } else {
        await this.planner.addMeal({ ...base, cookId: this.leftover()!.cookId });
      }
      this.ref.close(true);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.searching.set(true);
    try {
      const page = await this.recipesApi.list({
        q: this.search.value.trim() || undefined,
        mealTypes: this.matchSlot() && this.data.mealType ? [this.data.mealType] : [],
        forMe: !this.data.household,
        forUs: this.data.household,
        sort: 'forYou',
        lang: this.data.lang,
        pageSize: 12,
      });
      this.results.set(page.items);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.searching.set(false);
    }
  }
}
