import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  type MatAutocompleteSelectedEvent,
  type MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { IngredientsApi } from '../ingredients/ingredients.api';
import type { Ingredient } from '../ingredients/ingredients.models';

/** Pole z podpowiedziami składników z bazy. Po wyborze emituje składnik i czyści się. */
@Component({
  selector: 'app-ingredient-picker',
  imports: [ReactiveFormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, LocalizedPipe],
  template: `
    <mat-form-field class="picker" subscriptSizing="dynamic">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        [formControl]="search"
        [matAutocomplete]="auto"
        #trigger="matAutocompleteTrigger"
        autocomplete="off"
        enterkeyhint="search"
        (keydown.enter)="enterText(trigger)"
      />
      <mat-autocomplete #auto="matAutocomplete" [displayWith]="display" (optionSelected)="pick($event)">
        @for (r of results(); track r.id) {
          <mat-option [value]="r">
            <span class="material-symbols-rounded" aria-hidden="true">{{ r.category.icon }}</span>
            {{ r | localized: lang() }}
          </mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: `
    .picker {
      width: 100%;
    }
    .material-symbols-rounded {
      margin-right: 6px;
      vertical-align: middle;
    }
  `,
})
export class IngredientPickerComponent {
  private readonly api = inject(IngredientsApi);
  protected readonly lang = inject(LanguageService).current;

  readonly label = input.required<string>();
  /** Czy Enter z wpisanym tekstem ma zgłosić własną pozycję (lista zakupów) */
  readonly allowText = input(false);
  readonly picked = output<Ingredient>();
  readonly text = output<string>();

  protected readonly search = new FormControl<string | Ingredient>('', { nonNullable: true });
  protected readonly results = signal<Ingredient[]>([]);

  constructor() {
    this.search.valueChanges
      .pipe(
        filter((v): v is string => typeof v === 'string'),
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(async (q) => {
        this.results.set(
          q.trim().length < 2 ? [] : (await this.api.list({ q, pageSize: 8, lang: this.lang() })).items,
        );
      });
  }

  protected pick(event: MatAutocompleteSelectedEvent): void {
    this.picked.emit(event.option.value as Ingredient);
    this.search.setValue('');
    this.results.set([]);
  }

  /** Enter bez wybrania podpowiedzi = własna pozycja o wpisanej nazwie */
  protected enterText(trigger: MatAutocompleteTrigger): void {
    const v = this.search.value;
    // Aktywna podpowiedź: Enter wybiera ją (obsłuży optionSelected)
    if (!this.allowText() || trigger.activeOption || typeof v !== 'string' || !v.trim()) return;
    this.text.emit(v.trim());
    this.search.setValue('');
    this.results.set([]);
  }

  protected display = (i: Ingredient | string) =>
    typeof i === 'string' ? i : this.lang() === 'en' && i.nameEn ? i.nameEn : i.namePl;
}
