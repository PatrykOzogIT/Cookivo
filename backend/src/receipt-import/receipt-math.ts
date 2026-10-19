/**
 * Paragon - czysta logika: z odczytanej pozycji robimy "N opakowań × wielkość opakowania
 * po cenie regularnej". Przeliczenia deterministyczne, kwoty w groszach.
 */

export interface ReadLine {
  quantity: number | null;
  quantityUnit: 'PIECE' | 'g' | 'kg' | 'ml' | 'l' | null;
  packageAmount: number | null;
  packageUnit: 'PIECE' | 'g' | 'kg' | 'ml' | 'l' | null;
  unitPrice: number | null;
  totalPrice: number | null;
}

/** Kody ostrzeżeń - front tłumaczy je kluczem `receiptImport.warn.<KOD>` */
export type LineWarning = 'PRICE_MISMATCH' | 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'UNIT_NOT_ALLOWED';

export interface ReceiptLine {
  /** Ile opakowań (przy towarze na wagę ułamek: 0,734 × 1 kg) */
  packages: number | null;
  packageAmount: number | null;
  packageUnitCode: string | null;
  /** Cena regularna jednego opakowania */
  priceCents: number | null;
  /** Wartość pozycji (opakowania × cena) */
  lineTotalCents: number | null;
  warnings: LineWarning[];
}

/** Tolerancja przy sprawdzaniu "ilość × cena = wartość" (zaokrąglenia kas) */
const TOLERANCE_CENTS = 2;

export function toCents(value: number): number {
  return Math.round(value * 100);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * "MLEKO UHT 3,2% 1L 2 x 4,29" → 2 × 1 l po 4,29 (razem 8,58);
 * "POMIDOR 0,734 kg x 9,99" → 0,734 × 1 kg po 9,99 (razem 7,33).
 * Brakująca cena za sztukę = wartość / ilość; brakującej gramatury nie zgadujemy.
 */
export function receiptLine(read: ReadLine): ReceiptLine {
  const warnings: LineWarning[] = [];
  const total = read.totalPrice !== null && read.totalPrice > 0 ? toCents(read.totalPrice) : null;
  let unit = read.unitPrice !== null && read.unitPrice > 0 ? toCents(read.unitPrice) : null;
  const weighed = read.quantityUnit !== null && read.quantityUnit !== 'PIECE';

  let packages: number | null;
  let packageAmount: number | null = null;
  let packageUnitCode: string | null = null;
  if (weighed && read.quantity !== null && read.quantity > 0) {
    // Na wagę: zawsze w kg albo l, cena za 1 kg / 1 l
    const grams = read.quantityUnit === 'g' || read.quantityUnit === 'ml';
    packages = round3(grams ? read.quantity / 1000 : read.quantity);
    packageAmount = 1;
    packageUnitCode = read.quantityUnit === 'g' || read.quantityUnit === 'kg' ? 'kg' : 'l';
  } else {
    packages = read.quantity !== null && read.quantity > 0 ? round3(read.quantity) : 1;
    if (read.packageAmount !== null && read.packageAmount > 0 && read.packageUnit) {
      packageAmount = round3(read.packageAmount);
      packageUnitCode = read.packageUnit;
    } else {
      warnings.push('NO_PACKAGE_SIZE');
    }
  }

  if (unit === null && total !== null && packages) unit = Math.round(total / packages);
  if (unit === null) warnings.push('NO_PRICE');
  if (unit !== null && total !== null && Math.abs(Math.round(packages * unit) - total) > TOLERANCE_CENTS) {
    warnings.push('PRICE_MISMATCH');
  }
  return {
    packages,
    packageAmount,
    packageUnitCode,
    priceCents: unit,
    lineTotalCents: unit !== null ? Math.round(packages * unit) : total,
    warnings,
  };
}

/** Data zakupu z odczytu: poprawna i nie z przyszłości (inaczej brak daty) */
export function purchaseDate(value: string | null, today = new Date()): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return d.getUTCFullYear() >= 2000 && d <= tomorrow ? value : null;
}
