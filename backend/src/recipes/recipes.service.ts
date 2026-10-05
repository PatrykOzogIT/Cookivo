import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import { ownerScope } from '../common/owner-scope.js';
import { normalizeSearch } from '../common/text.js';
import { Prisma } from '../generated/prisma/client.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PhotosService, toPhotoDto } from '../photos/photos.service.js';
import { HouseholdService } from '../household/household.service.js';
import { MailService } from '../mail/mail.service.js';
import { householdMatesSql, recipeForMe, recipeForUsers, recipeScore } from '../profile/personalization.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ingredientForMath, RecipeCalculatorService, subRecipeForMath } from './recipe-calculator.service.js';
import { derivedNutrition, gramsFor, type NutritionValues } from './recipe-math.js';
import type { ListRecipesQuery, SaveRecipeDto } from './recipes.dto.js';

/** Maksymalne zagnieżdżenie podprzepisów (zupa ← rosół ← wywar…) */
const MAX_DEPTH = 4;

const isAdmin = (user?: AuthUser) => user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

const LIST_INCLUDE = {
  author: { select: { id: true, username: true, nameHiddenAt: true } },
  mealTypes: { include: { mealType: true }, orderBy: { mealType: { sortOrder: 'asc' } } },
  allergens: { include: { allergen: true }, orderBy: { allergen: { sortOrder: 'asc' } } },
  photos: { where: { position: { not: null } }, orderBy: { position: 'asc' }, take: 1 },
} satisfies Prisma.RecipeInclude;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  photos: { where: { position: { not: null } }, orderBy: { position: 'asc' } },
  steps: { include: { photo: true }, orderBy: { position: 'asc' } },
  ingredients: {
    orderBy: { position: 'asc' },
    include: {
      ingredient: {
        include: {
          units: { include: { unit: true } },
          allergens: { include: { allergen: true } },
        },
      },
      subRecipe: {
        select: { id: true, title: true, servings: true, visibility: true, hiddenAt: true, authorId: true },
      },
    },
  },
  _count: { select: { usedIn: true } },
  variantOf: {
    select: {
      id: true,
      title: true,
      visibility: true,
      hiddenAt: true,
      authorId: true,
      author: { select: { id: true, username: true, nameHiddenAt: true } },
    },
  },
} satisfies Prisma.RecipeInclude;

