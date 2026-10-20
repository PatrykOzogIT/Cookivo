/**
 * Ceny ogólne - czysta logika: mediana cen z paragonów wszystkich użytkowników
 * (bez skrajności) i podpowiedź "Twoja cena jest stara".
 */

/** Z ilu ostatnich dni bierzemy ceny z paragonów */
export const GLOBAL_WINDOW_DAYS = 60;
/** Ceny ponad 3× wyższe albo niższe od mediany odrzucamy (pomyłki odczytu, inny produkt) */
export const OUTLIER_FACTOR = 3;
/** Własna cena starsza niż tyle dni + różnica ponad 10% = podpowiedź "Zaktualizuj" */
export const STALE_DAYS = 90;
export const STALE_DIFF = 0.1;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Observation {
  ingredientId: string;
  /** Sieć sklepu po normalizacji (jak w powiązaniach paragonów) */
  storeKey: string;
  centsPerGram: number;
  on: Date;
}

export interface GlobalPrice {
  centsPerGram: number;
  /** Ile cen złożyło się na medianę */
  count: number;
  /** Najświeższa z nich */
  latest: Date;
  /** Sieć, z której pochodzi (null = wszystkie sieci) */
  storeKey: string | null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mediana po odrzuceniu cen spoza [mediana / 3, mediana × 3] */
export function robustMedian(values: number[]): { value: number; kept: number } | null {
  const m = median(values);
  if (m === null || m <= 0) return null;
  const kept = values.filter((v) => v >= m / OUTLIER_FACTOR && v <= m * OUTLIER_FACTOR);
  return { value: median(kept) ?? m, kept: kept.length };
}

/** Cena ogólna produktu: najpierw z tej samej sieci sklepów, a gdy jej brak - ze wszystkich */
export function globalPrice(observations: Observation[], storeKey: string): GlobalPrice | null {
  const same = storeKey ? observations.filter((o) => o.storeKey === storeKey) : [];
  const pool = same.length ? same : observations;
  const m = robustMedian(pool.map((o) => o.centsPerGram));
  if (!m) return null;
  return {
    centsPerGram: m.value,
    count: m.kept,
    latest: new Date(Math.max(...pool.map((o) => o.on.getTime()))),
    storeKey: same.length ? storeKey : null,
  };
}

/** Własna cena jest stara, a ogólna świeża i wyraźnie inna - podpowiadamy aktualizację */
export function isStale(
  own: { centsPerGram: number; updatedAt: Date },
  global: GlobalPrice,
  now = new Date(),
): boolean {
  const ownAge = (now.getTime() - own.updatedAt.getTime()) / DAY_MS;
  const globalAge = (now.getTime() - global.latest.getTime()) / DAY_MS;
  const diff = Math.abs(global.centsPerGram - own.centsPerGram) / own.centsPerGram;
  return ownAge > STALE_DAYS && globalAge <= GLOBAL_WINDOW_DAYS && diff > STALE_DIFF;
}
