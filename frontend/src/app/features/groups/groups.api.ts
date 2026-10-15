import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export type GroupRole = 'OWNER' | 'MEMBER';
export type GroupStatus = 'PENDING' | 'ACTIVE';

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  role: GroupRole;
  status: GroupStatus;
  memberCount: number;
  /** null = czekam na akceptację (nie widzę przepisów) */
  recipeCount: number | null;
  /** Osoby czekające na akceptację - tylko dla właściciela */
  pendingCount: number;
}

export interface GroupLimits {
  groups: number;
  owned: number;
  members: number;
}

export interface GroupMember {
  userId: string;
  username: string;
  role: GroupRole;
  joinedAt: string;
  isMe: boolean;
}

export interface PendingMember {
  userId: string;
  username: string;
  invitedBy: string | null;
  requestedAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  role: GroupRole;
  status: GroupStatus;
  maxMembers: number;
  memberCount: number;
  members: GroupMember[];
  pending: PendingMember[];
  invites: { id: string; email: string | null; expiresAt: string; createdAt: string }[];
}

export interface GroupInvite {
  id: string;
  url: string;
  email: string | null;
  expiresAt: string;
}

export interface GroupInvitePreview {
  group: string;
  description: string | null;
  invitedBy: string | null;
  members: number;
  /** true = zaprosił ktoś inny niż właściciel - po dołączeniu trzeba czekać na akceptację */
  needsApproval: boolean;
  expiresAt: string;
}

export interface SaveGroup {
  name: string;
  description?: string | null;
}

/**
 * Grupy znajomych + lista "moje grupy" jako sygnał (korzysta z niej formularz przepisu
 * i filtry listy przepisów).
 */
@Injectable({ providedIn: 'root' })
export class GroupsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** undefined = jeszcze nie wczytano */
  readonly mine = signal<GroupSummary[] | undefined>(undefined);
  readonly limits = signal<GroupLimits | null>(null);
  /** Grupy, którym mogę udostępniać przepisy (jestem aktywnym członkiem) */
  readonly active = computed(() => (this.mine() ?? []).filter((g) => g.status === 'ACTIVE'));

  constructor() {
    effect(() => {
      if (this.auth.isLoggedIn()) void this.refresh().catch(() => undefined);
      else this.mine.set(undefined);
    });
  }

  async refresh(): Promise<GroupSummary[]> {
    const res = await firstValueFrom(
      this.http.get<{ items: GroupSummary[]; limits: GroupLimits }>('/api/groups'),
    );
    this.mine.set(res.items);
    this.limits.set(res.limits);
    return res.items;
  }

  async create(body: SaveGroup): Promise<GroupDetail> {
    return this.after(this.http.post<GroupDetail>('/api/groups', body));
  }

  get(id: string): Promise<GroupDetail> {
    return firstValueFrom(this.http.get<GroupDetail>(`/api/groups/${id}`));
  }

  update(id: string, body: SaveGroup): Promise<GroupDetail> {
    return this.after(this.http.patch<GroupDetail>(`/api/groups/${id}`, body));
  }

  async remove(id: string): Promise<void> {
    await this.after(this.http.delete(`/api/groups/${id}`));
  }

  invite(id: string, email?: string): Promise<GroupInvite> {
    return firstValueFrom(this.http.post<GroupInvite>(`/api/groups/${id}/invites`, { email }));
  }

  async revokeInvite(id: string, inviteId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/groups/${id}/invites/${inviteId}`));
  }

  preview(token: string): Promise<GroupInvitePreview> {
    return firstValueFrom(
      this.http.get<GroupInvitePreview>('/api/groups/invites/preview', { params: { token } }),
    );
  }

  join(token: string): Promise<GroupDetail> {
    return this.after(this.http.post<GroupDetail>('/api/groups/join', { token }));
  }

  async leave(id: string): Promise<void> {
    await this.after(this.http.post(`/api/groups/${id}/leave`, {}));
  }

  approve(id: string, userId: string): Promise<GroupDetail> {
    return this.after(this.http.post<GroupDetail>(`/api/groups/${id}/members/${userId}/approve`, {}));
  }

  removeMember(id: string, userId: string): Promise<GroupDetail> {
    return this.after(this.http.delete<GroupDetail>(`/api/groups/${id}/members/${userId}`));
  }

  transferOwnership(id: string, userId: string): Promise<GroupDetail> {
    return this.after(this.http.post<GroupDetail>(`/api/groups/${id}/members/${userId}/owner`, {}));
  }

  /** Po zmianie odświeżamy listę "moje grupy" (liczniki, role) */
  private async after<T>(request: Observable<T>): Promise<T> {
    const result = await firstValueFrom(request);
    await this.refresh().catch(() => undefined);
    return result;
  }
}
