import { Component, computed, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { TranslocoDirective } from '@jsverse/transloco';
import { parseDecimal } from '../../core/i18n/format.pipes';
import { decimalValidator } from '../ingredients/form/nutrition-validators';
import {
  ACTIVITY_FACTORS,
  GOAL_ADJUSTMENT,
  MAX_AGE,
  MIN_AGE,
  ageOn,
  calculateTargets,
  type Activity,
  type Goal,
  type Sex,
  type Targets,
} from './nutrition-calculator';

export const ACTIVITIES = Object.keys(ACTIVITY_FACTORS) as Activity[];
export const GOALS = Object.keys(GOAL_ADJUSTMENT) as Goal[];

/** Wiek 18-100 lat z daty urodzenia */
export function adultValidator(control: AbstractControl<string>): ValidationErrors | null {
  if (!control.value) return null;
  const age = ageOn(new Date(`${control.value}T00:00:00`));
  return Number.isNaN(age) || age < MIN_AGE || age > MAX_AGE ? { age: { min: MIN_AGE, max: MAX_AGE } } : null;
}

export function buildCalculatorForm(fb: NonNullableFormBuilder) {
  return fb.group({
    sex: fb.control<Sex>('FEMALE'),
    birthDate: fb.control('', [Validators.required, adultValidator]),
    heightCm: fb.control('', [Validators.required, decimalValidator(120, 230)]),
    weightKg: fb.control('', [Validators.required, decimalValidator(30, 300)]),
    activity: fb.control<Activity>('LIGHT'),
    goal: fb.control<Goal>('MAINTAIN'),
    customKcal: fb.control('', [decimalValidator(800, 6000)]),
    customProtein: fb.control('', [decimalValidator(0, 500)]),
    customFat: fb.control('', [decimalValidator(0, 500)]),
    customCarbs: fb.control('', [decimalValidator(0, 1000)]),
  });
}

export type CalculatorForm = ReturnType<typeof buildCalculatorForm>;

/** Wynik z aktualnych wartości formularza (null, gdy dane niekompletne) */
export function targetsFromForm(
  value: ReturnType<CalculatorForm['getRawValue']>,
  valid: boolean,
): Targets | null {
  if (!valid) return null;
  const num = (s: string) => {
    const v = parseDecimal(s);
    return v === null || Number.isNaN(v) ? null : v;
  };
  return calculateTargets({
    sex: value.sex,
    age: ageOn(new Date(`${value.birthDate}T00:00:00`)),
    heightCm: num(value.heightCm)!,
    weightKg: num(value.weightKg)!,
    activity: value.activity,
    goal: value.goal,
    customKcal: num(value.customKcal) === null ? null : Math.round(num(value.customKcal)!),
    customProtein: num(value.customProtein),
    customFat: num(value.customFat),
    customCarbs: num(value.customCarbs),
  });
}

/** Pola kalkulatora - używane w profilu (zapis) i na stronie "Jak to działa" (gość, bez zapisu). */
@Component({
  selector: 'app-calculator-form',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatRadioModule, TranslocoDirective],
  template: `
    <div class="fields" [formGroup]="form()" *transloco="let t; prefix: 'profile.form'">
      <fieldset>
        <legend>{{ t('sex') }}</legend>
        <mat-radio-group formControlName="sex" class="inline">
          <mat-radio-button value="FEMALE">{{ t('female') }}</mat-radio-button>
          <mat-radio-button value="MALE">{{ t('male') }}</mat-radio-button>
        </mat-radio-group>
        <p class="hint">{{ t('sexHint') }}</p>
      </fieldset>

      <div class="grid-3">
        <mat-form-field>
          <mat-label>{{ t('birthDate') }}</mat-label>
          <input matInput type="date" formControlName="birthDate" autocomplete="bday" required />
          @if (form().controls.birthDate.hasError('age')) {
            <mat-error>{{ t('ageError') }}</mat-error>
          } @else if (form().controls.birthDate.invalid) {
            <mat-error>{{ t('required') }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ t('height') }}</mat-label>
          <input matInput formControlName="heightCm" inputmode="decimal" autocomplete="off" required />
          @if (form().controls.heightCm.invalid) {
            <mat-error>{{ t('range', { min: 120, max: 230 }) }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ t('weight') }}</mat-label>
          <input matInput formControlName="weightKg" inputmode="decimal" autocomplete="off" required />
          @if (form().controls.weightKg.invalid) {
            <mat-error>{{ t('range', { min: 30, max: 300 }) }}</mat-error>
          }
        </mat-form-field>
      </div>

      <fieldset>
        <legend>{{ t('activity') }}</legend>
        <mat-radio-group formControlName="activity" class="stack">
          @for (a of activities; track a) {
            <mat-radio-button [value]="a">
              <strong>{{ t('activities.' + a + '.title') }}</strong>
              <span class="desc">{{ t('activities.' + a + '.desc') }}</span>
            </mat-radio-button>
          }
        </mat-radio-group>
      </fieldset>

      <fieldset>
        <legend>{{ t('goal') }}</legend>
        <mat-radio-group formControlName="goal" class="goals">
          @for (g of goals; track g) {
            <mat-radio-button [value]="g">
              <strong>{{ t('goals.' + g + '.title') }}</strong>
              <span class="desc">{{ t('goals.' + g + '.desc') }}</span>
            </mat-radio-button>
          }
        </mat-radio-group>
      </fieldset>

      @if (withCustom()) {
        <details class="custom">
          <summary>{{ t('customTitle') }}</summary>
          <p class="hint">{{ t('customHint') }}</p>
          <div class="grid-4">
            <mat-form-field>
              <mat-label>{{ t('customKcal') }}</mat-label>
              <input matInput formControlName="customKcal" inputmode="numeric" autocomplete="off" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ t('customProtein') }}</mat-label>
              <input matInput formControlName="customProtein" inputmode="decimal" autocomplete="off" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ t('customFat') }}</mat-label>
              <input matInput formControlName="customFat" inputmode="decimal" autocomplete="off" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ t('customCarbs') }}</mat-label>
              <input matInput formControlName="customCarbs" inputmode="decimal" autocomplete="off" />
            </mat-form-field>
          </div>
        </details>
      }
    </div>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }
    legend {
      margin-bottom: 6px;
      padding: 0;
      font-weight: 700;
    }
    .inline {
      display: flex;
      gap: 16px;
    }
    .stack,
    .goals {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .desc {
      display: block;
      font-size: 0.85rem;
      color: var(--ck-text-muted);
    }
    .hint {
      margin: 4px 0 0;
      font-size: 0.85rem;
      color: var(--ck-text-muted);
    }
    .grid-3,
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: start;
      gap: 12px;
    }
    .grid-4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    mat-form-field {
      width: 100%;
    }
    .custom summary {
      min-height: 44px;
      display: flex;
      align-items: center;
      cursor: pointer;
      font-weight: 700;
      color: var(--ck-link);
    }
    @media (max-width: 599.98px) {
      .grid-3 {
        grid-template-columns: 1fr;
      }
      .grid-4 {
        grid-template-columns: 1fr 1fr;
      }
    }
  `,
})
export class CalculatorFormComponent {
  readonly form = input.required<CalculatorForm>();
  /** Ręczne nadpisania - tylko w profilu */
  readonly withCustom = input(false);

  protected readonly activities = ACTIVITIES;
  protected readonly goals = GOALS;
}

/** Pomocnik: sygnał z wynikiem kalkulatora dla formularza */
export function liveTargets(form: CalculatorForm) {
  const value = toSignal(form.valueChanges, { initialValue: form.getRawValue() });
  return computed(() => {
    value();
    return targetsFromForm(form.getRawValue(), form.valid);
  });
}