type ListRow = Prisma.RecipeGetPayload<{ include: typeof LIST_INCLUDE }>;
type DetailRow = Prisma.RecipeGetPayload<{ include: typeof DETAIL_INCLUDE }>;

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: RecipeCalculatorService,
    private readonly photos: PhotosService,
    private readonly household: HouseholdService,
    private readonly mail: MailService,
  ) {}

  async list(query: ListRecipesQuery, user?: AuthUser) {
    const c: Prisma.Sql[] = [];
    if (query.mine && user) c.push(Prisma.sql`r.author_id = ${user.id}::uuid`);
    else if (!isAdmin(user)) {
      c.push(
        user
          ? Prisma.sql`((r.visibility = 'PUBLIC' AND r.hidden_at IS NULL) OR r.author_id = ${user.id}::uuid
              OR (r.visibility = 'HOUSEHOLD' AND r.hidden_at IS NULL AND r.author_id IN ${householdMatesSql(user.id)}))`
          : Prisma.sql`(r.visibility = 'PUBLIC' AND r.hidden_at IS NULL)`,
      );
    }
    if (query.household && user) {
      c.push(Prisma.sql`r.visibility = 'HOUSEHOLD'
        AND (r.author_id = ${user.id}::uuid OR r.author_id IN ${householdMatesSql(user.id)})`);
    }
    if (query.mealTypes?.length) {
      c.push(Prisma.sql`EXISTS (SELECT 1 FROM recipe_meal_types m
        WHERE m.recipe_id = r.id AND m.meal_type_code IN (${Prisma.join(query.mealTypes)}))`);
    }
    if (query.excludeAllergens?.length) {
      c.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM recipe_allergens ra JOIN allergens a ON a.id = ra.allergen_id
        WHERE ra.recipe_id = r.id AND a.code IN (${Prisma.join(query.excludeAllergens)}))`);
    }
    if (query.maxKcal !== undefined) c.push(Prisma.sql`r.kcal_per_serving <= ${query.maxKcal}`);
    if (query.maxMinutes !== undefined) {
      c.push(Prisma.sql`coalesce(r.prep_minutes, 0) + coalesce(r.cook_minutes, 0) <= ${query.maxMinutes}`);
    }
    if (query.canBeIngredient) c.push(Prisma.sql`r.can_be_ingredient = true`);
    // "Dla nas" ma pierwszeństwo przed "Dla mnie" (obejmuje też mnie)
    const us = query.forUs && user ? await this.household.forUsContext(user.id) : null;
    if (us) c.push(recipeForUsers(us.allergenUserIds, us.memberIds));
    else if (query.forMe && user) c.push(recipeForMe(user.id));

    const collate = query.lang === 'en' ? Prisma.sql`"en-x-icu"` : Prisma.sql`"pl-x-icu"`;
    // "Najpierw z tego, co mam": udział składników przepisu, które są w lodówce
    let pantryScore = Prisma.sql`0`;
    if (query.sort === 'fromPantry' && user) {
      const scope = await ownerScope(this.prisma, user.id);
      const owner = scope.householdId
        ? Prisma.sql`p.household_id = ${scope.householdId}::uuid`
        : Prisma.sql`p.user_id = ${user.id}::uuid`;
      pantryScore = Prisma.sql`(SELECT coalesce(avg(CASE WHEN EXISTS (SELECT 1 FROM pantry_items p
          WHERE p.ingredient_id = ri.ingredient_id AND ${owner}) THEN 1.0 ELSE 0 END), 0)
        FROM recipe_ingredients ri WHERE ri.recipe_id = r.id AND ri.ingredient_id IS NOT NULL)`;
    }
    const orders: Record<ListRecipesQuery['sort'], Prisma.Sql> = {
      newest: Prisma.sql`r.created_at DESC`,
      kcal: Prisma.sql`r.kcal_per_serving ASC`,
      time: Prisma.sql`coalesce(r.prep_minutes, 0) + coalesce(r.cook_minutes, 0) ASC`,
      name: Prisma.sql`r.title COLLATE ${collate}`,
      // Dopasowanie: upodobania (moje / gospodarstwa) + moja ocena przepisu (5 gwiazdek podbija, 1 obniża)
      forYou: user
        ? Prisma.sql`(${Prisma.join((us?.memberIds ?? [user.id]).map(recipeScore), ' + ')}
            + coalesce((SELECT (rr.stars - 3) * 2 FROM recipe_ratings rr
                WHERE rr.recipe_id = r.id AND rr.user_id = ${user.id}::uuid), 0)) DESC, r.created_at DESC`
        : Prisma.sql`r.created_at DESC`,
      rating: Prisma.sql`r.rating_avg DESC NULLS LAST, r.rating_count DESC, r.created_at DESC`,
      fromPantry: Prisma.sql`${pantryScore} DESC, r.created_at DESC`,
    };
    let order = orders[query.sort];
    const q = query.q ? normalizeSearch(query.q) : '';
    if (q) {
      c.push(Prisma.sql`(r.search_text LIKE ${`%${q}%`} OR ${q} <% r.search_text)`);
      order = Prisma.sql`(r.search_text LIKE ${`${q}%`}) DESC, word_similarity(${q}, r.search_text) DESC, ${order}`;
    }

    const where = c.length ? Prisma.join(c, ' AND ') : Prisma.sql`TRUE`;
    const offset = (query.page - 1) * query.pageSize;
    const [rows, [{ count }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT r.id FROM recipes r WHERE ${where}
        ORDER BY ${order}, r.id LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM recipes r WHERE ${where}`,
    ]);
    const ids = rows.map((r) => r.id);
    const [found, mine] = await Promise.all([
      this.prisma.recipe.findMany({ where: { id: { in: ids } }, include: LIST_INCLUDE }),
      this.myAllergens(user),
    ]);
    const byId = new Map(found.map((f) => [f.id, f]));
    return {
      items: ids.map((id) => toListDto(byId.get(id)!, user, mine)),
      total: Number(count),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string, user?: AuthUser) {
    const [recipe, mates] = await Promise.all([
      this.prisma.recipe.findUnique({ where: { id }, include: DETAIL_INCLUDE }),
      this.mates(user),
    ]);
    if (!recipe || !canView(recipe, user, mates)) throw new NotFoundException({ code: 'NOT_FOUND' });
    const [myRating, variantsCount] = await Promise.all([
      user
        ? this.prisma.recipeRating.findUnique({
            where: { recipeId_userId: { recipeId: id, userId: user.id } },
          })
        : null,
      this.prisma.recipe.count({
        where: { variantOfId: recipe.variantOfId ?? recipe.id, visibility: 'PUBLIC', hiddenAt: null },
      }),
    ]);
    return {
      ...toDetailDto(recipe, user, await this.myAllergens(user), mates),
      myRating: myRating ? { stars: myRating.stars, comment: myRating.comment } : null,
      /** Publiczne warianty oryginału (bez samego siebie, jeśli to wariant) */
      variantsCount:
        variantsCount - (recipe.variantOfId && recipe.visibility === 'PUBLIC' && !recipe.hiddenAt ? 1 : 0),
    };
  }

  /**
   * "Zrób własną wersję": prywatna kopia przepisu wskazująca na pierwotny oryginał.
   * Zdjęć nie kopiujemy (należą do oryginału); kroki i składniki - tak.
   */
  async createVariant(id: string, user: AuthUser) {
    const original = await this.get(id, user);
    const source = await this.prisma.recipe.findUniqueOrThrow({
      where: { id },
      include: {
        mealTypes: true,
        ingredients: { orderBy: { position: 'asc' } },
        steps: { orderBy: { position: 'asc' } },
      },
    });
    const dto = {
      title: source.title,
      description: source.description ?? undefined,
      servings: source.servings,
      prepMinutes: source.prepMinutes,
      cookMinutes: source.cookMinutes,
      difficulty: source.difficulty,
      visibility: 'PRIVATE' as const,
      canBeIngredient: false,
      cookedGrams: source.cookedGrams,
      variantNote: null,
      mealTypes: source.mealTypes.map((m) => m.mealTypeCode),
      ingredients: source.ingredients.map((l) => ({
        ingredientId: l.ingredientId ?? undefined,
        subRecipeId: l.subRecipeId ?? undefined,
        amount: l.amount,
        unitCode: l.unitCode,
        groupName: l.groupName ?? undefined,
        note: l.note ?? undefined,
      })),
      steps: source.steps.map((s) => ({ text: s.text, timerMinutes: s.timerMinutes ?? undefined })),
      photoIds: [],
    } as SaveRecipeDto;
    const created = await this.create(dto, user);
    await this.prisma.recipe.update({
      where: { id: created.id },
      data: { variantOfId: source.variantOfId ?? original.id },
    });
    return this.get(created.id, user);
  }

  /** Oryginał i jego warianty widoczne dla czytającego (do sekcji "Alternatywy") */
  async variants(id: string, user?: AuthUser) {
    const current = await this.get(id, user);
    const rootId = current.variantOf?.id ?? id;
    const mates = await this.mates(user);
    const rows = await this.prisma.recipe.findMany({
      where: { OR: [{ id: rootId }, { variantOfId: rootId }], NOT: { id } },
      include: LIST_INCLUDE,
      orderBy: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const mine = await this.myAllergens(user);
    const visible = rows.filter((r) => canView(r, user, mates));
    return {
      originalId: rootId,
      items: visible.map((r) => ({
        ...toListDto(r, user, mine),
        variantNote: r.variantNote,
        isOriginal: r.id === rootId,
      })),
    };
  }

  async create(dto: SaveRecipeDto, user: AuthUser) {
    const id = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.recipe.create({
          data: { ...recipeFields(dto), authorId: user.id },
          select: { id: true },
        });
        await this.writeContent(tx, created.id, dto, user, true);
        return created.id;
      },
      { timeout: 20_000 },
    );
    return this.get(id, user);
  }

  async update(id: string, dto: SaveRecipeDto, user: AuthUser) {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing || !canView(existing, user, await this.mates(user))) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    if (!canEdit(existing, user)) throw new ForbiddenException({ code: 'FORBIDDEN' });
    await this.assertNotBreakingOthers(existing, dto);

    const removedPhotos = await this.prisma.$transaction(
      async (tx) => {
        await tx.recipe.update({ where: { id }, data: recipeFields(dto) });
        return this.writeContent(tx, id, dto, user, false);
      },
      { timeout: 20_000 },
    );
    await this.photos.delete(removedPhotos);
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const existing = await this.prisma.recipe.findUnique({
      where: { id },
      include: { photos: { select: { id: true } }, _count: { select: { usedIn: true } } },
    });
    if (!existing || !canView(existing, user, await this.mates(user))) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    if (!canEdit(existing, user)) throw new ForbiddenException({ code: 'FORBIDDEN' });
    if (existing._count.usedIn > 0) throw new ConflictException({ code: 'RECIPE_IN_USE' });
    await this.prisma.recipe.delete({ where: { id } });
    await this.photos.delete(existing.photos.map((p) => p.id));
  }

  async setHidden(id: string, admin: AuthUser, reason: string | null) {
    const existing = await this.prisma.recipe.findUnique({ where: { id }, include: { author: true } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    // Autor dowiaduje się o ukryciu mailem (z powodem)
    if (reason && !existing.hiddenAt && existing.author) {
      await this.mail.send(existing.author.email, 'contentHidden', existing.author.locale, {
        username: existing.author.username,
        title: existing.title,
        reason,
      });
    }
    await this.prisma.recipe.update({
      where: { id },
      data: reason
        ? { hiddenAt: new Date(), hiddenById: admin.id, hiddenReason: reason }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null },
    });
    return this.get(id, admin);
  }

  /** Domownicy zalogowanego - widzą nawzajem swoje przepisy "dla gospodarstwa" */
  private async mates(user?: AuthUser): Promise<Set<string>> {
    return new Set(user ? await this.household.mateIds(user.id) : []);
  }

  /** Kody alergenów zalogowanego - do ostrzeżeń "zawiera Twój alergen" */
  private async myAllergens(user?: AuthUser): Promise<Set<string>> {
    if (!user) return new Set();
    const rows = await this.prisma.userAllergen.findMany({
      where: { userId: user.id },
      include: { allergen: true },
    });
    return new Set(rows.map((r) => r.allergen.code));
  }

  // ---------------------------------------------------------------------------

  /**
   * Zapisuje typy posiłków, składniki, kroki i zdjęcia, a potem przelicza wartości.
   * Zwraca id zdjęć odpiętych od przepisu (do usunięcia z dysku po transakcji).
   */
  private async writeContent(
    tx: Prisma.TransactionClient,
    recipeId: string,
    dto: SaveRecipeDto,
    user: AuthUser,
    isNew: boolean,
  ): Promise<string[]> {
    for (const text of [dto.title, dto.description ?? '', ...dto.steps.map((s) => s.text)]) {
      if (containsProfanity(text)) throw new BadRequestException({ code: 'CONTENT_OFFENSIVE' });
    }

    if (dto.mealTypes.length) {
      const known = await tx.mealType.count({ where: { code: { in: dto.mealTypes } } });
      if (known !== dto.mealTypes.length) throw new BadRequestException({ code: 'MEAL_TYPE_UNKNOWN' });
    }

    const lines = await this.resolveLines(tx, recipeId, dto, user, isNew);
    const { gallery, stepPhotos, removed } = await this.resolvePhotos(tx, recipeId, dto, user);

    await tx.recipeMealType.deleteMany({ where: { recipeId } });
    await tx.recipeIngredient.deleteMany({ where: { recipeId } });
    await tx.recipeStep.deleteMany({ where: { recipeId } });

    if (dto.mealTypes.length) {
      await tx.recipeMealType.createMany({
        data: dto.mealTypes.map((mealTypeCode) => ({ recipeId, mealTypeCode })),
      });
    }
    await tx.recipeIngredient.createMany({
      data: lines.map((l, position) => ({ ...l, recipeId, position })),
    });

    await tx.photo.updateMany({ where: { id: { in: removed } }, data: { recipeId: null } });
    for (const [position, id] of gallery.entries()) {
      await tx.photo.update({ where: { id }, data: { recipeId, position } });
    }
    for (const id of stepPhotos) {
      await tx.photo.update({ where: { id }, data: { recipeId, position: null } });
    }
    await tx.recipeStep.createMany({
      data: dto.steps.map((s, position) => ({
        recipeId,
        position,
        text: s.text,
        timerMinutes: s.timerMinutes ?? null,
        photoId: s.photoId ?? null,
      })),
    });

    await this.calculator.recalculate(recipeId, tx);
    await this.calculator.recalculateUpstream(recipeId, tx);
    return removed;
  }

  private async resolveLines(
    tx: Prisma.TransactionClient,
    recipeId: string,
    dto: SaveRecipeDto,
    user: AuthUser,
    isNew: boolean,
  ) {
    const ingredientIds = dto.ingredients.flatMap((l) => (l.ingredientId ? [l.ingredientId] : []));
    const subIds = dto.ingredients.flatMap((l) => (l.subRecipeId ? [l.subRecipeId] : []));
    const [ingredients, subs, unitMl, mates] = await Promise.all([
      tx.ingredient.findMany({ where: { id: { in: ingredientIds } }, include: { units: true } }),
      tx.recipe.findMany({ where: { id: { in: subIds } } }),
      this.calculator.unitMl(tx),
      this.mates(user),
    ]);
    const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
    const subById = new Map(subs.map((s) => [s.id, s]));
    const isPublic = dto.visibility === 'PUBLIC';
    // Przepis widoczny dla innych (publiczny lub dla gospodarstwa) nie może opierać się na rzeczach,
    // których ci inni nie zobaczą
    const isShared = dto.visibility !== 'PRIVATE';

    if (!isNew && subIds.length) await this.assertNoCycle(tx, recipeId, subIds);

    return dto.ingredients.map((line, index) => {
      const fail = (code: string): never => {
        throw new BadRequestException({ code, index });
      };
      if (!!line.ingredientId === !!line.subRecipeId) fail('LINE_INVALID');

      let grams: number | 'UNIT_NOT_ALLOWED';
      if (line.ingredientId) {
        const ing = ingredientById.get(line.ingredientId);
        const visible = ing && (ing.status === 'APPROVED' || isAdmin(user) || ing.createdById === user.id);
        if (!ing || !visible) return fail('INGREDIENT_UNKNOWN');
        // W przepisie widocznym dla innych tylko zatwierdzone składniki - inni nie widzą oczekujących
        if (isShared && ing.status !== 'APPROVED') fail('INGREDIENT_NOT_APPROVED');
        grams = gramsFor(line.amount, line.unitCode, { ingredient: ingredientForMath(ing) }, unitMl);
      } else {
        const sub = subById.get(line.subRecipeId!);
        if (!sub || sub.id === recipeId || !canView(sub, user, mates)) return fail('SUBRECIPE_UNKNOWN');
        if (!sub.canBeIngredient) fail('SUBRECIPE_NOT_ALLOWED');
        if (isPublic && (sub.visibility !== 'PUBLIC' || sub.hiddenAt)) fail('SUBRECIPE_PRIVATE');
        if (isShared && (sub.visibility === 'PRIVATE' || sub.hiddenAt)) fail('SUBRECIPE_PRIVATE');
        grams = gramsFor(line.amount, line.unitCode, { subRecipe: subRecipeForMath(sub) }, unitMl);
      }
      if (grams === 'UNIT_NOT_ALLOWED') return fail('UNIT_NOT_ALLOWED');

      return {
        ingredientId: line.ingredientId ?? null,
        subRecipeId: line.subRecipeId ?? null,
        amount: line.amount,
        unitCode: line.unitCode,
        grams: Math.round(grams * 10) / 10,
        groupName: line.groupName ?? null,
        note: line.note ?? null,
      };
    });
  }

  /** Podprzepis nie może (pośrednio) zawierać edytowanego przepisu; ograniczamy też głębokość. */
  private async assertNoCycle(
    tx: Prisma.TransactionClient,
    recipeId: string,
    subIds: string[],
  ): Promise<void> {
    let frontier = [...new Set(subIds)];
    for (let depth = 1; frontier.length; depth++) {
      if (frontier.includes(recipeId)) throw new BadRequestException({ code: 'RECIPE_CYCLE' });
      if (depth >= MAX_DEPTH) throw new BadRequestException({ code: 'RECIPE_TOO_DEEP' });
      const next = await tx.recipeIngredient.findMany({
        where: { recipeId: { in: frontier }, subRecipeId: { not: null } },
        select: { subRecipeId: true },
      });
      frontier = [...new Set(next.map((n) => n.subRecipeId!))];
    }
  }

  private async resolvePhotos(
    tx: Prisma.TransactionClient,
    recipeId: string,
    dto: SaveRecipeDto,
    user: AuthUser,
  ) {
    const gallery = dto.photoIds;
    const stepPhotos = dto.steps.flatMap((s) => (s.photoId ? [s.photoId] : []));
    const all = [...gallery, ...stepPhotos];
    if (new Set(all).size !== all.length) throw new BadRequestException({ code: 'PHOTO_INVALID' });

    const found = await tx.photo.findMany({ where: { id: { in: all } } });
    const ok = found.filter(
      (p) => p.recipeId === recipeId || (p.recipeId === null && (p.ownerId === user.id || isAdmin(user))),
    );
    if (ok.length !== all.length) throw new BadRequestException({ code: 'PHOTO_INVALID' });

    const current = await tx.photo.findMany({ where: { recipeId }, select: { id: true } });
    const keep = new Set(all);
    return { gallery, stepPhotos, removed: current.filter((p) => !keep.has(p.id)).map((p) => p.id) };
  }

  /**
   * Nie pozwalamy "wyciągnąć dywanu" spod przepisów, które używają tego jako składnika:
   * wyłączenie "może być składnikiem" gdy jest używany, albo ukrycie (prywatny) gdy używają go inni.
   */
  private async assertNotBreakingOthers(
    existing: { id: string; authorId: string | null; visibility: string; canBeIngredient: boolean },
    dto: SaveRecipeDto,
  ): Promise<void> {
    if (existing.canBeIngredient && !dto.canBeIngredient) {
      const used = await this.prisma.recipeIngredient.count({ where: { subRecipeId: existing.id } });
      if (used) throw new ConflictException({ code: 'RECIPE_IN_USE' });
    }
    // Zawężenie widoczności (publiczny, grupa, prywatny) - nie, jeśli używają go przepisy innych autorów
    if (
      VISIBILITY_RANK[dto.visibility] < VISIBILITY_RANK[existing.visibility as SaveRecipeDto['visibility']]
    ) {
      const usedByOthers = await this.prisma.recipeIngredient.count({
        where: {
          subRecipeId: existing.id,
          recipe: { OR: [{ authorId: null }, { authorId: { not: existing.authorId ?? undefined } }] },
        },
      });
      if (usedByOthers) throw new ConflictException({ code: 'RECIPE_IN_USE' });
    }
  }
}

