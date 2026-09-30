import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { formatDay, formatServings } from './plan-math';
import { PlannerApi, type PlanMeal } from './planner.api';
import { ServingsStepperComponent } from './servings-stepper';

export interface EditMealData {
  meal: PlanMeal;
  days: string[];
  slots: { key: string; label: string }[];
  lang: string;
}

/** Zmiana porcji, przeniesienie na inny dzień/posiłek, zmiana partii i usuwanie */
@Component({
  selector: 'app-edit-meal-dialog',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    TranslocoDirective,
    ServingsStepperComponent,
  ],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ m.recipe.title }}</h2>
      <mat-dialog-content>
        <p class="info">
          @if (m.cook.mealsCount > 1 || m.cook.remaining > 0) {
            {{
              t('planner.cookInfo', {
                date: day(m.cook.date),
                servings: fmt(m.cook.servings),
                rest: fmt(m.cook.remaining),
              })
            }}
          }
          <a [routerLink]="['/recipes', m.recipe.id]" mat-dialog-close>{{ t('planner.openRecipe') }}</a>
        </p>

        <div class="row">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ t('planner.day') }}</mat-label>
            <mat-select [(ngModel)]="date">
              @for (d of data.days; track d) {
                <mat-option [value]="d">{{ day(d) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ t('planner.meal') }}</mat-label>
            <mat-select [(ngModel)]="slot">
              @for (s of data.slots; track s.key) {
                <mat-option [value]="s.key">{{ s.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="amounts">
          <app-servings-stepper
            id="edit-servings"
            [label]="t('planner.servingsNow')"
            [lang]="data.lang"
            [(value)]="servings"
          />
          @if (m.cook.mealsCount > 1 || m.cook.remaining > 0) {
            <app-servings-stepper
              id="edit-cook"
              [label]="t('planner.cookServings')"
              [lang]="data.lang"
              [(value)]="cookServings"
            />
          }
        </div>

        @if (error(); as code) {
          <p class="alert" role="alert">{{ t('errors.' + code) }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions>
        <button mat-button type="button" class="danger" (click)="remove()" [disabled]="busy()">
          {{ t('planner.removeMeal') }}
        </button>
        @if (m.cook.mealsCount > 1) {
          <button mat-button type="button" class="danger" (click)="removeCook()" [disabled]="busy()">
            {{ t('planner.removeCook') }}
          </button>
        }
        <span class="spacer"></span>
        <button mat-button type="button" mat-dialog-close>{{ t('common.cancel') }}</button>
        <button mat-flat-button class="ck-cta" type="button" (click)="save()" [disabled]="busy()">
          {{ t('common.save') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
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
  protected date = this.m.date;
  protected slot = this.m.slot;
  protected readonly servings = signal(this.m.servings);
  protected readonly cookServings = signal(this.m.cook.servings);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly fmt = (n: number) => formatServings(n, this.data.lang);
  protected readonly day = (iso: string) => formatDay(iso, this.data.lang);

  protected async save(): Promise<void> {
    await this.run(async () => {
      // Najpierw powiększamy partię (jeśli trzeba), żeby zmiana porcji się zmieściła
      if (this.cookServings() !== this.m.cook.servings && this.cookServings() > this.m.cook.servings) {
        await this.api.updateCook(this.m.cook.id, this.cookServings());
      }
      await this.api.updateMeal(this.m.id, {
        date: this.date !== this.m.date ? this.date : undefined,
        slot: this.slot !== this.m.slot ? this.slot : undefined,
        servings: this.servings() !== this.m.servings ? this.servings() : undefined,
      });
      if (this.cookServings() < this.m.cook.servings)
        await this.api.updateCook(this.m.cook.id, this.cookServings());
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
