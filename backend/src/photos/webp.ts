import type { Sharp } from 'sharp';

/** Szerokości wersji WebP: miniatura na liście, widok przepisu, pełny ekran */
export const PHOTO_WIDTHS = { small: 400, medium: 900, large: 1600 } as const;

/**
 * Wersje WebP zdjęcia (te same rozmiary i jakość dla uploadu i importu biblioteki przepisów).
 * Wymiary = największa wersja, `bytes` = suma wszystkich plików.
 */
export async function webpVariants(base: Sharp) {
  const files: { width: number; data: Buffer }[] = [];
  let bytes = 0;
  let size = { width: 0, height: 0 };
  for (const width of Object.values(PHOTO_WIDTHS)) {
    const { data, info } = await base
      .clone()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    files.push({ width, data });
    bytes += data.length;
    if (width === PHOTO_WIDTHS.large) size = { width: info.width, height: info.height };
  }
  return { files, ...size, bytes };
}
