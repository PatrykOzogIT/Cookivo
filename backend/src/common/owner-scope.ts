import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Właściciel wspólnych danych domowych (plan, lodówka, lista zakupów):
 * gospodarstwo, jeśli użytkownik w nim jest, w przeciwnym razie sam użytkownik.
 * Pasuje wprost do warunków Prisma (`where: { ...scope }`).
 */
export type OwnerScope =
  { householdId: string; userId?: undefined } | { userId: string; householdId?: undefined };

export async function ownerScope(prisma: PrismaService, userId: string): Promise<OwnerScope> {
  const member = await prisma.householdMember.findUnique({ where: { userId } });
  return member ? { householdId: member.householdId } : { userId };
}
