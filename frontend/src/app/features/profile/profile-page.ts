import { Component, inject, signal, type OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { parseDecimal } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { buildCalculatorForm, CalculatorFormComponent, liveTargets } from './calculator-form';
import { ProfileApi, type NutritionProfile, type ProfileState } from './profile.api';
import { TargetsCardComponent } from './targets-card';

@Component({
  selector: 'app-profile-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatProgressBarModule,
    TranslocoDirective,
    CalculatorFormComponent,
    TargetsCardComponent,
  ],
  templateUrl: './profile-page.html',
  styleUrl: './profile-pages.scss',
})
export class ProfilePage implements OnInit {
  private readonly api = inject(ProfileApi);
  protected readonly lang = inject(LanguageService).current;

  protected readonly form = buildCalculatorForm(inject(NonNullableFormBuilder));
  protected readonly targets = liveTargets(this.form);

  protected readonly state = signal<ProfileState | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmWithdraw = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await this.api.get());
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async giveConsent(): Promise<void> {
    await this.run(async () => this.apply(await this.api.setHealthConsent(true)));
  }

  protected async withdrawConsent(): Promise<void> {
    await this.run(async () => {
      this.apply(await this.api.setHealthConsent(false));
      this.form.reset();
      this.confirmWithdraw.set(false);
    });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    await this.run(async () => {
      this.apply(await this.api.save(this.payload()));
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 3000);
    });
  }

  private payload(): NutritionProfile {
    const v = this.form.getRawValue();
    const num = (s: string) => {
      const n = parseDecimal(s);
      return n === null || Number.isNaN(n) ? null : n;
    };
    return {
      sex: v.sex,
      birthDate: v.birthDate,
      heightCm: num(v.heightCm)!,
      weightKg: num(v.weightKg)!,
      activity: v.activity,
      goal: v.goal,
      customKcal: num(v.customKcal) === null ? null : Math.round(num(v.customKcal)!),
      customProtein: num(v.customProtein),
      customFat: num(v.customFat),
      customCarbs: num(v.customCarbs),
    };
  }

  private apply(state: ProfileState): void {
    this.state.set(state);
    const p = state.profile;
    if (!p) return;
    const text = (n: number | null) =>
      n === null ? '' : String(n).replace('.', this.lang() === 'pl' ? ',' : '.');
    this.form.setValue({
      sex: p.sex,
      birthDate: p.birthDate,
      heightCm: text(p.heightCm),
      weightKg: text(p.weightKg),
      activity: p.activity,
      goal: p.goal,
      customKcal: text(p.customKcal),
      customProtein: text(p.customProtein),
      customFat: text(p.customFat),
      customCarbs: text(p.customCarbs),
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.saving.set(false);
    }
  }
}
