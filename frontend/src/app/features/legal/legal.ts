import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Data wejścia w życie bieżących dokumentów - ta sama co TERMS_VERSION / PRIVACY_POLICY_VERSION w backendzie */
export const LEGAL_EFFECTIVE = '2026-10-23';
export const CONTACT_EMAIL = 'kontakt@cookivo.pl';

export type ConsentType =
  'TERMS' | 'PRIVACY_POLICY' | 'HEALTH_DATA' | 'HOUSEHOLD_ALLERGIES' | 'HOUSEHOLD_TARGETS';

export interface ConsentEntry {
  id: string;
  type: ConsentType;
  version: string;
  grantedAt: string;
  revokedAt: string | null;
}

export interface LegalStatus {
  pending: { type: 'TERMS' | 'PRIVACY_POLICY'; version: string }[];
  consents: ConsentEntry[];
}

/** Bieżące wersje regulaminu/polityki do akceptacji i historia zgód zalogowanego użytkownika */
@Injectable({ providedIn: 'root' })
export class LegalService {
  private readonly http = inject(HttpClient);
  readonly status = signal<LegalStatus | null>(null);

  async load(): Promise<LegalStatus> {
    const status = await firstValueFrom(this.http.get<LegalStatus>('/api/me/legal'));
    this.status.set(status);
    return status;
  }

  async accept(): Promise<void> {
    this.status.set(await firstValueFrom(this.http.post<LegalStatus>('/api/me/legal/accept', {})));
  }

  clear(): void {
    this.status.set(null);
  }
}

/** Akapit z dokumentu podzielony na tekst, adresy e-mail i linki (żeby były klikalne) */
export interface Segment {
  kind: 'text' | 'mail' | 'url';
  value: string;
}

export function segments(text: string): Segment[] {
  return text
    .split(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+|https:\/\/[^\s),]+[^\s),.])/)
    .filter(Boolean)
    .map((value) => ({
      kind: value.startsWith('https://') ? 'url' : /^[\w.+-]+@/.test(value) ? 'mail' : 'text',
      value,
    }));
}
