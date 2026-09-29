import { Component, DestroyRef, inject, input, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { LocalizedPipe } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { IngredientsApi } from '../../ingredients/ingredients.api';
import type { LineItem } from '../recipe-units';
import { RecipesApi } from '../recipes.api';

let nextId = 0;

/**
 * Pole "składnik" w przepisie: wpisujesz, podpowiada składniki z bazy
 * i przepisy oznaczone jako "może być składnikiem". Wybór trafia do `control`.
 */
@Component({
  selector: 'app-line-item-picker',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
    LocalizedPipe,
  ],
  template: `
    <mat-form-field *transloco="let t" subscriptSizing="dynamic" class="field">
      <mat-label>{{ t('recipes.form.ingredient') }}</mat-label>
      <input
        matInput
        [id]="inputId"
        [formControl]="search"
        [matAutocomplete]="auto"
        autocomplete="off"
        (blur)="restoreLabel()"
        required
      />
      <mat-autocomplete
        #auto="matAutocomplete"
        (optionSelected)="select($event)"
        [displayWith]="display"
        autoActiveFirstOption
      >
        @if (ingredients().length) {
          <mat-optgroup [label]="t('nav.ingredients')">
            @for (i of ingredients(); track i.id) {
              <mat-option [value]="i">{{ i.name | localized: lang() }}</mat-option>
            }
          </mat-optgroup>
        }
        @if (recipes().length) {
          <mat-optgroup [label]="t('recipes.form.asIngredientGroup')">
            @for (r of recipes(); track r.id) {
              <mat-option [value]="r">{{ r.name.namePl }}</mat-option>
            }
          </mat-optgroup>
        }
        @if (searched() && !ingredients().length && !recipes().length) {
          <mat-option disabled>{{ t('recipes.form.noMatches') }}</mat-option>
        }
      </mat-autocomplete>
      @if (control().invalid && control().touched) {
        <mat-error>{{ t('recipes.form.pickIngredient') }}</mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 100%;
    }
  `,
})
export class LineItemPickerComponent implements OnInit {
  private readonly ingredientsApi = inject(IngredientsApi);
  private readonly recipesApi = inject(RecipesApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly lang = inject(LanguageService).current;

  readonly control = input.required<FormControl<LineItem | null>>();
  /** Nie podpowiadaj edytowanego przepisu jako własnego składnika */
  readonly excludeRecipeId = input<string>();

  protected readonly inputId = `ck-line-item-${nextId++}`;
  protected readonly search = new FormControl<string | LineItem>('', { nonNullable: true });
  protected readonly ingredients = signal<LineItem[]>([]);
  protected readonly recipes = signal<LineItem[]>([]);
  protected readonly searched = signal(false);

  protected readonly display = (v: string | LineItem | null) =>
    !v
      ? ''
      : typeof v === 'string'
        ? v
        : this.lang() === 'en' && v.name.nameEn
          ? v.name.nameEn
          : v.name.namePl;

  ngOnInit(): void {
    const current = this.control().value;
    if (current) this.search.setValue(current, { emitEvent: false });

    this.search.valueChanges
      .pipe(
        filter((v): v is string => typeof v === 'string'),
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        // Użytkownik zmienia tekst → dotychczasowy wybór przestaje obowiązywać
        if (this.control().value) this.control().setValue(null);
        void this.lookup(q.trim());
      });
  }

  protected select(event: MatAutocompleteSelectedEvent): void {
    const item = event.option.value as LineItem;
    this.control().setValue(item);
    this.control().markAsTouched();
  }

  /** Po wyjściu z pola bez wyboru przywróć nazwę wybranej pozycji (albo oznacz błąd). */
  protected restoreLabel(): void {
    this.control().markAsTouched();
    const selected = this.control().value;
    if (selected && typeof this.search.value === 'string')
      this.search.setValue(selected, { emitEvent: false });
  }

  private async lookup(q: string): Promise<void> {
    if (q.length < 2) {
      this.ingredients.set([]);
      this.recipes.set([]);
      this.searched.set(false);
      return;
    }
    const [ings, recs] = await Promise.all([
      this.ingredientsApi.list({ q, pageSize: 8, lang: this.lang() }),
      this.recipesApi.list({ q, canBeIngredient: true, pageSize: 5, lang: this.lang() }),
    ]);
    this.ingredients.set(
      ings.items.map((i) => ({
        kind: 'ingredient',
        id: i.id,
        name: { namePl: i.namePl, nameEn: i.nameEn },
        density: i.density,
        units: i.units,
      })),
    );
    this.recipes.set(
      recs.items
        .filter((r) => r.id !== this.excludeRecipeId())
        .map((r) => ({ kind: 'recipe', id: r.id, name: { namePl: r.title }, servings: r.servings })),
    );
    this.searched.set(true);
  }
}
