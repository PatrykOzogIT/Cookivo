import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { z } from 'zod';
import type { Env } from '../config/env.js';

/** Dłuższy bok zdjęcia wysyłanego do modelu - więcej nie poprawia odczytu, a podnosi koszt */
const MAX_EDGE = 1568;

export interface ModelImage {
  mediaType: 'image/jpeg';
  base64: string;
}

export interface VisionResult<T> {
  output: T;
  inputTokens: number;
  outputTokens: number;
}

/** Zdjęcie dla modelu: obrót wg EXIF, dłuższy bok ≤ 1568 px, JPEG, bez metadanych (np. GPS) */
export async function toModelImage(buffer: Buffer): Promise<ModelImage> {
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
 * Wspólny odczyt zdjęć przez Claude (przepisy, paragony): jedno wywołanie, odpowiedź
 * w wymuszonym schemacie (structured outputs). Bez klucza API funkcje AI są ukryte.
 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  readonly enabled: boolean;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('RECIPE_IMPORT_MODEL', { infer: true });
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 }) : null;
    this.enabled = !!this.client;
  }

  async parse<S extends z.ZodType>(
    schema: S,
    opts: {
      /** Reguły; `cachedContext` (np. lista składników) idzie za nimi z cache - stała między wywołaniami */
      system: string;
      cachedContext?: string;
      images: ModelImage[];
      prompt: string;
      maxTokens: number;
      /** Inny model niż domyślny (np. Sonnet do wersji przepisu) */
      model?: string;
    },
  ): Promise<VisionResult<z.infer<S>>> {
    if (!this.client) throw new Error('Odczyt zdjęć wyłączony (brak ANTHROPIC_API_KEY)');
    const response = await this.client.messages.parse({
      model: opts.model ?? this.model,
      max_tokens: opts.maxTokens,
      // Stały prefiks (reguły + kontekst) z prompt caching - kolejne odczyty płacą za niego ułamek
      system: [
        { type: 'text' as const, text: opts.system },
        ...(opts.cachedContext ? [{ type: 'text' as const, text: opts.cachedContext }] : []),
      ].map((block, i, all) =>
        i === all.length - 1 ? { ...block, cache_control: { type: 'ephemeral' as const } } : block,
      ),
      // Odczytanie tekstu ze zdjęcia - niski wysiłek wystarcza i obniża koszt
      output_config: { effort: 'low', format: zodOutputFormat(schema) },
      messages: [
        {
          role: 'user',
          content: [
            ...opts.images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
            })),
            { type: 'text' as const, text: opts.prompt },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      // Bez treści odpowiedzi w logach (może zawierać dane z paragonu)
      this.logger.warn(`Odczyt zdjęć nieudany: stop_reason=${response.stop_reason}`);
      throw new Error('IMPORT_FAILED');
    }
    return {
      output: response.parsed_output as z.infer<S>,
      // Wszystkie tokeny wejścia (także z cache) - do śledzenia kosztów w ai_imports
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }
}
