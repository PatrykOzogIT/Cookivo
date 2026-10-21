import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service.js';
import { toModelImage } from '../ai/vision.service.js';
import type { AuthUser } from '../common/auth.decorators.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { LabelExtractor, type LabelReading } from './label-extractor.js';
import { toPer100 } from './label-math.js';

/** Tabela wartości i skład bywają na różnych stronach opakowania */
export const MAX_LABEL_PHOTOS = 2;

/**
 * Etykieta produktu ze zdjęcia → szkic formularza składnika (nic nie zapisujemy poza licznikiem
 * użycia; zdjęć nie przechowujemy). Wartości przeliczamy na 100 g, braki zostają puste.
 */
@Injectable()
export class LabelImportService {
  private readonly logger = new Logger(LabelImportService.name);

  constructor(
    private readonly extractor: LabelExtractor,
    private readonly usage: AiUsageService,
    private readonly ingredients: IngredientsService,
  ) {}

  async status(userId: string) {
    return {
      enabled: this.extractor.enabled,
      dailyLimit: this.usage.dailyLimit('LABEL'),
      remaining: await this.usage.remaining(userId, 'LABEL'),
      maxPhotos: MAX_LABEL_PHOTOS,
    };
  }

  async analyze(user: AuthUser, files: Buffer[], lang: 'pl' | 'en', name?: string) {
    if (!this.extractor.enabled) throw new ServiceUnavailableException({ code: 'IMPORT_DISABLED' });
    if (!files.length || files.length > MAX_LABEL_PHOTOS)
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    await this.usage.assertAvailable(user.id, 'LABEL');
    const images = await Promise.all(files.map(toModelImage));
    const importId = await this.usage.start(user.id, 'LABEL', images.length);
    const hint = name?.trim().slice(0, 120) || null;

    let reading: LabelReading;
    try {
      const result = await this.extractor.extract(images, lang, hint);
      reading = result.reading;
      await this.usage.finish(importId, result);
    } catch (err) {
      this.logger.warn(`Odczyt etykiety nieudany: ${(err as Error).message}`);
      throw new HttpException({ code: 'IMPORT_FAILED' }, HttpStatus.BAD_GATEWAY);
    }
    if (!reading.isFoodLabel) {
      throw new HttpException(
        { code: 'LABEL_NOT_LABEL', warnings: reading.warnings.slice(0, 5) },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const per100 = toPer100({
      basis: reading.basis,
      portionAmount: reading.portionAmount,
      kj: reading.kj,
      values: {
        kcal: reading.kcal,
        protein: reading.protein,
        fat: reading.fat,
        saturatedFat: reading.saturatedFat,
        carbs: reading.carbs,
        sugars: reading.sugars,
        fiber: reading.fiber,
        salt: reading.salt,
      },
    });
    // Nazwa wpisana przez użytkownika ma pierwszeństwo przed odczytaną
    const namePl = (hint ?? reading.namePl?.trim() ?? '').slice(0, 120) || null;
    const nameEn = reading.nameEn?.trim().slice(0, 120) || null;
    const similar = namePl ? await this.ingredients.similar([namePl, nameEn ?? ''], user) : [];
    const mayContain = reading.mayContain.filter((a) => !reading.allergens.includes(a));
    return {
      namePl,
      nameEn,
      printedName: reading.printedName?.slice(0, 160) ?? null,
      category: reading.category,
      ...per100,
      noTable: reading.basis === 'NONE',
      liquid: reading.basis === 'PER_100ML' || reading.packageUnit === 'ml',
      ingredientsVisible: reading.ingredientsVisible,
      allergens: [...new Set(reading.allergens)],
      mayContain: [...new Set(mayContain)],
      // Opakowanie jako jednostka - tylko masa (objętość wymaga gęstości)
      packageGrams:
        reading.packageUnit === 'g' && reading.packageAmount && reading.packageAmount <= 5000
          ? Math.round(reading.packageAmount * 10) / 10
          : null,
      warnings: reading.warnings.slice(0, 5).map((w) => w.slice(0, 200)),
      similar,
    };
  }
}