// --- Uprawnienia --------------------------------------------------------------

const VISIBILITY_RANK: Record<SaveRecipeDto['visibility'], number> = { PRIVATE: 0, HOUSEHOLD: 1, PUBLIC: 2 };

function canView(
  r: { visibility: string; hiddenAt: Date | null; authorId: string | null },
  user?: AuthUser,
  mates: Set<string> = new Set(),
) {
  if (isAdmin(user)) return true;
  if (user && r.authorId === user.id) return true;
  if (r.hiddenAt) return false;
  if (r.visibility === 'HOUSEHOLD') return !!r.authorId && mates.has(r.authorId);
  return r.visibility === 'PUBLIC';
}

function canEdit(r: { authorId: string | null }, user?: AuthUser) {
  return !!user && (isAdmin(user) || r.authorId === user.id);
}

function recipeFields(dto: SaveRecipeDto) {
  return {
    title: dto.title,
    description: dto.description ?? null,
    searchText: normalizeSearch(dto.title),
    servings: dto.servings,
    prepMinutes: dto.prepMinutes ?? null,
    cookMinutes: dto.cookMinutes ?? null,
    difficulty: dto.difficulty ?? null,
    visibility: dto.visibility,
    canBeIngredient: dto.canBeIngredient,
    cookedGrams: dto.cookedGrams ?? null,
    variantNote: dto.variantNote ?? null,
  };
}

