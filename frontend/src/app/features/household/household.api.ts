import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { Severity } from '../profile/profile.api';

export type HouseholdRole = 'OWNER' | 'MEMBER';

export interface HouseholdMember {
  userId: string;
  username: string;
  role: HouseholdRole;
  joinedAt: string;
  isMe: boolean;
  shareAllergies: boolean;
  shareTargets: boolean;
  /** null = domownik nie udostępnia alergii */
  allergens: { code: string; namePl: string; nameEn: string; severity: Severity }[] | null;
}

/** Osoba bez konta (np. dziecko) */
export interface Dependent {
  id: string;
  name: string;
  birthYear: number;
  sex: 'MALE' | 'FEMALE';
  age: number;
  customKcal: number | null;
  /** Cel do podziału porcji */
  kcal: number;
  /** true = wartość referencyjna dla wieku */
  reference: boolean;
}

export interface SaveDependent {
  name: string;
  birthYear: number;
  sex: 'MALE' | 'FEMALE';
  customKcal?: number | null;
}

export interface Household {
  id: string;
  name: string;
  role: HouseholdRole;
  maxMembers: number;
  members: HouseholdMember[];
  dependents: Dependent[];
  invites: { id: string; email: string | null; expiresAt: string; createdAt: string }[];
}

export interface CreatedInvite {
  id: string;
  url: string;
  email: string | null;
  expiresAt: string;
}

export interface InvitePreview {
  household: string;
  invitedBy: string | null;
  members: number;
  expiresAt: string;
}

/**
 * API gospodarstwa + stan "moje gospodarstwo" (sygnał), bo korzysta z niego kilka stron
 * (np. przełącznik "Dla nas" na liście przepisów, opcja widoczności w formularzu).
 */
@Injectable({ providedIn: 'root' })
export class HouseholdApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** undefined = jeszcze nie wczytano, null = nie należę do gospodarstwa */
  readonly current = signal<Household | null | undefined>(undefined);

  constructor() {
    // Po zalogowaniu wczytujemy, po wylogowaniu czyścimy
    effect(() => {
      if (this.auth.isLoggedIn()) void this.refresh().catch(() => undefined);
      else this.current.set(undefined);
    });
  }

  async refresh(): Promise<Household | null> {
    const { household } = await firstValueFrom(
      this.http.get<{ household: Household | null }>('/api/household'),
    );
    this.current.set(household);
    return household;
  }

  create(name: string): Promise<Household> {
    return this.set(this.http.post<Household>('/api/household', { name }));
  }

  rename(name: string): Promise<Household> {
    return this.set(this.http.patch<Household>('/api/household', { name }));
  }

  async invite(email?: string): Promise<CreatedInvite> {
    const invite = await firstValueFrom(this.http.post<CreatedInvite>('/api/household/invites', { email }));
    await this.refresh();
    return invite;
  }

  async revokeInvite(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/household/invites/${id}`));
    await this.refresh();
  }

  preview(token: string): Promise<InvitePreview> {
    return firstValueFrom(
      this.http.get<InvitePreview>('/api/household/invites/preview', { params: { token } }),
    );
  }

  join(token: string): Promise<Household> {
    return this.set(this.http.post<Household>('/api/household/join', { token }));
  }

  async leave(): Promise<void> {
    await firstValueFrom(this.http.post('/api/household/leave', {}));
    this.current.set(null);
  }

  removeMember(userId: string): Promise<Household> {
    return this.set(this.http.delete<Household>(`/api/household/members/${userId}`));
  }

  transferOwnership(userId: string): Promise<Household> {
    return this.set(this.http.post<Household>(`/api/household/members/${userId}/owner`, {}));
  }

  setShareAllergies(share: boolean): Promise<Household> {
    return this.set(this.http.put<Household>('/api/household/share-allergies', { share }));
  }

  setShareTargets(share: boolean): Promise<Household> {
    return this.set(this.http.put<Household>('/api/household/share-targets', { share }));
  }

  addDependent(body: SaveDependent): Promise<Household> {
    return this.set(this.http.post<Household>('/api/household/dependents', body));
  }

  updateDependent(id: string, body: SaveDependent): Promise<Household> {
    return this.set(this.http.put<Household>(`/api/household/dependents/${id}`, body));
  }

  removeDependent(id: string): Promise<Household> {
    return this.set(this.http.delete<Household>(`/api/household/dependents/${id}`));
  }

  private async set(request: Observable<unknown>): Promise<Household> {
    const household = (await firstValueFrom(request)) as Household;
    this.current.set(household);
    return household;
  }
}
