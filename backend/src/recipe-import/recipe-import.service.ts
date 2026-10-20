import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service.js';
import { matchIngredient, unitAllowed, type Candidate } from '../ai/ingredient-match.js';
import { toModelImage } from '../ai/vision.service.js';
import type { AuthUser } from '../common/auth.decorators.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { RecipeExtractor, type Extraction } from './recipe-extractor.js';

export const MAX_IMPORT_PHOTOS = 3;

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
    private readonly extractor: RecipeExtractor,
    private readonly usage: AiUsageService,
    private readonly ingredients: IngredientsService,
    private readonly calculator: RecipeCalculatorService,
  ) {}

  async status(userId: string) {
    return {
      enabled: this.extractor.enabled,
      dailyLimit: this.usage.dailyLimit('RECIPE'),
      remaining: await this.usage.remaining(userId, 'RECIPE'),
      maxPhotos: MAX_IMPORT_PHOTOS,
    };
  }

  async import(user: AuthUser, files: Buffer[], lang: 'pl' | 'en') {
    if (!this.extractor.enabled) throw new ServiceUnavailableException({ code: 'IMPORT_DISABLED' });
    if (!files.length || files.length > MAX_IMPORT_PHOTOS) {
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    }
    await this.usage.assertAvailable(user.id, 'RECIPE');
    const images = await Promise.all(files.map(toModelImage));
    const recordId = await this.usage.start(user.id, 'RECIPE', images.length);

    let extraction: Extraction;
    try {
      const result = await this.extractor.extract(images, lang);
      extraction = result.extraction;
      await this.usage.finish(recordId, result);
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
  /** Szkic przepisu z odczytu (także z wersji przepisu od asystenta) */
  async toDraft(e: Extraction, user: AuthUser) {
    const unitMl = await this.calculator.unitMl();
    const ingredients = await Promise.all(
      e.ingredients.map(async (line) => {
        const q = line.name.trim();
        const { match, suggestions } = await matchIngredient(this.ingredients, q, user);
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
          suggestions: suggestions.map(lineItem),
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
}

function minutes(v: number | null, max: number): number | null {
  return v !== null && v >= 0 && v <= max ? v : null;
}
