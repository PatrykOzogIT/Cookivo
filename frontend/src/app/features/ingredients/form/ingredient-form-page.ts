import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
  type FormControl,
  type FormGroup,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalizedPipe, formatNumber, parseDecimal } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { IngredientsApi } from '../ingredients.api';
import type { Ingredient, SaveIngredient } from '../ingredients.models';
import {
  decimalValidator,
  estimateKcal,
  kcalMismatch,
  nutritionGroupValidator,
} from './nutrition-validators';
import { LabelImportPanel } from './label-import-panel';
import { LabelImportApi, type LabelDraft, type SimilarIngredient } from './label-import.api';

type UnitRow = FormGroup<{ code: FormControl<string>; grams: FormControl<string> }>;

/**
 * Pola wartości odżywczych w kolejności z etykiety UE. `rowStart` zaczyna nowy wiersz siatki,
 * dzięki czemu "w tym nasycone" stoi obok tłuszczu, a "w tym cukry" obok węglowodanów.
 */
export const NUTRIENT_FIELDS = [
  { name: 'kcal', required: true, max: 900, unit: 'kcal', rowStart: true },
  { name: 'fat', required: true, max: 100, unit: 'g', rowStart: true },
  { name: 'saturatedFat', required: false, max: 100, unit: 'g', rowStart: false },
  { name: 'carbs', required: true, max: 100, unit: 'g', rowStart: true },
  { name: 'sugars', required: false, max: 100, unit: 'g', rowStart: false },
  { name: 'fiber', required: false, max: 100, unit: 'g', rowStart: true },
  { name: 'protein', required: true, max: 100, unit: 'g', rowStart: false },
  { name: 'salt', required: false, max: 100, unit: 'g', rowStart: true },
] as const;

type NutrientName = (typeof NUTRIENT_FIELDS)[number]['name'];

