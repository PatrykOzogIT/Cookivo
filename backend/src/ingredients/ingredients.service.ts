import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import { normalizeSearch } from '../common/text.js';
import { Prisma } from '../generated/prisma/client.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import type { ListIngredientsQuery, SaveIngredientDto } from './ingredients.dto.js';
import { checkNutrition } from './nutrition.js';

const isAdmin = (user?: AuthUser) => user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

const INCLUDE = {
  category: true,
  allergens: { include: { allergen: true }, orderBy: { allergen: { sortOrder: 'asc' } } },
  units: { include: { unit: true }, orderBy: { unit: { sortOrder: 'asc' } } },
  createdBy: { select: { id: true, username: true } },
} satisfies Prisma.IngredientInclude;

type IngredientRow = Prisma.IngredientGetPayload<{ include: typeof INCLUDE }>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipeCalculator: RecipeCalculatorService,
  ) {}

  async dictionaries() {
    const [allergens, categories, units, mealTypes] = await Promise.all([
      this.prisma.allergen.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.ingredientCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.unit.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.mealType.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    const strip = <T extends { id?: number; sortOrder: number }>({ id: _id, sortOrder: _s, ...rest }: T) =>
      rest;
    return {
      allergens: allergens.map(strip),
      categories: categories.map(strip),
      units: units.map(strip),
      mealTypes: mealTypes.map(strip),
    };
  }

  /**
   * Wyszukiwarka: dopasowanie fragmentu nazwy + tolerancja literówek (pg_trgm),
   * bez polskich znaków. Kolejność: nazwa zaczyna się od frazy → słowo zaczyna się
   * od frazy → podobieństwo → krótsza nazwa → alfabetycznie (polskie sortowanie).
   */
  async list(query: ListIngredientsQuery, user?: AuthUser): Promise<Page<ReturnType<typeof toDto>>> {
    const conditions: Prisma.Sql[] = [];

    if (query.mine && user) {
      conditions.push(Prisma.sql`i.created_by_id = ${user.id}::uuid`);
    } else if (query.status && isAdmin(user)) {
      conditions.push(Prisma.sql`i.status = ${query.status}::"IngredientStatus"`);
    } else if (user) {
      conditions.push(Prisma.sql`(i.status = 'APPROVED' OR i.created_by_id = ${user.id}::uuid)`);
    } else {
      conditions.push(Prisma.sql`i.status = 'APPROVED'`);
    }

    if (query.category) {
      conditions.push(
        Prisma.sql`i.category_id = (SELECT id FROM ingredient_categories WHERE code = ${query.category})`,
      );
    }
    if (query.excludeAllergens?.length) {
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM ingredient_allergens ia JOIN allergens a ON a.id = ia.allergen_id
        WHERE ia.ingredient_id = i.id AND a.code IN (${Prisma.join(query.excludeAllergens)}))`);
    }

    const q = query.q ? normalizeSearch(query.q) : '';
    const alphabetical =
      query.lang === 'en'
        ? Prisma.sql`coalesce(i.name_en, i.name_pl) COLLATE "en-x-icu"`
        : Prisma.sql`i.name_pl COLLATE "pl-x-icu"`;
    let order = alphabetical;
    if (q) {
      conditions.push(Prisma.sql`(i.search_text LIKE ${`%${q}%`} OR ${q} <% i.search_text)`);
      order = Prisma.sql`(i.search_text LIKE ${`${q}%`}) DESC,
        (i.search_text LIKE ${`% ${q}%`}) DESC,
        word_similarity(${q}, i.search_text) DESC,
        length(i.name_pl),
        ${alphabetical}`;
    }

    const where = Prisma.join(conditions, ' AND ');
    const offset = (query.page - 1) * query.pageSize;
    const [rows, [{ count }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT i.id FROM ingredients i WHERE ${where}
        ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM ingredients i WHERE ${where}`,
    ]);

    const ids = rows.map((r) => r.id);
    const found = await this.prisma.ingredient.findMany({ where: { id: { in: ids } }, include: INCLUDE });
    const byId = new Map(found.map((f) => [f.id, f]));
    return {
      items: ids.map((id) => toDto(byId.get(id)!, user)),
      total: Number(count),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string, user?: AuthUser) {
    return toDto(await this.findVisible(id, user), user);
  }

  async create(dto: SaveIngredientDto, user: AuthUser) {
    await this.validate(dto);
    const admin = isAdmin(user);
    const created = await this.prisma.ingredient
      .create({
        data: {
          ...(await this.toData(dto)),
          source: 'USER',
          // Admin nie musi czekać na akceptację własnego składnika
          status: admin ? 'APPROVED' : 'PENDING',
          reviewedById: admin ? user.id : null,
          reviewedAt: admin ? new Date() : null,
          createdById: user.id,
          allergens: { create: await this.allergenLinks(dto.allergens) },
          units: { create: dto.units.map((u) => ({ unitCode: u.code, grams: u.grams })) },
        },
        include: INCLUDE,
      })
      .catch(duplicateName);
    return toDto(created, user);
  }

  async update(id: string, dto: SaveIngredientDto, user: AuthUser) {
    const existing = await this.findVisible(id, user);
    if (!canEdit(existing, user)) throw new ForbiddenException({ code: 'FORBIDDEN' });
    await this.validate(dto, id);

    const admin = isAdmin(user);
    const allergens = await this.allergenLinks(dto.allergens);
    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.ingredientAllergen.deleteMany({ where: { ingredientId: id } });
        await tx.ingredientUnit.deleteMany({ where: { ingredientId: id } });
        return tx.ingredient.update({
          where: { id },
          data: {
            ...(await this.toData(dto)),
            // Poprawiony przez autora wraca do kolejki; admin zatwierdza od razu
            status: admin ? existing.status : 'PENDING',
            rejectionReason: admin ? existing.rejectionReason : null,
            allergens: { create: allergens },
            units: { create: dto.units.map((u) => ({ unitCode: u.code, grams: u.grams })) },
          },
          include: INCLUDE,
        });
      })
      .catch(duplicateName);
    // Przepisy z tym składnikiem mają zapisane sumy - przeliczamy je
    await this.recipeCalculator.recalculateForIngredient(id);
    return toDto(updated, user);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const existing = await this.findVisible(id, user);
    // Zatwierdzony składnik może usunąć tylko admin (w etapie 3 dojdzie blokada, gdy jest w przepisach)
    if (!isAdmin(user) && (existing.createdById !== user.id || existing.status === 'APPROVED')) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    await this.prisma.ingredient.delete({ where: { id } }).catch((err: unknown) => {
      // Składnik użyty w przepisach (klucz obcy) - nie usuwamy
      if (err instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2014'].includes(err.code)) {
        throw new ConflictException({ code: 'INGREDIENT_IN_USE' });
      }
      throw err;
    });
  }

  async review(id: string, decision: 'APPROVED' | 'REJECTED', admin: AuthUser, reason?: string) {
    const existing = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    const updated = await this.prisma.ingredient
      .update({
        where: { id },
        data: {
          status: decision,
          rejectionReason: decision === 'REJECTED' ? reason : null,
          reviewedById: admin.id,
          reviewedAt: new Date(),
        },
        include: INCLUDE,
      })
      .catch(duplicateName);
    await this.recipeCalculator.recalculateForIngredient(id);
    return toDto(updated, admin);
  }

  // ---------------------------------------------------------------------------

  private async findVisible(id: string, user?: AuthUser): Promise<IngredientRow> {
    const found = await this.prisma.ingredient.findUnique({ where: { id }, include: INCLUDE });
    const visible =
      found && (found.status === 'APPROVED' || isAdmin(user) || (user && found.createdById === user.id));
    // Cudzy niezatwierdzony składnik udaje, że nie istnieje
    if (!visible) throw new NotFoundException({ code: 'NOT_FOUND' });
    return found;
  }

  private async validate(dto: SaveIngredientDto, exceptId?: string): Promise<void> {
    if (containsProfanity(dto.namePl) || (dto.nameEn && containsProfanity(dto.nameEn))) {
      throw new BadRequestException({ code: 'NAME_OFFENSIVE' });
    }
    const problem = checkNutrition(dto);
    if (problem) throw new BadRequestException({ code: problem });

    const unitCodes = dto.units.map((u) => u.code);
    if (new Set(unitCodes).size !== unitCodes.length)
      throw new BadRequestException({ code: 'UNIT_DUPLICATE' });
    if (unitCodes.length) {
      const known = await this.prisma.unit.count({ where: { code: { in: unitCodes } } });
      if (known !== unitCodes.length) throw new BadRequestException({ code: 'UNIT_UNKNOWN' });
    }

    const duplicate = await this.prisma.ingredient.findFirst({
      where: {
        status: 'APPROVED',
        namePl: { equals: dto.namePl, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException({ code: 'INGREDIENT_EXISTS', id: duplicate.id });
  }

  private async toData(dto: SaveIngredientDto) {
    const category = await this.prisma.ingredientCategory.findUnique({ where: { code: dto.categoryCode } });
    if (!category) throw new BadRequestException({ code: 'CATEGORY_UNKNOWN' });
    return {
      namePl: dto.namePl,
      nameEn: dto.nameEn || null,
      searchText: normalizeSearch(`${dto.namePl} ${dto.nameEn ?? ''}`),
      categoryId: category.id,
      kcal: dto.kcal,
      protein: dto.protein,
      fat: dto.fat,
      saturatedFat: dto.saturatedFat ?? null,
      carbs: dto.carbs,
      sugars: dto.sugars ?? null,
      fiber: dto.fiber ?? null,
      salt: dto.salt ?? null,
      density: dto.density ?? null,
    };
  }

  private async allergenLinks(codes: string[]) {
    if (!codes.length) return [];
    const found = await this.prisma.allergen.findMany({ where: { code: { in: codes } } });
    if (found.length !== codes.length) throw new BadRequestException({ code: 'ALLERGEN_UNKNOWN' });
    return found.map((a) => ({ allergenId: a.id }));
  }
}

function canEdit(row: { createdById: string | null; status: string }, user?: AuthUser): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  // Autor może poprawiać, dopóki składnik nie jest zatwierdzony
  return row.createdById === user.id && row.status !== 'APPROVED';
}

/** Unikalny indeks na nazwie zatwierdzonych składników → czytelny błąd zamiast 500. */
function duplicateName(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictException({ code: 'INGREDIENT_EXISTS' });
  }
  throw err;
}

export function toDto(row: IngredientRow, user?: AuthUser) {
  const own = !!user && row.createdById === user.id;
  return {
    id: row.id,
    namePl: row.namePl,
    nameEn: row.nameEn,
    category: {
      code: row.category.code,
      namePl: row.category.namePl,
      nameEn: row.category.nameEn,
      icon: row.category.icon,
    },
    status: row.status,
    source: row.source,
    sourceRef: row.sourceRef,
    nutrition: {
      kcal: row.kcal,
      protein: row.protein,
      fat: row.fat,
      saturatedFat: row.saturatedFat,
      carbs: row.carbs,
      sugars: row.sugars,
      fiber: row.fiber,
      salt: row.salt,
    },
    density: row.density,
    allergens: row.allergens.map(({ allergen: a }) => ({
      code: a.code,
      namePl: a.namePl,
      nameEn: a.nameEn,
      icon: a.icon,
    })),
    units: row.units.map(({ unit: u, grams }) => ({
      code: u.code,
      namePl: u.namePl,
      nameEn: u.nameEn,
      grams,
    })),
    createdBy: row.createdBy ? { username: row.createdBy.username } : null,
    isOwn: own,
    canEdit: canEdit(row, user),
    canDelete: isAdmin(user) || (own && row.status !== 'APPROVED'),
    // Powód odrzucenia widzi tylko autor i admin
    rejectionReason: own || isAdmin(user) ? row.rejectionReason : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type IngredientDto = ReturnType<typeof toDto>;
