import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LanguageService } from '../../core/i18n/language.service';
import { ReportsApi, type QueueItem, type ReportStatus } from '../moderation/reports.api';

/** Panel administracyjny: kolejka zgłoszeń (pogrupowanych po celu) i skróty */
@Component({
  selector: 'app-admin-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
  ],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.scss',
})
export class AdminPage {
  private readonly api = inject(ReportsApi);
  private readonly language = inject(LanguageService);

  protected readonly status = signal<ReportStatus>('OPEN');
  protected readonly items = signal<QueueItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Notatki admina per cel (trafiają do maila autora jako powód) */
  protected readonly notes: Record<string, string> = {};

  constructor() {
    effect(() => {
      const s = this.status();
      untracked(() => void this.load(s));
    });
  }

  protected async resolve(item: QueueItem, action: 'HIDE' | 'RESTORE'): Promise<void> {
    this.busy.set(item.key);
    this.error.set(null);
    try {
      await this.api.resolve({
        targetType: item.targetType,
        recipeId: item.recipe?.id,
        userId: item.user?.id,
        action,
        note: this.notes[item.key]?.trim() || undefined,
      });
      this.items.update((list) => list.filter((i) => i.key !== item.key));
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.language.current(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  private async load(status: ReportStatus): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.api.queue(status));
    } catch (err) {
      this.items.set([]);
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }
}
