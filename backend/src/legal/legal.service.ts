import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LEGAL_DOCUMENTS, type LegalDocumentType } from './legal.js';

/**
 * Akceptacje regulaminu i polityki prywatności oraz historia wszystkich zgód (RODO art. 7 ust. 1 -
 * administrator musi wykazać zgodę, użytkownik widzi, na co i kiedy się zgodził).
 */
@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dokumenty, których bieżącej wersji użytkownik jeszcze nie zaakceptował */
  async pending(userId: string): Promise<{ type: LegalDocumentType; version: string }[]> {
    const accepted = await this.prisma.consent.findMany({
      where: { userId, type: { in: LEGAL_DOCUMENTS.map((d) => d.type) }, revokedAt: null },
      select: { type: true, version: true },
    });
    return LEGAL_DOCUMENTS.filter(
      (d) => !accepted.some((a) => a.type === d.type && a.version === d.version),
    ).map((d) => ({ type: d.type, version: d.version }));
  }

  async status(userId: string) {
    const [pending, consents] = await Promise.all([
      this.pending(userId),
      this.prisma.consent.findMany({
        where: { userId },
        orderBy: { grantedAt: 'desc' },
        select: { id: true, type: true, version: true, grantedAt: true, revokedAt: true },
      }),
    ]);
    return { pending, consents };
  }

  /** Akceptuje bieżące wersje wszystkich oczekujących dokumentów */
  async accept(userId: string, ip: string | undefined) {
    const pending = await this.pending(userId);
    if (pending.length) {
      await this.prisma.consent.createMany({
        data: pending.map((d) => ({ userId, type: d.type, version: d.version, ip })),
      });
    }
    return this.status(userId);
  }
}
