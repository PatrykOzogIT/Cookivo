import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { AuthShellComponent } from '../auth/auth-shell';
import { GroupsApi, type GroupInvitePreview } from './groups.api';

/** Link z zaproszenia do grupy: podgląd także dla gościa, dołączenie po zalogowaniu. */
@Component({
  selector: 'app-group-join-page',
  imports: [RouterLink, MatButtonModule, MatProgressSpinnerModule, TranslocoDirective, AuthShellComponent],
  template: `
    <ng-container *transloco="let t">
      @if (loading()) {
        <app-auth-shell icon="hourglass_top" [heading]="t('household.join.checking')">
          <mat-spinner diameter="40" [attr.aria-label]="t('common.loading')" />
        </app-auth-shell>
      } @else if (preview(); as p) {
        <app-auth-shell
          icon="diversity_3"
          [heading]="t('groups.join.title', { name: p.group })"
          [subheading]="
            p.invitedBy
              ? t('groups.join.invitedBy', { username: p.invitedBy, count: p.members })
              : t('groups.join.members', { count: p.members })
          "
        >
          @if (p.description) {
            <p class="hint">{{ p.description }}</p>
          }
          @if (p.needsApproval) {
            <p class="hint muted">{{ t('groups.join.needsApproval') }}</p>
          }
          @if (error(); as code) {
            <div class="alert error" role="alert">
              <span class="material-symbols-rounded" aria-hidden="true">error</span>
              <span>{{ t('errors.' + code) }}</span>
            </div>
          }
          @if (auth.isLoggedIn()) {
            @if (error() === 'ALREADY_IN_GROUP') {
              <a mat-flat-button class="ck-cta submit" routerLink="/groups">{{ t('groups.join.toMine') }}</a>
            } @else {
              <button
                mat-flat-button
                class="ck-cta submit"
                type="button"
                (click)="join()"
                [disabled]="busy()"
              >
                {{ t('groups.join.accept') }}
              </button>
            }
          } @else {
            <p class="hint">{{ t('groups.join.loginFirst') }}</p>
            <a
              mat-flat-button
              class="ck-cta submit"
              routerLink="/auth/login"
              [queryParams]="{ returnUrl: returnUrl() }"
            >
              {{ t('nav.login') }}
            </a>
            <a
              mat-stroked-button
              class="submit"
              routerLink="/auth/register"
              [queryParams]="{ returnUrl: returnUrl() }"
            >
              {{ t('nav.register') }}
            </a>
          }
        </app-auth-shell>
      } @else {
        <app-auth-shell
          icon="link_off"
          [heading]="t('household.join.invalidTitle')"
          [subheading]="t('errors.INVITE_INVALID')"
        >
          <a mat-stroked-button class="submit" routerLink="/">{{ t('nav.home') }}</a>
        </app-auth-shell>
      }
    </ng-container>
  `,
  styleUrl: '../auth/auth-forms.scss',
  styles: `
    .hint {
      margin: 0 0 8px;
      text-align: center;
    }
    .muted {
      color: var(--ck-text-muted);
    }
    a + a {
      margin-top: 8px;
    }
  `,
})
export class GroupJoinPage implements OnInit {
  private readonly api = inject(GroupsApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  readonly token = input<string>();
  protected readonly preview = signal<GroupInvitePreview | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Po zalogowaniu / rejestracji wracamy na ten sam link */
  protected readonly returnUrl = computed(
    () => `/groups/join?token=${encodeURIComponent(this.token() ?? '')}`,
  );

  async ngOnInit(): Promise<void> {
    const token = this.token();
    try {
      if (token) this.preview.set(await this.api.preview(token));
    } catch {
      this.preview.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async join(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const group = await this.api.join(this.token()!);
      await this.router.navigate(['/groups', group.id]);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
