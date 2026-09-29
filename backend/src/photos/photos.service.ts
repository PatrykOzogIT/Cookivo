import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp, { type Metadata } from 'sharp';
import type { AuthUser } from '../common/auth.decorators.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Szerokości wersji WebP: miniatura na liście, widok przepisu, pełny ekran */
export const PHOTO_WIDTHS = { small: 400, medium: 900, large: 1600 } as const;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
/** Nieprzypięte do przepisu zdjęcia (porzucony formularz) usuwamy po dobie */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

export interface PhotoDto {
  id: string;
  width: number;
  height: number;
  urls: Record<keyof typeof PHOTO_WIDTHS, string>;
}

export function photoUrls(id: string): PhotoDto['urls'] {
  const url = (w: number) => `/api/media/${id}-${w}.webp`;
  return { small: url(PHOTO_WIDTHS.small), medium: url(PHOTO_WIDTHS.medium), large: url(PHOTO_WIDTHS.large) };
}

export function toPhotoDto(p: { id: string; width: number; height: number }): PhotoDto {
  return { id: p.id, width: p.width, height: p.height, urls: photoUrls(p.id) };
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);
  readonly dir: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const dir = config.get('UPLOADS_DIR', { infer: true });
    this.dir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  }

  /**
   * Zapisuje zdjęcie jako WebP w trzech rozmiarach. `sharp` obraca obraz wg EXIF
   * i domyślnie usuwa metadane (w tym lokalizację GPS z telefonu). Oryginału nie trzymamy.
   */
  async upload(buffer: Buffer, owner: AuthUser): Promise<PhotoDto> {
    let meta: Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    }
    if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    }

    await mkdir(this.dir, { recursive: true });
    const base = sharp(buffer, { limitInputPixels: 50_000_000 }).rotate();
    const photo = await this.prisma.photo.create({
      data: { ownerId: owner.id, width: 0, height: 0, bytes: 0 },
    });

    try {
      let bytes = 0;
      let size = { width: 0, height: 0 };
      for (const width of Object.values(PHOTO_WIDTHS)) {
        const { data, info } = await base
          .clone()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        await writeFile(join(this.dir, `${photo.id}-${width}.webp`), data);
        bytes += data.length;
        if (width === PHOTO_WIDTHS.large) size = { width: info.width, height: info.height };
      }
      const saved = await this.prisma.photo.update({ where: { id: photo.id }, data: { ...size, bytes } });
      void this.cleanupOrphans();
      return toPhotoDto(saved);
    } catch (err) {
      await this.removeFiles(photo.id);
      await this.prisma.photo.delete({ where: { id: photo.id } });
      this.logger.error(`Nie udało się przetworzyć zdjęcia: ${(err as Error).message}`);
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    }
  }

  /** Usuwa nieprzypięte zdjęcie (np. user usunął je z formularza przed zapisem). */
  async remove(id: string, user: AuthUser): Promise<void> {
    const photo = await this.prisma.photo.findUnique({ where: { id } });
    if (!photo) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (photo.ownerId !== user.id || photo.recipeId) throw new ForbiddenException({ code: 'FORBIDDEN' });
    await this.delete([id]);
  }

  /** Usuwa zdjęcia z bazy i z dysku. */
  async delete(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.prisma.photo.deleteMany({ where: { id: { in: ids } } });
    await Promise.all(ids.map((id) => this.removeFiles(id)));
  }

  async cleanupOrphans(): Promise<void> {
    const stale = await this.prisma.photo.findMany({
      where: { recipeId: null, createdAt: { lt: new Date(Date.now() - ORPHAN_TTL_MS) } },
      select: { id: true },
      take: 100,
    });
    await this.delete(stale.map((p) => p.id));
  }

  private async removeFiles(id: string): Promise<void> {
    await Promise.all(
      Object.values(PHOTO_WIDTHS).map((w) => rm(join(this.dir, `${id}-${w}.webp`), { force: true })),
    );
  }
}
