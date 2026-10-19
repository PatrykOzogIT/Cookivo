import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { AuthUser } from '../common/auth.decorators.js';
import { normalizeSearch } from '../common/text.js';
import type { Env } from '../config/env.js';
import { ListIngredientsQuery } from '../ingredients/ingredients.dto.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { RecipeExtractor, type Extraction, type ImportImage } from './recipe-extractor.js';

export const MAX_IMPORT_PHOTOS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Retencja liczników użycia (polityka prywatności) */
const KEEP_MS = 90 * DAY_MS;
/** Dłuższy bok zdjęcia wysyłanego do modelu - więcej nie poprawia odczytu, a podnosi koszt */
const MAX_EDGE = 1568;

type Candidate = Awaited<ReturnType<IngredientsService['list']>>['items'][number];

/** Składnik z bazy w kształcie, którego używa formularz przepisu */
function lineItem(c: Candidate) {
  return { id: c.id, namePl: c.namePl, nameEn: c.nameEn, density: c.density, units: c.units };
}

/**
 * Import przepisu ze zdjęć: odczyt przez Claude → szkic przepisu z dopasowanymi składnikami z bazy.
 * Nic nie zapisujemy jako przepis - użytkownik sprawdza i poprawia szkic w formularzu.
 * Zdjęć nie przechowujemy; liczymy tylko użycie (limity i koszty).
 */
@Injectable()
export class RecipeImportService {
  private readonly logger = new Logger(RecipeImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: RecipeExtractor,
    private readonly ingredients: IngredientsService,
    private readonly calculator: RecipeCalculatorService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get dailyLimit() {
    return this.config.get('RECIPE_IMPORT_DAILY_LIMIT', { infer: true });
  }

  private get monthlyLimit() {
    return this.config.get('RECIPE_IMPORT_MONTHLY_LIMIT', { infer: true });
  }

  async status(userId: string) {
    const used = await this.usedToday(userId);
    return {
      enabled: this.extractor.enabled,
      dailyLimit: this.dailyLimit,
      remaining: Math.max(0, this.dailyLimit - used),
      maxPhotos: MAX_IMPORT_PHOTOS,
    };
  }

  async import(user: AuthUser, files: Buffer[], lang: 'pl' | 'en') {
    if (!this.extractor.enabled) throw new ServiceUnavailableException({ code: 'IMPORT_DISABLED' });
    if (!files.length || files.length > MAX_IMPORT_PHOTOS) {
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    }
    if ((await this.usedToday(user.id)) >= this.dailyLimit) {
      throw new HttpException({ code: 'IMPORT_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((await this.usedThisMonth()) >= this.monthlyLimit) {
      throw new HttpException({ code: 'IMPORT_BUSY' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const images = await Promise.all(files.map(toModelImage));

    // Liczymy próbę przed wywołaniem - nieudane odczyty też kosztują
    const record = await this.prisma.recipeImport.create({
      data: { userId: user.id, photos: images.length },
    });
    void this.purgeOld();

    let extraction: Extraction;
    try {
      const result = await this.extractor.extract(images, lang);
      extraction = result.extraction;
      await this.prisma.recipeImport.update({
        where: { id: record.id },
        data: { success: true, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      });
    } catch (err) {
      this.logger.warn(`Import przepisu nieudany: ${(err as Error).message}`);
      throw new HttpException({ code: 'IMPORT_FAILED' }, HttpStatus.BAD_GATEWAY);
    }
    if (!extraction.isRecipe) {
      throw new HttpException(
        { code: 'IMPORT_NOT_RECIPE', warnings: extraction.warnings },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.toDraft(extraction, user);
  }

  /** Szkic przepisu: dopasowanie składników do bazy i sprawdzenie jednostek */
  private async toDraft(e: Extraction, user: AuthUser) {
    const unitMl = await this.calculator.unitMl();
    const ingredients = await Promise.all(
      e.ingredients.map(async (line) => {
        const q = line.name.trim();
        const found = q
          ? (await this.ingredients.list(Object.assign(new ListIngredientsQuery(), { q, pageSize: 4 }), user))
              .items
          : [];
        const best = found[0];
        const match = best && isConfidentMatch(q, best) ? best : null;
        let unitCode: string | null = line.unit;
        let unitProblem = false;
        if (match && unitCode && !unitAllowed(unitCode, match, unitMl)) {
          // Np. "łyżka" przy składniku bez gęstości - użytkownik wybierze jednostkę sam
          unitCode = null;
          unitProblem = true;
        }
        return {
          text: line.text,
          name: q,
          amount: line.amount,
          unitCode,
          note: line.note,
          match: match ? lineItem(match) : null,
          /** Podpowiedzi, gdy nie ma pewnego dopasowania */
          suggestions: match ? [] : found.slice(0, 3).map(lineItem),
          uncertain: line.uncertain,
          unitProblem,
        };
      }),
    );
    return {
      title: e.title.trim().slice(0, 150),
      description: e.description?.trim().slice(0, 2000) || null,
      servings: e.servings && e.servings > 0 && e.servings <= 100 ? e.servings : null,
      prepMinutes: minutes(e.prepMinutes, 1440),
      cookMinutes: minutes(e.cookMinutes, 4320),
      ingredients,
      steps: e.steps.map((s) => s.trim()).filter(Boolean),
      warnings: e.warnings,
    };
  }

  private async usedToday(userId: string): Promise<number> {
    return this.prisma.recipeImport.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
  }

  private async usedThisMonth(): Promise<number> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.prisma.recipeImport.count({ where: { createdAt: { gte: start } } });
  }

  private async purgeOld(): Promise<void> {
    try {
      await this.prisma.recipeImport.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } },
      });
    } catch {
      // sprzątanie nie może psuć importu
    }
  }
}

/** Zdjęcie dla modelu: obrót wg EXIF, dłuższy bok ≤ 1568 px, JPEG, bez metadanych */
async function toModelImage(buffer: Buffer): Promise<ImportImage> {
  try {
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') };
  } catch {
    throw new BadRequestException({ code: 'PHOTO_INVALID' });
  }
}

/**
 * Pewne dopasowanie: nazwa z bazy jest tą samą nazwą albo zaczyna się od niej
 * ("mleko" → "Mleko 3,2%", "mąka pszenna" → "Mąka pszenna"). Inaczej tylko podpowiedzi.
 */
export function isConfidentMatch(name: string, c: { namePl: string }): boolean {
  const q = normalizeSearch(name);
  const n = normalizeSearch(c.namePl);
  return !!q && (n === q || n.startsWith(`${q} `) || n.startsWith(`${q},`) || n.startsWith(`${q} (`));
}

/** Te same reguły co gramsFor / formularz: g zawsze, ml i miary kuchenne przy gęstości, własne jednostki */
function unitAllowed(
  unit: string,
  c: { density: number | null; units: { code: string }[] },
  unitMl: Record<string, number | null>,
): boolean {
  if (unit === 'g') return true;
  if (c.units.some((u) => u.code === unit)) return true;
  if (unit === 'ml') return !!c.density;
  return !!unitMl[unit] && !!c.density;
}

function minutes(v: number | null, max: number): number | null {
  return v !== null && v >= 0 && v <= max ? v : null;
}
