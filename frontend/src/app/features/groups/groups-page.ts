import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { GroupsApi } from './groups.api';

/** Moje grupy znajomych: lista i zakładanie nowej */
@Component({
  selector: 'app-groups-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
  ],
  templateUrl: './groups-page.html',
  styleUrls: ['../profile/profile-pages.scss', './groups.scss'],
})
export class GroupsPage implements OnInit {
  private readonly api = inject(GroupsApi);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);

  protected readonly groups = this.api.mine;
  protected readonly limits = this.api.limits;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly creating = signal(false);

  /** Ile grup założyłem / do ilu należę - przy limicie chowamy formularz */
  protected readonly owned = computed(() => (this.groups() ?? []).filter((g) => g.role === 'OWNER').length);
  protected readonly canCreate = computed(() => {
    const l = this.limits();
    const all = this.groups()?.length ?? 0;
    return !l || (all < l.groups && this.owned() < l.owned);
  });

  protected readonly form = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]),
    description: this.fb.control('', [Validators.maxLength(300)]),
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.api.refresh();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      const group = await this.api.create({ name: v.name.trim(), description: v.description.trim() || null });
      await this.router.navigate(['/groups', group.id]);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