// --- Odpowiedzi API -------------------------------------------------------------

const localized = (x: { code: string; namePl: string; nameEn: string; icon?: string }) => ({
  code: x.code,
  namePl: x.namePl,
  nameEn: x.nameEn,
  ...(x.icon ? { icon: x.icon } : {}),
});

function totals(r: DetailRow | ListRow): NutritionValues {
  return {
    kcal: r.kcal,
    protein: r.protein,
    fat: r.fat,
    saturatedFat: r.saturatedFat,
    carbs: r.carbs,
    sugars: r.sugars,
    fiber: r.fiber,
    salt: r.salt,
  };
}

function toListDto(r: ListRow, user?: AuthUser, myAllergens = new Set<string>()) {
  const own = !!user && r.authorId === user.id;
  return {
    id: r.id,
    title: r.title,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    difficulty: r.difficulty,
    visibility: r.visibility,
    canBeIngredient: r.canBeIngredient,
    hidden: !!r.hiddenAt,
    kcalPerServing: r.kcalPerServing,
    mealTypes: r.mealTypes.map((m) => localized(m.mealType)),
    allergens: r.allergens.map((a) => localized(a.allergen)),
    cover: r.photos[0] ? toPhotoDto(r.photos[0]) : null,
    // Nazwa ukryta po zgłoszeniach: autor jak anonimowy
    author: r.author && !r.author.nameHiddenAt ? { id: r.author.id, username: r.author.username } : null,
    isOwn: own,
    /** Alergeny przepisu, na które uważa zalogowany użytkownik */
    myAllergens: r.allergens.map((a) => a.allergen.code).filter((code) => myAllergens.has(code)),
    ratingAvg: r.ratingAvg === null ? null : Math.round(r.ratingAvg * 10) / 10,
    ratingCount: r.ratingCount,
    isVariant: r.variantOfId !== null,
  };
}

