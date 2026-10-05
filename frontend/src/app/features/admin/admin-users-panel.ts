import { Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { apiErrorCode } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/i18n/language.service';
import { AdminUsersApi, type AdminUser, type UsersFilter } from './admin-users.api';
import { BlockDialog } from './block-dialog';

/** Panel admina - zakładka "Użytkownicy": wyszukiwanie, blokady, role (role tylko super admin) */
@Component({
  selector: 'app-admin-users-panel',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
  ],
  templateUrl: './admin-users-panel.html',
  styleUrl: './admin-page.scss',
})
export class AdminUsersPanel implements OnInit {
  private readonly api = inject(AdminUsersApi);
  private readonly dialog = inject(MatDialog);
  private readonly language = inject(LanguageService);
  protected readonly auth = inject(AuthService);

  protected q = '';
  protected readonly filter = signal<UsersFilter>('all');
  protected readonly items = signal<AdminUser[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private page = 1;

  async ngOnInit(): Promise<void> {
    await this.search();
  }

  protected async setFilter(f: UsersFilter): Promise<void> {
    this.filter.set(f);
    await this.search();
  }

  protected async search(): Promise<void> {
    this.loading.set(true);
    await this.load(1);
    this.loading.set(false);
  }

  protected async more(): Promise<void> {
    await this.load(this.page + 1);
  }

  /** Czy mogę blokować to konto (super admina nikt, admina tylko super admin, siebie nie) */
  protected canBlock(u: AdminUser): boolean {
    if (u.id === this.auth.user()?.id || u.role === 'SUPER_ADMIN') return false;
    return u.role === 'USER' || this.auth.isSuperAdmin();
  }

  protected canChangeRole(u: AdminUser): boolean {
    return this.auth.isSuperAdmin() && u.id !== this.auth.user()?.id && u.role !== 'SUPER_ADMIN';
  }

  protected async block(u: AdminUser): Promise<void> {
    const ref = this.dialog.open(BlockDialog, { width: '480px', maxWidth: '100vw', data: u });
    const block = await firstValueFrom(ref.afterClosed());
    if (block) this.patch(u.id, { block });
  }

  protected async unblock(u: AdminUser): Promise<void> {
    await this.run(u.id, async () => this.patch(u.id, await this.api.unblock(u.id)));
  }

  protected async toggleAdmin(u: AdminUser): Promise<void> {
    const role = u.role === 'ADMIN' ? 'USER' : 'ADMIN';
    await this.run(u.id, async () => this.patch(u.id, await this.api.setRole(u.id, role)));
  }

  protected formatDate(iso: string, withTime = false): string {
    return new Intl.DateTimeFormat(this.language.current(), {
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {}),
    }).format(new Date(iso));
  }

  private patch(id: string, change: Partial<AdminUser>): void {
    this.items.update((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));
  }

  private async load(page: number): Promise<void> {
    this.error.set(null);
    try {
      const res = await this.api.list(this.q, this.filter(), page);
      this.items.update((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
      this.total.set(res.total);
      this.page = page;
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }

  private async run(id: string, fn: () => Promise<void>): Promise<void> {
    this.busy.set(id);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(null);
    }
  }
}
