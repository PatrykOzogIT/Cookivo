import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalizedPipe, NumberPipe, formatNumber, parseDecimal } from '../../../core/i18n/format.pipes';
import { LanguageService } from '../../../core/i18n/language.service';
import { HouseholdApi } from '../../household/household.api';
import { IngredientsApi } from '../../ingredients/ingredients.api';
import { decimalValidator } from '../../ingredients/form/nutrition-validators';
import { defaultUnit, unitOptions, type LineItem, type LineUnitOption } from '../recipe-units';
import { RecipesApi } from '../recipes.api';
import type { Difficulty, Photo, RecipeDetail, SaveRecipe, Visibility } from '../recipes.models';
import { LineItemPickerComponent } from './line-item-picker';
import { PhotoPickerComponent } from './photo-picker';

type LineGroup = FormGroup<{
  item: FormControl<LineItem | null>;
  amount: FormControl<string>;
  unitCode: FormControl<string>;
  groupName: FormControl<string>;
  note: FormControl<string>;
}>;

type StepGroup = FormGroup<{
  text: FormControl<string>;
  timerMinutes: FormControl<string>;
  photo: FormControl<Photo | null>;
}>;

export const MAX_GALLERY = 10;

@Component({
  selector: 'app-recipe-form-page',
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
    LocalizedPipe,
    NumberPipe,
    LineItemPickerComponent,
    PhotoPickerComponent,
  ],
  templateUrl: './recipe-form-page.html',
  styleUrl: './recipe-form-page.scss',
})
export class RecipeFormPage implements OnInit {
  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly auth = inject(AuthService);
  protected readonly household = inject(HouseholdApi);
  protected readonly lang = inject(LanguageService).current;
  protected readonly dictionaries = toSignal(inject(IngredientsApi).dictionaries$);

  /** Parametr trasy :id - tylko przy edycji */
  readonly id = input<string>();
  /** Edytowany przepis jest wariantem - pokazujemy pole "co zmieniono" */
  protected readonly variantOf = signal<RecipeDetail['variantOf']>(null);

  protected readonly difficulties: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
  protected readonly maxGallery = MAX_GALLERY;

  protected readonly form = this.fb.group({
    title: this.fb.control('', [Validators.required, Validators.minLength(3), Validators.maxLength(150)]),
    description: this.fb.control('', [Validators.maxLength(2000)]),
    servings: this.fb.control('4', [
      Validators.required,
      Validators.pattern(/^\d+$/),
      decimalValidator(1, 100),
    ]),
    prepMinutes: this.fb.control('', [Validators.pattern(/^\d*$/), decimalValidator(0, 1440)]),
    cookMinutes: this.fb.control('', [Validators.pattern(/^\d*$/), decimalValidator(0, 4320)]),
    difficulty: this.fb.control<Difficulty | ''>(''),
    visibility: this.fb.control<Visibility>('PRIVATE'),
    canBeIngredient: this.fb.control(false),
    cookedGrams: this.fb.control('', [decimalValidator(1, 100000)]),
    variantNote: this.fb.control('', [Validators.maxLength(200)]),
    mealTypes: this.fb.control<string[]>([]),
    ingredients: this.fb.array<LineGroup>([]),
    steps: this.fb.array<StepGroup>([]),
  });

