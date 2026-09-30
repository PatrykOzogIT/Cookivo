import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { NumberPipe, parseDecimal } from '../../core/i18n/format.pipes';
import { formatDay, formatServings } from './plan-math';
import { PlannerApi, type PlanMeal, type PlanPerson } from './planner.api';
import { ServingsStepperComponent } from './servings-stepper';

export interface EditMealData {
  meal: PlanMeal;
  days: string[];
  slots: { key: string; label: string }[];
  lang: string;
  /** Osoby w trybie dokładnym (pusta lista = tryb prosty) */
  persons: PlanPerson[];
}

/**
 * Zmiana porcji, przeniesienie, partia i usuwanie. W trybie dokładnym także "nakładanie":
 * kto je, ile gramów / porcji dla każdego i ważenie garnka.
 */
@Component({
  selector: 'app-edit-meal-dialog',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslocoDirective,
    NumberPipe,
    ServingsStepperComponent,
  ],
  templateUrl: './edit-meal-dialog.html',
  styleUrl: './planner-dialogs.scss',
  styles: `
    mat-dialog-actions {
      flex-wrap: wrap;
      gap: 4px;
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class EditMealDialog {
  protected readonly data = inject<EditMealData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<EditMealDialog, boolean>);
  private readonly api = inject(PlannerApi);

  protected readonly m = this.data.meal;
  protected readonly exact = this.data.persons.length > 0;
  protected date = this.m.date;
  protected slot = this.m.slot;
  protected readonly servings = signal(this.m.servings);
  protected readonly cookServings = signal(this.m.cook.servings);
  protected readonly absent = signal(new Set(this.m.absent));
  protected weighed =
    this.m.cook.gramsSource === 'WEIGHED' && this.m.cook.potGrams ? String(this.m.cook.potGrams) : '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Rozpiska nakładania z danych z serwera (po zapisie planer się odświeża) */
  protected readonly rows = computed(() =>
    (this.m.shares ?? []).map((s) => ({
      ...s,
      name: this.nameOf(s.key),
      isMe: this.data.persons.find((p) => p.key === s.key)?.isMe ?? false,
    })),
  );
  /** Przy gotowaniu na zapas: ile garnka zostawić na później */
  protected readonly leave = computed(() => {
    const pot = this.m.cook.potGrams;
    if (!pot || !this.m.grams || this.m.fromLeftovers || this.m.cook.servings <= this.m.servings) return null;
    return Math.round(pot - this.m.grams);
  });

  protected readonly fmt = (n: number) => formatServings(n, this.data.lang);
  protected readonly day = (iso: string) => formatDay(iso, this.data.lang);

  protected nameOf(key: string): string {
    return this.data.persons.find((p) => p.key === key)?.name ?? '?';
  }

  protected toggleEater(key: string, eats: boolean): void {
    this.absent.update((set) => {
      const next = new Set(set);
      if (eats) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected async save(): Promise<void> {
    await this.run(async () => {
      // Najpierw powiększamy partię (jeśli trzeba), żeby zmiana porcji się zmieściła
      if (this.cookServings() > this.m.cook.servings)
        await this.api.updateCook(this.m.cook.id, this.cookServings());
      await this.api.updateMeal(this.m.id, {
        date: this.date !== this.m.date ? this.date : undefined,
        slot: this.slot !== this.m.slot ? this.slot : undefined,
        servings: this.servings() !== this.m.servings ? this.servings() : undefined,
      });
      if (this.cookServings() < this.m.cook.servings)
        await this.api.updateCook(this.m.cook.id, this.cookServings());

      if (this.exact) {
        const absent = [...this.absent()];
        if (absent.length !== this.m.absent.length || absent.some((k) => !this.m.absent.includes(k))) {
          await this.api.setEaters(this.m.id, absent);
        }
        const grams = parseDecimal(this.weighed);
        const weight = grams && !Number.isNaN(grams) ? Math.round(grams) : null;
        const current = this.m.cook.gramsSource === 'WEIGHED' ? this.m.cook.potGrams : null;
        if (weight !== current) await this.api.setCookWeight(this.m.cook.id, weight);
      }
    });
  }

  protected async remove(): Promise<void> {
    await this.run(() => this.api.deleteMeal(this.m.id));
  }

  protected async removeCook(): Promise<void> {
    await this.run(() => this.api.deleteCook(this.m.cook.id));
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
      this.ref.close(true);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
