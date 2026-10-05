import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import {
  PlannerApi,
  STANDARD_SLOTS,
  type PlannerSettings,
  type PlanSlot,
  type StandardSlot,
} from './planner.api';

export interface SettingsData {
  settings: PlannerSettings;
  slots: PlanSlot[];
}

/** Które stałe posiłki pokazywać i własne posiłki dnia. Zmiany zapisują się od razu. */
@Component({
  selector: 'app-planner-settings-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    TranslocoDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('planner.settingsTitle') }}</h2>
      <mat-dialog-content>
        <fieldset>
          <legend>{{ t('planner.visibleMeals') }}</legend>
          @for (code of standard; track code) {
            <mat-checkbox
              [checked]="!hidden().has(code)"
              (change)="toggle(code, $event.checked)"
              [disabled]="busy()"
            >
              {{ t('planner.slots.' + code) }}
            </mat-checkbox>
          }
        </fieldset>

        <fieldset>
          <legend>{{ t('planner.exact.title') }}</legend>
          <mat-slide-toggle
            [checked]="exact()"
            (change)="setExact($event.checked)"
            [disabled]="busy()"
            aria-describedby="exact-hint"
          >
            {{ t('planner.exact.toggle') }}
          </mat-slide-toggle>
          <p class="hint" id="exact-hint">{{ t('planner.exact.hint') }}</p>
        </fieldset>

        <fieldset>
          <legend>{{ t('planner.customMeals') }}</legend>
          <ul class="slots-list">
            @for (s of custom(); track s.key) {
              <li>
                <mat-form-field subscriptSizing="dynamic">
                  <mat-label>{{ t('planner.mealName') }}</mat-label>
                  <input
                    matInput
                    [ngModel]="s.name"
                    (change)="rename(s, $any($event.target).value)"
                    maxlength="40"
                  />
                </mat-form-field>
                <button
                  mat-icon-button
                  type="button"
                  (click)="remove(s)"
                  [attr.aria-label]="t('planner.removeSlot', { name: s.name })"
                >
                  <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                </button>
              </li>
            }
          </ul>
          <div class="row">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>{{ t('planner.newMealName') }}</mat-label>
              <input
                matInput
                [(ngModel)]="newName"
                maxlength="40"
                [placeholder]="t('planner.newMealPlaceholder')"
                (keydown.enter)="add()"
              />
            </mat-form-field>
            <button mat-stroked-button type="button" (click)="add()" [disabled]="busy() || !newName.trim()">
              <span class="material-symbols-rounded" aria-hidden="true">add</span>{{ t('planner.addSlot') }}
            </button>
          </div>
          <p class="hint">{{ t('planner.customHint') }}</p>
        </fieldset>

        @if (error(); as code) {
          <p class="alert" role="alert">{{ t('errors.' + code) }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-flat-button class="ck-cta" type="button" (click)="done()">
          {{ t('planner.done') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styleUrl: './planner-dialogs.scss',
  styles: `
    fieldset {
      margin: 0 0 16px;
      padding: 0;
      border: 0;
      display: flex;
      flex-direction: column;
    }
    legend {
      font-weight: 700;
      margin-bottom: 4px;
    }
  `,
})
export class PlannerSettingsDialog {
  private readonly data = inject<SettingsData>(MAT_DIALOG_DATA);
  private readonly api = inject(PlannerApi);
  private readonly ref = inject(MatDialogRef<PlannerSettingsDialog, boolean>);

  protected readonly standard = STANDARD_SLOTS;
  protected readonly hidden = signal(new Set<StandardSlot>(this.data.settings.hiddenSlots));
  protected readonly exact = signal(this.data.settings.exactPortions);
  protected readonly custom = signal(this.data.slots.filter((s) => !s.code));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected newName = '';
  /** Czy odświeżyć planer po zamknięciu */
  protected changed = false;

  constructor() {
    // Zamknięcie czeka na trwające zapisy - inaczej planer przeładowałby się ze starymi ustawieniami
    this.ref.disableClose = true;
    this.ref.backdropClick().subscribe(() => void this.done());
    this.ref.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') void this.done();
    });
  }

  /** Zapisy w toku (przełączniki zapisują się od razu) */
  private readonly pending = new Set<Promise<unknown>>();

  protected async done(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    this.ref.close(this.changed);
  }

  protected async toggle(code: StandardSlot, visible: boolean): Promise<void> {
    const next = new Set(this.hidden());
    if (visible) next.delete(code);
    else next.add(code);
    await this.run(async () => {
      const saved = await this.api.saveSettings({ hiddenSlots: [...next], exactPortions: this.exact() });
      this.hidden.set(new Set(saved.hiddenSlots));
    });
  }

  protected async setExact(on: boolean): Promise<void> {
    await this.run(async () => {
      const saved = await this.api.saveSettings({ hiddenSlots: [...this.hidden()], exactPortions: on });
      this.exact.set(saved.exactPortions);
    });
  }

  protected async add(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    await this.run(async () => {
      const slot = await this.api.addSlot(name);
      this.custom.update((list) => [...list, slot]);
      this.newName = '';
    });
  }

  protected async rename(slot: PlanSlot, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === slot.name) return;
    await this.run(() => this.api.renameSlot(slot.key, trimmed));
  }

  protected async remove(slot: PlanSlot): Promise<void> {
    await this.run(async () => {
      await this.api.deleteSlot(slot.key);
      this.custom.update((list) => list.filter((s) => s.key !== slot.key));
    });
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    const task = fn();
    this.pending.add(task);
    try {
      await task;
      this.changed = true;
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.pending.delete(task);
      this.busy.set(this.pending.size > 0);
    }
  }
}
