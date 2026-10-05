import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Role } from '../../core/auth/auth.models';

export type UsersFilter = 'all' | 'blocked' | 'admins';

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  recipesCount: number;
  openReports: number;
  block: { until: string | null; reason: string } | null;
}

export interface AdminUsersPage {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class AdminUsersApi {
  private readonly http = inject(HttpClient);

  list(q: string, filter: UsersFilter, page: number): Promise<AdminUsersPage> {
    const params: Record<string, string> = { filter, page: String(page) };
    if (q.trim()) params['q'] = q.trim();
    return firstValueFrom(this.http.get<AdminUsersPage>('/api/admin/users', { params }));
  }

  block(id: string, days: number | null, reason: string): Promise<{ block: AdminUser['block'] }> {
    return firstValueFrom(
      this.http.post<{ block: AdminUser['block'] }>(`/api/admin/users/${id}/block`, {
        ...(days ? { days } : {}),
        reason,
      }),
    );
  }

  unblock(id: string): Promise<{ block: null }> {
    return firstValueFrom(this.http.delete<{ block: null }>(`/api/admin/users/${id}/block`));
  }

  setRole(id: string, role: 'USER' | 'ADMIN'): Promise<{ role: Role }> {
    return firstValueFrom(this.http.patch<{ role: Role }>(`/api/admin/users/${id}/role`, { role }));
  }
}
