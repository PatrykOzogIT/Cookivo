import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LanguageService } from '../../core/i18n/language.service';
import {
  GroupsApi,
  type GroupDetail,
  type GroupInvite,
  type GroupMember,
  type PendingMember,
} from './groups.api';

type Confirm =
  | { kind: 'leave' | 'delete' }
  | { kind: 'remove' | 'owner'; member: GroupMember }
  | { kind: 'reject'; member: PendingMember }
  | null;

/** Grupa znajomych: członkowie, akceptacja oczekujących, zaproszenia, wyjście */
@Component({
  selector: 'app-group-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
  ],
  templateUrl: './group-page.html',
  styleUrls: ['../profile/profile-pages.scss', './groups.scss'],
})
export class GroupPage {
  private readonly api = inject(GroupsApi);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly lang = inject(LanguageService).current;

  /** Parametr trasy :id */
  readonly id = input.required<string>();

  protected readonly group = signal<GroupDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly confirm = signal<Confirm>(null);
  protected readonly createdLink = signal<GroupInvite | null>(null);
  protected readonly emailSent = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly isOwner = computed(() => this.group()?.role === 'OWNER');
  protected readonly active = computed(() => this.group()?.status === 'ACTIVE');
  protected readonly full = computed(() => {
    const g = this.group();
    return !!g && g.memberCount + g.pending.length >= g.maxMembers;
  });

  protected readonly editForm = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]),
    description: this.fb.control('', [Validators.maxLength(300)]),
  });
  protected readonly inviteForm = this.fb.group({
    email: this.fb.control('', [Validators.required, Validators.email]),
  });

  constructor() {
    // Przejście grupa → grupa używa ponownie komponentu - wczytujemy przy każdej zmianie id
    effect(() => {
      const id = this.id();
      void this.load(id);
    });
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium' }).format(new Date(iso));
  }

  protected startEdit(): void {
    const g = this.group();
    this.editForm.setValue({ name: g?.name ?? '', description: g?.description ?? '' });
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const v = this.editForm.getRawValue();
    await this.run(async () => {
      this.group.set(
        await this.api.update(this.id(), { name: v.name.trim(), description: v.description.trim() || null }),
      );
      this.editing.set(false);
    });
  }

  protected async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const email = this.inviteForm.getRawValue().email.trim();
    await this.run(async () => {
      await this.api.invite(this.id(), email);
      this.inviteForm.reset();
      this.emailSent.set(email);
      await this.reload();
    });
  }

  protected async createLink(): Promise<void> {
    await this.run(async () => {
      this.createdLink.set(await this.api.invite(this.id()));
      this.copied.set(false);
      await this.reload();
    });
  }

  protected async copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
    } catch {
      // Brak uprawnień do schowka - pole z linkiem da się zaznaczyć ręcznie
      this.copied.set(false);
    }
  }

  protected canShare(): boolean {
    return typeof navigator !== 'undefined' && 'share' in navigator;
  }

  protected async shareLink(url: string, title: string): Promise<void> {
    await navigator.share({ title, url }).catch(() => undefined);
  }

  protected async revokeInvite(inviteId: string): Promise<void> {
    await this.run(async () => {
      await this.api.revokeInvite(this.id(), inviteId);
      if (this.createdLink()?.id === inviteId) this.createdLink.set(null);
      await this.reload();
    });
  }

  protected async approve(p: PendingMember): Promise<void> {
    await this.run(async () => this.group.set(await this.api.approve(this.id(), p.userId)));
  }

  protected async confirmAction(): Promise<void> {
    const c = this.confirm();
    if (!c) return;
    await this.run(async () => {
      switch (c.kind) {
        case 'leave':
          await this.api.leave(this.id());
          await this.router.navigate(['/groups']);
          return;
        case 'delete':
          await this.api.remove(this.id());
          await this.router.navigate(['/groups']);
          return;
        case 'owner':
          this.group.set(await this.api.transferOwnership(this.id(), c.member.userId));
          break;
        default:
          this.group.set(await this.api.removeMember(this.id(), c.member.userId));
      }
      this.confirm.set(null);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.createdLink.set(null);
    this.confirm.set(null);
    try {
      this.group.set(await this.api.get(id));
    } catch (err) {
      this.group.set(null);
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async reload(): Promise<void> {
    this.group.set(await this.api.get(this.id()));
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
