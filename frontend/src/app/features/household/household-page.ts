import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { ProfileApi } from '../profile/profile.api';
import { pluralForm } from '../recipes/unit-plural';
import { parseDecimal } from '../../core/i18n/format.pipes';
import { HouseholdApi, type CreatedInvite, type Dependent, type HouseholdMember } from './household.api';

type Confirm = { kind: 'leave' } | { kind: 'remove' | 'owner'; member: HouseholdMember } | null;

@Component({
  selector: 'app-household-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
    MatSlideToggleModule,
    TranslocoDirective,
    LocalizedPipe,
  ],
  templateUrl: './household-page.html',
  styleUrls: ['../profile/profile-pages.scss', './household-page.scss'],
})
export class HouseholdPage implements OnInit {
  private readonly api = inject(HouseholdApi);
  private readonly profileApi = inject(ProfileApi);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly lang = inject(LanguageService).current;
  private readonly transloco = inject(TranslocoService);

  protected readonly household = this.api.current;
  protected readonly isOwner = computed(() => this.household()?.role === 'OWNER');
  protected readonly me = computed(() => this.household()?.members.find((m) => m.isMe) ?? null);
  protected readonly full = computed(() => {
    const h = this.household();
    return !!h && h.members.length >= h.maxMembers;
  });

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly healthConsent = signal(false);
  protected readonly renaming = signal(false);
  protected readonly confirm = signal<Confirm>(null);
  protected readonly createdLink = signal<CreatedInvite | null>(null);
  protected readonly emailSent = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly createForm = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]),
  });
  protected readonly renameForm = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]),
  });
  /** Osoba bez konta: dodawanie i edycja (editing = id albo 'new') */
  protected readonly editing = signal<string | null>(null);
  protected readonly thisYear = new Date().getFullYear();
  protected readonly dependentForm = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.maxLength(40)]),
    birthYear: this.fb.control('', [
      Validators.required,
      Validators.pattern(/^\d{4}$/),
      Validators.min(this.thisYear - 110),
      Validators.max(this.thisYear - 1),
    ]),
    sex: this.fb.control<'MALE' | 'FEMALE'>('FEMALE'),
    customKcal: this.fb.control(''),
  });

  protected readonly inviteForm = this.fb.group({
    email: this.fb.control('', [Validators.required, Validators.email]),
  });

  async ngOnInit(): Promise<void> {
    try {
      const [, profile] = await Promise.all([this.api.refresh(), this.profileApi.get()]);
      this.healthConsent.set(profile.healthConsent);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    await this.run(() => this.api.create(this.createForm.getRawValue().name.trim()));
  }

  protected startRename(): void {
    this.renameForm.setValue({ name: this.household()?.name ?? '' });
    this.renaming.set(true);
  }

  protected async rename(): Promise<void> {
    if (this.renameForm.invalid) {
      this.renameForm.markAllAsTouched();
      return;
    }
    await this.run(async () => {
      await this.api.rename(this.renameForm.getRawValue().name.trim());
      this.renaming.set(false);
    });
  }

  protected async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const email = this.inviteForm.getRawValue().email.trim();
    await this.run(async () => {
      await this.api.invite(email);
      this.inviteForm.reset();
      this.emailSent.set(email);
    });
  }

  protected async createLink(): Promise<void> {
    await this.run(async () => {
      this.createdLink.set(await this.api.invite());
      this.copied.set(false);
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

  protected async revokeInvite(id: string): Promise<void> {
    await this.run(async () => {
      await this.api.revokeInvite(id);
      if (this.createdLink()?.id === id) this.createdLink.set(null);
    });
  }

  protected async setShare(share: boolean): Promise<void> {
    await this.run(() => this.api.setShareAllergies(share));
  }

  protected async setShareTargets(share: boolean): Promise<void> {
    await this.run(() => this.api.setShareTargets(share));
  }

  /** "8 lat" / "2 lata" / "1 rok" */
  protected ageLabel(age: number): string {
    return `${age} ${pluralForm(this.transloco.translate('household.dependents.ageForms'), age, this.lang())}`;
  }

  protected startDependent(d?: Dependent): void {
    this.dependentForm.reset({
      name: d?.name ?? '',
      birthYear: d ? String(d.birthYear) : '',
      sex: d?.sex ?? 'FEMALE',
      customKcal: d?.customKcal ? String(d.customKcal) : '',
    });
    this.editing.set(d?.id ?? 'new');
  }

  protected async saveDependent(): Promise<void> {
    if (this.dependentForm.invalid) {
      this.dependentForm.markAllAsTouched();
      return;
    }
    const v = this.dependentForm.getRawValue();
    const kcal = parseDecimal(v.customKcal);
    const body = {
      name: v.name.trim(),
      birthYear: Number(v.birthYear),
      sex: v.sex,
      customKcal: kcal && !Number.isNaN(kcal) ? Math.round(kcal) : null,
    };
    const id = this.editing();
    await this.run(async () => {
      if (id === 'new') await this.api.addDependent(body);
      else if (id) await this.api.updateDependent(id, body);
      this.editing.set(null);
    });
  }

  protected async removeDependent(id: string): Promise<void> {
    await this.run(() => this.api.removeDependent(id));
  }

  protected async confirmAction(): Promise<void> {
    const c = this.confirm();
    if (!c) return;
    await this.run(async () => {
      if (c.kind === 'leave') await this.api.leave();
      else if (c.kind === 'remove') await this.api.removeMember(c.member.userId);
      else await this.api.transferOwnership(c.member.userId);
      this.confirm.set(null);
      this.createdLink.set(null);
    });
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
