import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { AiImportKind } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Retencja liczników użycia (polityka prywatności) */
const KEEP_MS = 90 * DAY_MS;

/**
 * Limity i licznik odczytów przez AI (tabela `ai_imports`): dzienny na osobę osobno dla przepisów
 * i paragonów, miesięczny wspólny dla całego serwisu (kontrola kosztów).
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  dailyLimit(kind: AiImportKind): number {
    return kind === 'RECEIPT'
      ? this.config.get('RECEIPT_IMPORT_DAILY_LIMIT', { infer: true })
      : this.config.get('RECIPE_IMPORT_DAILY_LIMIT', { infer: true });
  }

  async remaining(userId: string, kind: AiImportKind): Promise<number> {
    return Math.max(0, this.dailyLimit(kind) - (await this.usedToday(userId, kind)));
  }

  /** Rzuca 429, gdy wyczerpano limit dzienny osoby albo miesięczny serwisu */
  async assertAvailable(userId: string, kind: AiImportKind): Promise<void> {
    if ((await this.usedToday(userId, kind)) >= this.dailyLimit(kind)) {
      throw new HttpException({ code: 'IMPORT_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const month = await this.prisma.aiImport.count({ where: { createdAt: { gte: monthStart } } });
    if (month >= this.config.get('RECIPE_IMPORT_MONTHLY_LIMIT', { infer: true })) {
      throw new HttpException({ code: 'IMPORT_BUSY' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Liczymy próbę przed wywołaniem modelu - nieudane odczyty też kosztują */
  async start(userId: string, kind: AiImportKind, photos: number, scopeKey: string | null = null) {
    const record = await this.prisma.aiImport.create({ data: { userId, kind, photos, scopeKey } });
    void this.purgeOld();
    return record.id;
  }

  async finish(id: string, tokens: { inputTokens: number; outputTokens: number }): Promise<void> {
    await this.prisma.aiImport.update({
      where: { id },
      data: { success: true, inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens },
    });
  }

  private usedToday(userId: string, kind: AiImportKind): Promise<number> {
    return this.prisma.aiImport.count({
      where: { userId, kind, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
  }

  private async purgeOld(): Promise<void> {
    try {
      await this.prisma.aiImport.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } });
    } catch {
      // sprzątanie nie może psuć importu
    }
  }
}
