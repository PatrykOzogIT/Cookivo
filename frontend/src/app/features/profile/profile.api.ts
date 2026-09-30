import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { User } from '../../core/auth/auth.models';
import type { Activity, Goal, Sex, Targets } from './nutrition-calculator';

export type PreferenceLevel = 'NEVER' | 'SOMETIMES' | 'LIKE' | 'LOVE';
export type Severity = 'ALLERGY' | 'INTOLERANCE';

export interface NutritionProfile {
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
  customKcal: number | null;
  customProtein: number | null;
  customFat: number | null;
  customCarbs: number | null;
}

export interface ProfileState {
  healthConsent: boolean;
  profile: NutritionProfile | null;
  targets: Targets | null;
  allergens: { code: string; severity: Severity }[];
}

export interface Preferences {
  ingredients: { id: string; namePl: string; nameEn: string | null; icon: string; level: PreferenceLevel }[];
  categories: { code: string; level: PreferenceLevel }[];
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);

  get(): Promise<ProfileState> {
    return firstValueFrom(this.http.get<ProfileState>('/api/me/profile'));
  }
  save(profile: NutritionProfile): Promise<ProfileState> {
    return firstValueFrom(this.http.put<ProfileState>('/api/me/profile', profile));
  }
  setHealthConsent(granted: boolean): Promise<ProfileState> {
    return firstValueFrom(this.http.post<ProfileState>('/api/me/consents/health-data', { granted }));
  }
  setAllergens(allergens: ProfileState['allergens']): Promise<ProfileState> {
    return firstValueFrom(this.http.put<ProfileState>('/api/me/allergens', { allergens }));
  }

  preferences(): Promise<Preferences> {
    return firstValueFrom(this.http.get<Preferences>('/api/me/preferences'));
  }
  setIngredientPreference(id: string, level: PreferenceLevel | null): Promise<Preferences> {
    return firstValueFrom(this.http.put<Preferences>(`/api/me/preferences/ingredients/${id}`, { level }));
  }
  setCategoryPreference(code: string, level: PreferenceLevel | null): Promise<Preferences> {
    return firstValueFrom(this.http.put<Preferences>(`/api/me/preferences/categories/${code}`, { level }));
  }

  // --- Konto ---
  setLocale(locale: 'pl' | 'en'): Promise<User> {
    return firstValueFrom(this.http.patch<User>('/api/me/settings', { locale }));
  }
  changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/me/password', { currentPassword, newPassword }));
  }
  changeEmail(newEmail: string, password: string): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/me/email', { newEmail, password }));
  }
  confirmEmailChange(token: string): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/auth/confirm-email-change', { token }));
  }
  sessions(): Promise<SessionInfo[]> {
    return firstValueFrom(this.http.get<SessionInfo[]>('/api/me/sessions'));
  }
  revokeSession(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/me/sessions/${id}`));
  }
  revokeOtherSessions(): Promise<unknown> {
    return firstValueFrom(this.http.delete('/api/me/sessions'));
  }
  exportData(): Promise<Blob> {
    return firstValueFrom(this.http.get('/api/me/export', { responseType: 'blob' }));
  }
  deleteAccount(password: string): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/me/delete', { password }));
  }
}
