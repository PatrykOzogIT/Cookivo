import { normalizeSearch } from '../../../src/common/text.js';
import { similarName } from '../../../src/ai/ingredient-names.js';
import { CATEGORY_CODES, type AiCache } from './ai-schema.js';
import { allergensFromName, simpleCategory } from './allergens.js';
import type { Candidate } from './dedupe.js';
import type { ImportRecord } from './record.js';
import { NUTRIENT_KEYS, REQUIRED_NUTRIENTS } from './types.js';

export type Skip = 'NO_AI' | 'RARE' | 'SAME_AS_EXISTING' | 'EXISTING_NAME' | 'DUPLICATE_PL_NAME' | 'INVALID';

export interface BuildResult {
  records: ImportRecord[];
  skipped: { candidate: Candidate; reason: Skip; detail: string }[];
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Polska nazwa: pierwsza wielka, pojedyncze spacje, bez kropki na końcu */
export function cleanName(name: string): string {
  const s = name.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return s.charAt(0).toLocaleUpperCase('pl') + s.slice(1);
}

/**
 * Kandydaci + odpowiedzi AI → rekordy importu. Wartości odżywcze zawsze ze źródła.
 * Rekord jest pewny (APPROVED) tylko, gdy wszystko się zgadza; inaczej PENDING z powodami.
 */
export function buildRecords(candidates: Candidate[], cache: AiCache, existingNames: string[]): BuildResult {
  const skipped: BuildResult['skipped'] = [];
  const existingKeys = new Map(existingNames.map((n) => [normalizeSearch(n), n]));
  const drafts: { c: Candidate; r: ImportRecord }[] = [];

  for (const c of candidates) {
    const ai = cache.items[c.importKey];
    if (!ai) {
      skipped.push({ candidate: c, reason: 'NO_AI', detail: '' });
      continue;
    }
    if (ai.relevance === 'RARE') {
      skipped.push({ candidate: c, reason: 'RARE', detail: ai.namePl });
      continue;
    }
    if (ai.sameAsExisting && existingKeys.has(normalizeSearch(ai.sameAsExisting))) {
      skipped.push({ candidate: c, reason: 'SAME_AS_EXISTING', detail: ai.sameAsExisting });
      continue;
    }
    const namePl = cleanName(ai.namePl);
    const key = normalizeSearch(namePl);
    if (existingKeys.has(key)) {
      skipped.push({ candidate: c, reason: 'EXISTING_NAME', detail: existingKeys.get(key)! });
      continue;
    }

    const review: string[] = [];
    const category = (CATEGORY_CODES as readonly string[]).includes(ai.category) ? ai.category : 'OTHER';
    if (category !== ai.category) review.push(`KATEGORIA_NIEZNANA:${ai.category}`);
    // Alergeny: reguła z nazwy (pewna) ∪ propozycja AI; różnica = do weryfikacji
    const fromRule = allergensFromName(`${c.nameEn} ${ai.nameEn}`);
    const allergens = [...new Set([...fromRule, ...ai.allergens])].sort();
    const aiOnly = ai.allergens.filter((a) => !fromRule.includes(a));
    const ruleOnly = fromRule.filter((a) => !ai.allergens.includes(a));
    if (aiOnly.length) review.push(`ALERGENY_TYLKO_AI:${aiOnly.join(',')}`);
    if (ruleOnly.length) review.push(`ALERGENY_TYLKO_REGULA:${ruleOnly.join(',')}`);
    if (ai.variableComposition) review.push('ZMIENNY_SKLAD');
    if (!simpleCategory(category)) review.push(`KATEGORIA_ZLOZONA:${category}`);

    const missing = NUTRIENT_KEYS.filter((k) => c.values[k] === null);
    if (REQUIRED_NUTRIENTS.some((k) => c.values[k] === null)) {
      skipped.push({ candidate: c, reason: 'INVALID', detail: 'brak wymaganych wartości' });
      continue;
    }

    const density =
      ai.liquid && ai.density && ai.density >= 0.2 && ai.density <= 3 ? round(ai.density, 3) : null;
    const units: ImportRecord['units'] = c.portions.map((p) => ({
      code: p.unit,
      grams: p.grams,
      basis: 'SOURCE',
    }));
    if (
      !units.some((u) => u.code === 'PIECE') &&
      ai.pieceGrams &&
      ai.pieceGrams > 0 &&
      ai.pieceGrams <= 5000
    ) {
      units.push({ code: 'PIECE', grams: round(ai.pieceGrams, 1), basis: 'AI' });
    }
    if (density && !units.some((u) => u.code === 'GLASS')) {
      units.push({ code: 'GLASS', grams: round(250 * density, 1), basis: 'DENSITY' });
    }
    // Waga sztuki z AI to szacunek - pewny rekord tylko z jednostkami ze źródła
    if (units.some((u) => u.basis === 'AI')) review.push('JEDNOSTKA_SZACUNEK_AI');

    drafts.push({
      c,
      r: {
        importKey: c.importKey,
        seedKey: `import:${c.importKey}`,
        namePl,
        nameEn: ai.nameEn ? cleanName(ai.nameEn).slice(0, 120) : null,
        categoryCode: category,
        status: 'PENDING',
        source: c.source,
        sourceRef: c.ref,
        kcal: c.values.kcal!,
        protein: c.values.protein!,
        fat: c.values.fat!,
        saturatedFat: c.values.saturatedFat,
        carbs: c.values.carbs!,
        sugars: c.values.sugars,
        fiber: c.values.fiber,
        salt: c.values.salt,
        density,
        allergens,
        allergenBasis: aiOnly.length ? (fromRule.length ? 'RULE_AND_AI' : 'AI') : 'RULE',
        units,
        relevance: ai.relevance,
        quality: { missing, filledFrom: c.filledFrom },
        review,
        duplicates: c.merged.map((m) => m.key),
      },
    });
  }

  // Ta sama polska nazwa = ten sam składnik: zostaje Ciqual, potem COMMON, potem kompletniejszy
  const byName = new Map<string, { c: Candidate; r: ImportRecord }[]>();
  for (const d of drafts) {
    const k = normalizeSearch(d.r.namePl);
    byName.set(k, [...(byName.get(k) ?? []), d]);
  }
  const records: ImportRecord[] = [];
  for (const group of byName.values()) {
    group.sort(
      (a, b) =>
        Number(b.r.source === 'CIQUAL') - Number(a.r.source === 'CIQUAL') ||
        Number(b.r.relevance === 'COMMON') - Number(a.r.relevance === 'COMMON') ||
        a.r.quality.missing.length - b.r.quality.missing.length ||
        a.r.importKey.localeCompare(b.r.importKey),
    );
    const [keep, ...rest] = group;
    keep.r.duplicates.push(...rest.map((d) => d.r.importKey));
    for (const d of rest)
      skipped.push({ candidate: d.c, reason: 'DUPLICATE_PL_NAME', detail: keep.r.importKey });
    records.push(keep.r);
  }

  // Podobne do istniejących (np. nazwa jest początkiem innej) - dodajemy, ale do weryfikacji
  for (const r of records) {
    const similar = existingNames.find((n) => similarName(r.namePl, { namePl: n, nameEn: null }));
    if (similar) r.review.push(`PODOBNY_ISTNIEJACY:${similar}`);
    r.status = r.review.length ? 'PENDING' : 'APPROVED';
  }
  records.sort(
    (a, b) => a.categoryCode.localeCompare(b.categoryCode) || a.namePl.localeCompare(b.namePl, 'pl'),
  );
  return { records, skipped };
}
