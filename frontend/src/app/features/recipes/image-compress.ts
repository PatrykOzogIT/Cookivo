/**
 * Zmniejsza zdjęcie w przeglądarce przed wysyłką: dłuższy bok ≤ 2000 px, JPEG ~85%.
 * Typowe zdjęcie z telefonu (4–8 MB) spada do ~0,5–1 MB - szybciej po LTE.
 * Przy okazji zamienia HEIC z iPhone'a na JPEG (Safari potrafi go odczytać).
 * Serwer i tak robi z tego WebP i usuwa metadane.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 2000;

export async function compressImage(file: File, maxSide = MAX_SIDE, quality = 0.85): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ('close' in bitmap) bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('toBlob');
  return blob;
}

/** createImageBitmap uwzględnia orientację EXIF; starsze przeglądarki - przez <img>. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* spróbuj przez <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