@Component({
  selector: 'app-ingredient-form-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    TranslocoDirective,
    LocalizedPipe,
    LabelImportPanel,
  ],
  templateUrl: './ingredient-form-page.html',
  styleUrl: './ingredient-form-page.scss',
})
export class IngredientFormPage implements OnInit {
  private readonly api = inject(IngredientsApi);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LanguageService).current;

  /** Parametr trasy :id - obecny tylko przy edycji */
  readonly id = input<string>();
  /** ?name= - nazwa z prośby o składnik (panel admina) */
  readonly name = input<string>();

  protected readonly fields = NUTRIENT_FIELDS;
  protected readonly dictionaries = toSignal(this.api.dictionaries$);

  protected readonly form = this.fb.group({
    namePl: this.fb.control('', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]),
    nameEn: this.fb.control('', [Validators.maxLength(120)]),
    categoryCode: this.fb.control('', [Validators.required]),
    nutrition: this.fb.group(
      Object.fromEntries(
        NUTRIENT_FIELDS.map((f) => [
          f.name,
          this.fb.control(
            '',
            f.required ? [Validators.required, decimalValidator(0, f.max)] : [decimalValidator(0, f.max)],
          ),
        ]),
      ) as Record<NutrientName, FormControl<string>>,
      { validators: nutritionGroupValidator },
    ),
    liquid: this.fb.control(false),
    density: this.fb.control('', [decimalValidator(0.2, 3)]),
    allergens: this.fb.control<string[]>([]),
    units: this.fb.array<UnitRow>([]),
  });

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly duplicateId = signal<string | null>(null);
  /** Ostatni odczyt etykiety (podsumowanie: co sprawdzić i uzupełnić) */
  protected readonly labelDraft = signal<LabelDraft | null>(null);
  /** Możliwe duble (sprawdzane przy wpisywaniu nazwy nowego składnika) */
  protected readonly similar = signal<SimilarIngredient[]>([]);
  private readonly labels = inject(LabelImportApi);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  private readonly nutritionValue = toSignal(this.form.controls.nutrition.valueChanges, {
    initialValue: this.form.controls.nutrition.getRawValue(),
  });
  /** Ostrzeżenie o niespójnych kaloriach (liczone "na żywo") */
  protected readonly energyHint = computed(() => {
    const n = this.nutritionValue();
    const [kcal, protein, fat, carbs] = [n.kcal, n.protein, n.fat, n.carbs].map((v) => parseDecimal(v));
    if ([kcal, protein, fat, carbs].some((v) => v === null || Number.isNaN(v))) return null;
    const fiber = parseDecimal(n.fiber) ?? 0;
    const estimated = estimateKcal(protein!, fat!, carbs!, Number.isNaN(fiber) ? 0 : fiber);
    return kcalMismatch(kcal!, estimated) ? Math.round(estimated) : null;
  });

  protected get unitRows(): FormArray<UnitRow> {
    return this.form.controls.units;
  }

  constructor() {
    // Nowy składnik: po chwili od wpisania nazwy sprawdzamy, czy taki już nie istnieje
    this.form.controls.namePl.valueChanges
      .pipe(debounceTime(600), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((name) => void this.checkSimilar(name));
  }

  private async checkSimilar(name: string): Promise<void> {
    const q = name.trim();
    if (this.id() || q.length < 3) {
      this.similar.set([]);
      return;
    }
    try {
      const found = await this.labels.similar(q, this.form.controls.nameEn.value.trim());
      if (this.form.controls.namePl.value.trim() === q) this.similar.set(found);
    } catch {
      // Ostrzeżenie jest pomocą - błąd sieci nie blokuje formularza
    }
  }

  /** Szkic z etykiety → formularz (wszystko do sprawdzenia; czego nie odczytano, zostaje puste) */
  protected applyLabel(d: LabelDraft): void {
    const text = (value: number | null) =>
      value === null ? '' : formatNumber(value, this.lang(), 2).replace(/\s/g, '');
    const c = this.form.controls;
    if (d.namePl) c.namePl.setValue(d.namePl);
    if (d.nameEn && !c.nameEn.value.trim()) c.nameEn.setValue(d.nameEn);
    if (d.category) c.categoryCode.setValue(d.category);
    c.nutrition.setValue(
      Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f.name, text(d.values[f.name])])) as Record<
        NutrientName,
        string
      >,
    );
    c.nutrition.markAllAsTouched();
    if (d.liquid) c.liquid.setValue(true);
    if (d.ingredientsVisible) c.allergens.setValue(d.allergens);
    if (d.packageGrams) {
      const row = this.unitRows.controls.find((r) => r.controls.code.value === 'PACKAGE');
      if (row) row.controls.grams.setValue(text(d.packageGrams));
      else this.addUnit('PACKAGE', text(d.packageGrams));
    }
    if (!d.namePl) c.namePl.markAsTouched();
    this.similar.set(d.similar);
    this.labelDraft.set(d);
    afterNextRender(() => document.getElementById('label-summary')?.focus(), { injector: this.injector });
  }

  protected missingNames(d: LabelDraft): string {
    return d.missing.map((k) => this.transloco.translate(`nutrition.${k}`)).join(', ');
  }

  protected allergenNames(codes: string[]): string {
    const all = this.dictionaries()?.allergens ?? [];
    const en = this.lang() === 'en';
    return codes
      .map((code) => all.find((a) => a.code === code))
      .filter((a) => !!a)
      .map((a) => (en ? a.nameEn : a.namePl))
      .join(', ');
  }

  async ngOnInit(): Promise<void> {
    const id = this.id();
    if (!id) {
      const name = this.name()?.trim();
      if (name) this.form.controls.namePl.setValue(name.slice(0, 120));
      return;
    }
    this.loading.set(true);
    try {
      this.fill(await this.api.get(id));
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected toggleAllergen(code: string, checked: boolean): void {
    const current = new Set(this.form.controls.allergens.value);
    if (checked) current.add(code);
    else current.delete(code);
    this.form.controls.allergens.setValue([...current]);
  }

  protected addUnit(code = '', grams = ''): void {
    this.unitRows.push(
      this.fb.group({
        code: this.fb.control(code, [Validators.required]),
        grams: this.fb.control(grams, [Validators.required, decimalValidator(0.01, 5000)]),
      }),
    );
  }

  protected removeUnit(index: number): void {
    this.unitRows.removeAt(index);
  }

  /** Jednostki jeszcze niewybrane w innych wierszach */
  protected availableUnits(index: number) {
    const taken = new Set(
      this.unitRows.controls.filter((_, i) => i !== index).map((r) => r.controls.code.value),
    );
    return (this.dictionaries()?.units ?? []).filter((u) => !taken.has(u.code));
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Przenieś fokus na pierwsze błędne pole (WCAG 3.3.1)
      queueMicrotask(() =>
        document.querySelector<HTMLElement>('form .ng-invalid input, form .ng-invalid mat-select')?.focus(),
      );
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.duplicateId.set(null);
    try {
      const id = this.id();
      const saved = id
        ? await this.api.update(id, this.toPayload())
        : await this.api.create(this.toPayload());
      await this.router.navigate(['/ingredients', saved.id]);
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 'INGREDIENT_EXISTS') {
        const body = err instanceof HttpErrorResponse ? (err.error as { id?: string }) : null;
        this.duplicateId.set(body?.id ?? null);
        this.form.controls.namePl.setErrors({ server: code });
        this.form.controls.namePl.markAsTouched();
      } else if (code === 'NAME_OFFENSIVE') {
        this.form.controls.namePl.setErrors({ server: code });
      } else {
        this.error.set(code);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private toPayload(): SaveIngredient {
    const v = this.form.getRawValue();
    const num = (text: string) => parseDecimal(text);
    const n = v.nutrition;
    return {
      namePl: v.namePl.trim(),
      nameEn: v.nameEn.trim() || undefined,
      categoryCode: v.categoryCode,
      kcal: num(n.kcal)!,
      protein: num(n.protein)!,
      fat: num(n.fat)!,
      saturatedFat: num(n.saturatedFat),
      carbs: num(n.carbs)!,
      sugars: num(n.sugars),
      fiber: num(n.fiber),
      salt: num(n.salt),
      density: v.liquid ? num(v.density) : null,
      allergens: v.allergens,
      units: v.units.map((u) => ({ code: u.code, grams: num(u.grams)! })),
      ...(this.labelDraft() && !this.id() ? { fromLabel: true } : {}),
    };
  }

  private fill(i: Ingredient): void {
    const text = (value: number | null) =>
      value === null ? '' : formatNumber(value, this.lang(), 2).replace(/\s/g, '');
    this.form.patchValue({
      namePl: i.namePl,
      nameEn: i.nameEn ?? '',
      categoryCode: i.category.code,
      nutrition: Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f.name, text(i.nutrition[f.name])])),
      liquid: i.density !== null,
      density: text(i.density),
      allergens: i.allergens.map((a) => a.code),
    });
    for (const u of i.units) this.addUnit(u.code, text(u.grams));
  }
}
