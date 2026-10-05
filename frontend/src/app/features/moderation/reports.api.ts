import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ReportTarget = 'RECIPE' | 'RATING' | 'USER';
export type ReportReason = 'OFFENSIVE' | 'SPAM' | 'DANGEROUS' | 'OTHER';
export type ReportStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED';
export const REPORT_REASONS: ReportReason[] = ['OFFENSIVE', 'SPAM', 'DANGEROUS', 'OTHER'];

/** Znacznik powodu automatycznego ukrycia po zgłoszeniach */
export const AUTO_HIDDEN = 'AUTO_REPORTS';

export interface NewReport {
  targetType: ReportTarget;
  recipeId?: string;
  userId?: string;
  reason: ReportReason;
  details?: string;
}

export interface MyReport {
  id: string;
  targetType: ReportTarget;
  recipe: { id: string; title: string } | null;
  username: string | null;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface QueueItem {
  key: string;
  targetType: ReportTarget;
  recipe: { id: string; title: string; author: string | null } | null;
  user: { id: string; username: string } | null;
  rating: { stars: number; comment: string | null } | null;
  hidden: boolean;
  autoHidden: boolean;
  count: number;
  reports: {
    reason: ReportReason;
    details: string | null;
    reporter: string;
    createdAt: string;
    resolutionNote: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);

  create(body: NewReport): Promise<{ status: ReportStatus; autoHidden: boolean }> {
    return firstValueFrom(
      this.http.post<{ status: ReportStatus; autoHidden: boolean }>('/api/reports', body),
    );
  }

  async mine(): Promise<MyReport[]> {
    return (await firstValueFrom(this.http.get<{ items: MyReport[] }>('/api/reports/mine'))).items;
  }

  async queue(status: ReportStatus): Promise<QueueItem[]> {
    return (
      await firstValueFrom(
        this.http.get<{ items: QueueItem[] }>('/api/admin/reports', { params: { status } }),
      )
    ).items;
  }

  resolve(body: {
    targetType: ReportTarget;
    recipeId?: string;
    userId?: string;
    action: 'HIDE' | 'RESTORE';
    note?: string;
  }): Promise<{ resolved: number }> {
    return firstValueFrom(this.http.post<{ resolved: number }>('/api/admin/reports/resolve', body));
  }
}
