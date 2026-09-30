import { Component, DestroyRef, computed, inject, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { IngredientsApi } from '../ingredients/ingredients.api';
import type { Ingredient } from '../ingredients/ingredients.models';
import { PreferenceToggleComponent } from './preference-toggle';
import {
  ProfileApi,
  type PreferenceLevel,
  type Preferences,
  type ProfileState,
  type Severity,
} from './profile.api';

@Component({
  selector: 'app-preferences-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
    LocalizedPipe,
    PreferenceToggleComponent,
  ],
  templateUrl: './preferences-page.html',
  styleUrl: './profile-pages.scss',
  styles: `
    .allergens {
      margin: 0;
      padding: 0;
      list-style: none;
      li {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) minmax(0, 320px);
        align-items: center;
        gap: 8px 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--ck-border);
      }
      .name {
        font-weight: 600;
      }
      mat-button-toggle-group {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        border-radius: 12px;
      }
      mat-button-toggle {
        min-height: 44px;
        font-size: 0.85rem;
      }
    }
    .prefs {
      margin: 0;
      padding: 0;
      list-style: none;
      li {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) auto;
        align-items: center;
        gap: 8px 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--ck-border);
      }
      .name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
      }
    }
    .search {
      width: 100%;
      margin-top: 12px;
    }
    @media (max-width: 599.98px) {
      .prefs li,
      .allergens li {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class PreferencesPage implements OnInit {
  private readonly api = inject(ProfileApi);
  private readonly ingredientsApi = inject(IngredientsApi);
  private readonly transloco = inject(TranslocoService);
  protected readonly lang = inject(LanguageService).current;
  protected readonly dictionaries = toSignal(this.ingredientsApi.dictionaries$);

  protected readonly profile = signal<ProfileState | null>(null);
  protected readonly prefs = signal<Preferences>({ ingredients: [], categories: [] });
  protected readonly allergenDraft = signal<Map<string, Severity>>(new Map());
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly savedAllergens = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly categoryLevel = computed(
    () => new Map(this.prefs().categories.map((c) => [c.code, c.level])),
  );

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
          q.trim().length < 2 ? [] : (await this.ingredientsApi.list({ q, pageSize: 8 })).items,
        );
      });
  }

  async ngOnInit(): Promise<void> {
    try {
      const [profile, prefs] = await Promise.all([this.api.get(), this.api.preferences()]);
      this.setProfile(profile);
      this.prefs.set(prefs);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected severity(code: string): Severity | 'NONE' {
    return this.allergenDraft().get(code) ?? 'NONE';
  }

  protected setSeverity(code: string, value: Severity | 'NONE'): void {
    this.allergenDraft.update((map) => {
      const next = new Map(map);
      if (value === 'NONE') next.delete(code);
      else next.set(code, value);
      return next;
    });
  }

  protected async giveConsent(): Promise<void> {
    await this.run(async () => this.setProfile(await this.api.setHealthConsent(true)));
  }

  protected async saveAllergens(): Promise<void> {
    await this.run(async () => {
      const allergens = [...this.allergenDraft()].map(([code, severity]) => ({ code, severity }));
      this.setProfile(await this.api.setAllergens(allergens));
      this.savedAllergens.set(true);
      setTimeout(() => this.savedAllergens.set(false), 3000);
    });
  }

  protected async setCategory(code: string, level: PreferenceLevel | null): Promise<void> {
    await this.run(async () => this.prefs.set(await this.api.setCategoryPreference(code, level)));
  }

  protected async setIngredient(id: string, level: PreferenceLevel | null): Promise<void> {
    await this.run(async () => this.prefs.set(await this.api.setIngredientPreference(id, level)));
  }

  protected async addIngredient(event: MatAutocompleteSelectedEvent): Promise<void> {
    const ingredient = event.option.value as Ingredient;
    this.search.setValue('');
    this.results.set([]);
    await this.setIngredient(ingredient.id, 'LIKE');
  }

  protected displayName = (i: Ingredient | string) =>
    typeof i === 'string' ? i : this.lang() === 'en' && i.nameEn ? i.nameEn : i.namePl;

  protected levelLabel(name: string): string {
    return this.transloco.translate('profile.preferences.levelFor', { name });
  }

  private setProfile(state: ProfileState): void {
    this.profile.set(state);
    this.allergenDraft.set(new Map(state.allergens.map((a) => [a.code, a.severity])));
  }

  private async run(fn: () => Promise<void>): Promise<void> {
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