function toDetailDto(
  r: DetailRow,
  user?: AuthUser,
  myAllergens = new Set<string>(),
  mates: Set<string> = new Set(),
) {
  const own = !!user && r.authorId === user.id;
  const derived = derivedNutrition({
    totals: totals(r),
    totalGrams: r.totalGrams,
    cookedGrams: r.cookedGrams,
    servings: r.servings,
  });
  return {
    ...toListDto(r, user, myAllergens),
    description: r.description,
    cookedGrams: r.cookedGrams,
    totalGrams: r.totalGrams,
    nutrition: { total: totals(r), ...derived },
    photos: r.photos.map(toPhotoDto),
    ingredients: r.ingredients.map((l) => ({
      id: l.id,
      groupName: l.groupName,
      amount: l.amount,
      unitCode: l.unitCode,
      grams: l.grams,
      note: l.note,
      ingredient: l.ingredient
        ? {
            id: l.ingredient.id,
            namePl: l.ingredient.namePl,
            nameEn: l.ingredient.nameEn,
            density: l.ingredient.density,
            units: l.ingredient.units.map((u) => ({ ...localized(u.unit), grams: u.grams })),
            allergens: l.ingredient.allergens.map((a) => a.allergen.code),
          }
        : null,
      subRecipe: l.subRecipe
        ? {
            id: l.subRecipe.id,
            title: l.subRecipe.title,
            servings: l.subRecipe.servings,
            // Link tylko, jeśli czytający może zobaczyć podprzepis
            viewable: canView(l.subRecipe, user, mates),
          }
        : null,
    })),
    steps: r.steps.map((s) => ({
      text: s.text,
      timerMinutes: s.timerMinutes,
      photo: s.photo ? toPhotoDto(s.photo) : null,
    })),
    usedInCount: r._count.usedIn,
    variantNote: r.variantNote,
    /** Oryginał, na którym oparto wariant (link tylko, jeśli czytający go widzi) */
    variantOf: r.variantOf
      ? {
          id: r.variantOf.id,
          title: r.variantOf.title,
          author: r.variantOf.author && !r.variantOf.author.nameHiddenAt ? r.variantOf.author.username : null,
          viewable: canView(r.variantOf, user, mates),
        }
      : null,
    canEdit: canEdit(r, user),
    hiddenReason: own || isAdmin(user) ? r.hiddenReason : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type RecipeDetailDto = ReturnType<typeof toDetailDto>;