  protected readonly photos = signal<Photo[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Błąd serwera wskazujący konkretną pozycję (np. zła jednostka) */
  protected readonly lineError = signal<{ index: number; code: string } | null>(null);

  private readonly lineValues = toSignal(this.form.controls.ingredients.valueChanges, { initialValue: [] });

  protected get lines(): FormArray<LineGroup> {
    return this.form.controls.ingredients;
  }
  protected get steps(): FormArray<StepGroup> {
    return this.form.controls.steps;
  }

  /** Suma wag (podgląd) - dokładne wartości liczy serwer po zapisie */
  protected readonly approxGrams = computed(() => {
    this.lineValues();
    return this.lines.controls.reduce((sum, row) => sum + (this.rowGrams(row) ?? 0), 0);
  });

  async ngOnInit(): Promise<void> {
    const id = this.id();
    if (!id) {
      this.addLine();
      this.addStep();
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

  // --- Typy posiłków ---------------------------------------------------------

  protected toggleMealType(code: string, on: boolean): void {
    const set = new Set(this.form.controls.mealTypes.value);
    if (on) set.add(code);
    else set.delete(code);
    this.form.controls.mealTypes.setValue([...set]);
  }

  // --- Składniki ---------------------------------------------------------------

  protected addLine(
    value?: Partial<{ item: LineItem; amount: string; unitCode: string; groupName: string; note: string }>,
  ) {
    const row: LineGroup = this.fb.group({
      item: this.fb.control<LineItem | null>(value?.item ?? null, [Validators.required]),
      amount: this.fb.control(value?.amount ?? '', [Validators.required, decimalValidator(0.001, 100000)]),
      unitCode: this.fb.control(value?.unitCode ?? 'g', [Validators.required]),
      groupName: this.fb.control(value?.groupName ?? ''),
      note: this.fb.control(value?.note ?? '', [Validators.maxLength(120)]),
    });
    // Nowy wybór pozycji → domyślna jednostka dla niej
    row.controls.item.valueChanges.subscribe((item) => {
      if (item) row.controls.unitCode.setValue(defaultUnit(item));
    });
    this.lines.push(row);
  }

  protected unitsFor(row: LineGroup): LineUnitOption[] {
    return unitOptions(row.controls.item.value, this.dictionaries()?.units ?? []);
  }

  protected rowGrams(row: LineGroup): number | null {
    const amount = parseDecimal(row.controls.amount.value);
    const option = this.unitsFor(row).find((o) => o.code === row.controls.unitCode.value);
    if (amount === null || Number.isNaN(amount) || !option?.grams) return null;
    return amount * option.grams;
  }

  protected move(array: FormArray<LineGroup> | FormArray<StepGroup>, index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= array.length) return;
    // Unia typów FormArray - rzutujemy na wspólny interfejs operacji na tablicy
    const list = array as FormArray<LineGroup | StepGroup>;
    const control = list.at(index);
    list.removeAt(index, { emitEvent: false });
    list.insert(target, control);
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    if (!this.lines.length) this.addLine();
  }

  // --- Kroki -----------------------------------------------------------------

  protected addStep(value?: Partial<{ text: string; timerMinutes: string; photo: Photo | null }>) {
    this.steps.push(
      this.fb.group({
        text: this.fb.control(value?.text ?? '', [Validators.required, Validators.maxLength(2000)]),
        timerMinutes: this.fb.control(value?.timerMinutes ?? '', [
          Validators.pattern(/^\d*$/),
          decimalValidator(1, 1440),
        ]),
        photo: this.fb.control<Photo | null>(value?.photo ?? null),
      }),
    );
  }

  protected removeStep(index: number): void {
    const photo = this.steps.at(index).controls.photo.value;
    this.steps.removeAt(index);
    if (photo) void this.discardPhoto(photo);
  }

  protected removeStepPhoto(index: number): void {
    const control = this.steps.at(index).controls.photo;
    const photo = control.value;
    control.setValue(null);
    if (photo) void this.discardPhoto(photo);
  }

  // --- Galeria -----------------------------------------------------------------

  protected addPhoto(photo: Photo): void {
    this.photos.update((list) => [...list, photo].slice(0, MAX_GALLERY));
  }

  protected movePhoto(index: number, delta: number): void {
    this.photos.update((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  protected removePhoto(photo: Photo): void {
    this.photos.update((list) => list.filter((p) => p.id !== photo.id));
    void this.discardPhoto(photo);
  }

  /** Zdjęcie jeszcze nieprzypięte do przepisu usuwamy od razu; przypięte zniknie przy zapisie. */
  private async discardPhoto(photo: Photo): Promise<void> {
    if (this.originalPhotoIds.has(photo.id)) return;
    await this.api.removePhoto(photo.id).catch(() => undefined);
  }

  private originalPhotoIds = new Set<string>();

  // --- Zapis -------------------------------------------------------------------

  protected async submit(): Promise<void> {
    this.lineError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>(
            'form .ng-invalid input, form .ng-invalid textarea, form .ng-invalid mat-select',
          )
          ?.focus(),
      );
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const id = this.id();
      const saved = id ? await this.api.update(id, this.payload()) : await this.api.create(this.payload());
      await this.router.navigate(['/recipes', saved.id]);
    } catch (err) {
      const code = apiErrorCode(err);
      const index = err instanceof HttpErrorResponse ? (err.error as { index?: number })?.index : undefined;
      if (typeof index === 'number') this.lineError.set({ index, code });
      this.error.set(code);
    } finally {
      this.saving.set(false);
    }
  }

  private payload(): SaveRecipe {
    const v = this.form.getRawValue();
    const int = (s: string) => (s.trim() ? parseInt(s, 10) : null);
    return {
      title: v.title.trim(),
      description: v.description.trim() || undefined,
      servings: int(v.servings)!,
      prepMinutes: int(v.prepMinutes),
      cookMinutes: int(v.cookMinutes),
      difficulty: v.difficulty || null,
      visibility: v.visibility,
      canBeIngredient: v.canBeIngredient,
      cookedGrams: parseDecimal(v.cookedGrams),
      variantNote: v.variantNote.trim() || null,
      mealTypes: v.mealTypes,
      ingredients: v.ingredients.map((l) => ({
        ...(l.item!.kind === 'recipe' ? { subRecipeId: l.item!.id } : { ingredientId: l.item!.id }),
        amount: parseDecimal(l.amount)!,
        unitCode: l.unitCode,
        groupName: l.groupName.trim() || undefined,
        note: l.note.trim() || undefined,
      })),
      steps: v.steps.map((s) => ({
        text: s.text.trim(),
        timerMinutes: int(s.timerMinutes),
        photoId: s.photo?.id ?? null,
      })),
      photoIds: this.photos().map((p) => p.id),
    };
  }

  private fill(r: RecipeDetail): void {
    const text = (n: number | null) => (n === null ? '' : String(n));
    const decimal = (n: number) => formatNumber(n, this.lang(), 3).replace(/\s/g, '');
    this.variantOf.set(r.variantOf);
    this.form.patchValue({
      title: r.title,
      description: r.description ?? '',
      servings: String(r.servings),
      prepMinutes: text(r.prepMinutes),
      cookMinutes: text(r.cookMinutes),
      difficulty: r.difficulty ?? '',
      visibility: r.visibility,
      canBeIngredient: r.canBeIngredient,
      cookedGrams: r.cookedGrams === null ? '' : decimal(r.cookedGrams),
      variantNote: r.variantNote ?? '',
      mealTypes: r.mealTypes.map((m) => m.code),
    });
    for (const l of r.ingredients) {
      const item: LineItem = l.ingredient
        ? {
            kind: 'ingredient',
            id: l.ingredient.id,
            name: { namePl: l.ingredient.namePl, nameEn: l.ingredient.nameEn },
            density: l.ingredient.density,
            units: l.ingredient.units,
          }
        : {
            kind: 'recipe',
            id: l.subRecipe!.id,
            name: { namePl: l.subRecipe!.title },
            servings: l.subRecipe!.servings,
          };
      this.addLine({
        item,
        amount: decimal(l.amount),
        unitCode: l.unitCode,
        groupName: l.groupName ?? '',
        note: l.note ?? '',
      });
      // addLine ustawia jednostkę domyślną przy zmianie pozycji - przywracamy zapisaną
      this.lines.at(-1).controls.unitCode.setValue(l.unitCode);
    }
    for (const s of r.steps)
      this.addStep({ text: s.text, timerMinutes: text(s.timerMinutes), photo: s.photo });
    if (!r.steps.length) this.addStep();
    this.photos.set(r.photos);
    this.originalPhotoIds = new Set(
      [...r.photos, ...r.steps.flatMap((s) => (s.photo ? [s.photo] : []))].map((p) => p.id),
    );
  }
}
