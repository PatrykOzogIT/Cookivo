import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { ALLERGENS, CATEGORIES, UNITS } from './reference-data.js';
import { seed } from './seed.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const { ingredients } = await seed(prisma);
  console.log(
    `Seed zakończony: ${ALLERGENS.length} alergenów, ${CATEGORIES.length} kategorii, ` +
      `${UNITS.length} jednostek, ${ingredients} składników.`,
  );
} finally {
  await prisma.$disconnect();
}
