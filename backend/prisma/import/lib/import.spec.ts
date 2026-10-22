import { describe, expect, it } from 'vitest';
import type { AiCache } from './ai-schema.js';
import { allergensFromName } from './allergens.js';
import { buildRecords, cleanName } from './build.js';
import { dedupe } from './dedupe.js';
import { featureKey, features } from './features.js';
import { plan, uuidv7 } from './importer.js';
import { validateRecord, type ImportRecord } from './record.js';
import { applyDecisions, exportReview, readReview } from './review.js';
import { isBranded, selectFood } from './select.js';
import { emptyNutrition, mapUsdaPortion, parseCiqualValue, usdaToEu } from './sources.js';
import type { Nutrition, SourceFood } from './types.js';

const food = (over: Partial<SourceFood> & { nameEn: string }): SourceFood => ({
  key: `usda:${over.ref ?? '1'}`,
  source: 'USDA',
  ref: '1',
  nameFr: null,
  group: '1100',
  groupName: 'Vegetables',
  values: { ...emptyNutrition(), kcal: 50, protein: 1, fat: 0.5, carbs: 10 },
  portions: [],
  ...over,
});

const ai = (namePl: string, over: Partial<AiCache['items'][string]> = {}): AiCache['items'][string] => ({
  relevance: 'COMMON',
  namePl,
  nameEn: namePl,
  category: 'VEGETABLES',
  allergens: [],
  variableComposition: false,
  liquid: false,
  density: null,
  pieceGrams: null,
  sameAsExisting: null,
  ...over,
});

describe('normalizacja wartości', () => {
  it('Ciqual: przecinek, brak danych, ślady i "< x"', () => {
    expect(parseCiqualValue('12,5')).toBe(12.5);
    expect(parseCiqualValue('-')).toBeNull();
    expect(parseCiqualValue('')).toBeNull();
    expect(parseCiqualValue('traces')).toBe(0);
    expect(parseCiqualValue('&lt; 0,5')).toBe(0);
  });

  it('USDA → UE: węglowodany bez błonnika (nie mniej niż cukry), sól z sodu, braki zostają null', () => {
    const v = usdaToEu({
      kcal: 52,
      protein: 0.26,
      fat: 0.17,
      carbsByDifference: 13.81,
      fiber: 2.4,
      sugars: 10.39,
      sodiumMg: 1,
    });
    expect(v).toMatchObject({ kcal: 52, carbs: 11.4, fiber: 2.4, sugars: 10.4, salt: 0 });
    expect(usdaToEu({ carbsByDifference: 4.8, sugars: 5.1 }).carbs).toBe(5.1);
    const empty = usdaToEu({ kcal: 10 });
    expect(empty.salt).toBeNull();
    expect(empty.carbs).toBeNull();
    expect(empty.fiber).toBeNull();
  });

  it('porcje USDA → jednostki Cookivo (szklanka 250 ml, sztuka "medium")', () => {
    expect(mapUsdaPortion('cup', 1, 236.6)).toMatchObject({ unit: 'GLASS', grams: 250 });
    expect(mapUsdaPortion('tbsp', 2, 30)).toMatchObject({ unit: 'TABLESPOON', grams: 15 });
    expect(mapUsdaPortion('medium (3" dia)', 1, 182)).toMatchObject({ unit: 'PIECE', grams: 182 });
    expect(mapUsdaPortion('clove', 1, 3)).toMatchObject({ unit: 'CLOVE' });
    expect(mapUsdaPortion('oz', 1, 28.35)).toBeNull();
    expect(mapUsdaPortion('serving', 1, 100)).toBeNull();
  });
});

describe('selekcja', () => {
  it('marki, wykluczone grupy, brak wymaganych wartości, warianty techniczne', () => {
    expect(isBranded("McDONALD'S, Big Mac")).toBe(true);
    expect(isBranded('Pillsbury Golden Layer Buttermilk Biscuits')).toBe(true);
    expect(isBranded('Apples, raw, with skin')).toBe(false);
    expect(isBranded('Milk, fluid, UHT')).toBe(false);
    expect(selectFood(food({ nameEn: 'Fast food, burger', group: '2100' }))).toBe('GROUP_EXCLUDED');
    expect(selectFood(food({ nameEn: 'KRAFT cheese' }))).toBe('BRANDED');
    expect(selectFood(food({ nameEn: 'Carrots, raw', values: { ...emptyNutrition(), kcal: 41 } }))).toBe(
      'MISSING_REQUIRED',
    );
    expect(selectFood(food({ nameEn: 'Beef, brisket, separable fat, raw' }))).toBe('TECHNICAL_VARIANT');
    expect(selectFood(food({ nameEn: 'Carrots, raw' }))).toBeNull();
  });
});

describe('cechy i duplikaty', () => {
  it('podobne nazwy różnych produktów mają różne klucze', () => {
    const k = (n: string) => featureKey(features(n));
    expect(k('Fish, tuna, light, canned in water, drained solids')).not.toBe(
      k('Fish, tuna, light, canned in oil, drained solids'),
    );
    expect(k('Milk, reduced fat, fluid, 2% milkfat')).not.toBe(k('Milk, whole, 3.25% milkfat'));
    expect(k('Cucumber, raw')).not.toBe(k('Pickles, cucumber, dill'));
    expect(k('Rice, white, cooked')).not.toBe(k('Rice, white, raw'));
    expect(k('Apples, raw')).toBe(k('Apple, raw'));
  });

  it('Ciqual ma pierwszeństwo; USDA uzupełnia tylko braki i jednostki', () => {
    const eu = food({
      key: 'ciqual:13000',
      source: 'CIQUAL',
      ref: '13000',
      nameEn: 'Apple, raw',
      values: { ...emptyNutrition(), kcal: 53, protein: 0.3, fat: 0.2, carbs: 11.5, fiber: null },
    });
    const us = food({
      key: 'usda:171688',
      ref: '171688',
      nameEn: 'Apples, raw',
      values: {
        ...emptyNutrition(),
        kcal: 52,
        protein: 0.26,
        fat: 0.17,
        carbs: 11.4,
        fiber: 2.4,
      } as Nutrition,
      portions: [{ unit: 'PIECE', grams: 182, label: 'medium' }],
    });
    const [c, ...rest] = dedupe([eu], [us]);
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({ importKey: 'ciqual:13000', values: { kcal: 53, protein: 0.3, fiber: 2.4 } });
    expect(c.portions).toEqual([{ unit: 'PIECE', grams: 182, label: 'medium' }]);
    expect(c.filledFrom.map((f) => f.field)).toEqual(['fiber', 'unit:PIECE']);
    expect(c.merged).toEqual([{ key: 'usda:171688', nameEn: 'Apples, raw', reason: 'OTHER_SOURCE' }]);
  });

  it('w obrębie źródła zostaje kompletniejsza i ogólniejsza pozycja', () => {
    const a = food({ key: 'usda:1', ref: '1', nameEn: 'Carrots, raw' });
    const b = food({ key: 'usda:2', ref: '2', nameEn: 'Carrots, raw, year round average' });
    const out = dedupe([], [a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].merged).toHaveLength(1);
  });
});

describe('alergeny z nazwy', () => {
  it('oczywiste alergeny i wyjątki', () => {
    expect(allergensFromName('Bread, wheat')).toEqual(['GLUTEN']);
    expect(allergensFromName('Flour, rice')).toEqual([]);
    expect(allergensFromName('Wheat flour, white')).toEqual(['GLUTEN']);
    expect(allergensFromName('Buckwheat flour')).toEqual([]);
    expect(allergensFromName('Rice flour')).toEqual([]);
    expect(allergensFromName('Coconut milk')).toEqual([]);
    expect(allergensFromName('Mayonnaise')).toEqual(['EGGS']);
    expect(allergensFromName('Eggplant, raw')).toEqual([]);
    expect(allergensFromName('Peanut butter')).toEqual(['PEANUTS']);
    expect(allergensFromName('Nutmeg, ground')).toEqual([]);
    expect(allergensFromName('Shrimp, cooked')).toEqual(['CRUSTACEANS']);
    expect(allergensFromName('Cheese, cheddar')).toEqual(['MILK']);
    expect(allergensFromName('Plain English muffins')).toEqual(['GLUTEN']);
    expect(allergensFromName('Nuts, cashews, raw')).toEqual(['NUTS']);
    expect(allergensFromName('Eggs, scrambled')).toEqual(['EGGS']);
    expect(allergensFromName('Peas, green')).toEqual([]);
  });
});

describe('plik importowy', () => {
  const cand = (key: string, nameEn: string, source: 'CIQUAL' | 'USDA' = 'USDA') =>
    dedupe(
      source === 'CIQUAL' ? [food({ key, source, ref: key.split(':')[1], nameEn })] : [],
      source === 'USDA' ? [food({ key, ref: key.split(':')[1], nameEn })] : [],
    )[0];

  it('pomija rzadkie, istniejące i dublujące się polskie nazwy; Ciqual wygrywa przy tej samej nazwie', () => {
    const candidates = [
      cand('ciqual:1', 'Carrot, raw', 'CIQUAL'),
      cand('usda:2', 'Carrots, baby, raw'),
      cand('usda:3', 'Opossum, roasted'),
      cand('usda:4', 'Potatoes, raw'),
      cand('usda:5', 'Celery, raw'),
    ];
    const cache: AiCache = {
      version: 1,
      model: 'x',
      items: {
        'ciqual:1': ai('Marchew młoda'),
        'usda:2': ai('marchew młoda'),
        'usda:3': ai('Opos', { relevance: 'RARE' }),
        'usda:4': ai('Ziemniaki', { sameAsExisting: 'Ziemniaki' }),
        'usda:5': ai('Seler naciowy', { allergens: ['CELERY'] }),
      },
    };
    const { records, skipped } = buildRecords(candidates, cache, ['Ziemniaki', 'Marchew']);
    expect(records.map((r) => r.importKey).sort()).toEqual(['ciqual:1', 'usda:5']);
    expect(skipped.map((s) => s.reason).sort()).toEqual(['DUPLICATE_PL_NAME', 'RARE', 'SAME_AS_EXISTING']);
    const marchew = records.find((r) => r.importKey === 'ciqual:1')!;
    expect(marchew.duplicates).toContain('usda:2');
    // "Marchew młoda" zaczyna się od istniejącej "Marchew" - do weryfikacji
    expect(marchew.status).toBe('PENDING');
    expect(marchew.review.some((x) => x.startsWith('PODOBNY_ISTNIEJACY'))).toBe(true);
    const seler = records.find((r) => r.importKey === 'usda:5')!;
    expect(seler).toMatchObject({
      status: 'APPROVED',
      allergens: ['CELERY'],
      allergenBasis: 'RULE',
      seedKey: 'import:usda:5',
    });
  });

  it('alergen tylko od AI, zmienny skład i szacowana sztuka → do weryfikacji', () => {
    const { records } = buildRecords(
      [cand('usda:7', 'Sauce, barbecue'), cand('usda:8', 'Kiwifruit, green, raw')],
      {
        version: 1,
        model: 'x',
        items: {
          'usda:7': ai('Sos barbecue', {
            category: 'SAUCES',
            allergens: ['MUSTARD'],
            variableComposition: true,
          }),
          'usda:8': ai('Kiwi', { category: 'FRUITS', pieceGrams: 75 }),
        },
      },
      [],
    );
    const bbq = records.find((r) => r.importKey === 'usda:7')!;
    expect(bbq.status).toBe('PENDING');
    expect(bbq.review).toEqual(
      expect.arrayContaining(['ALERGENY_TYLKO_AI:MUSTARD', 'ZMIENNY_SKLAD', 'KATEGORIA_ZLOZONA:SAUCES']),
    );
    const kiwi = records.find((r) => r.importKey === 'usda:8')!;
    expect(kiwi.units).toEqual([{ code: 'PIECE', grams: 75, basis: 'AI' }]);
    expect(kiwi.review).toEqual(['JEDNOSTKA_SZACUNEK_AI']);
  });

  it('polskie znaki w nazwach i walidacja wiersza', () => {
    expect(cleanName('  żółty   ser.')).toBe('Żółty ser');
    const r: ImportRecord = {
      importKey: 'usda:9',
      seedKey: 'import:usda:9',
      namePl: 'Śliwki węgierki',
      nameEn: 'Plums',
      categoryCode: 'FRUITS',
      status: 'APPROVED',
      source: 'USDA',
      sourceRef: '9',
      kcal: 46,
      protein: 0.7,
      fat: 0.3,
      saturatedFat: null,
      carbs: 10,
      sugars: 9.9,
      fiber: 1.4,
      salt: 0,
      density: null,
      allergens: [],
      allergenBasis: 'RULE',
      units: [{ code: 'PIECE', grams: 66, basis: 'SOURCE' }],
      relevance: 'COMMON',
      quality: { missing: ['saturatedFat'], filledFrom: [] },
      review: [],
      duplicates: [],
    };
    const dict = [new Set(['FRUITS']), new Set(['MILK']), new Set(['PIECE'])] as const;
    expect(validateRecord(r, ...dict)).toEqual([]);
    expect(validateRecord({ ...r, sugars: 12 }, ...dict)).toEqual(['NUTRITION_SUGARS_GT_CARBS']);
    expect(validateRecord({ ...r, kcal: null as unknown as number }, ...dict)).toEqual(['MISSING_kcal']);
    expect(validateRecord({ ...r, seedKey: 'usda:9' }, ...dict)).toEqual(['SEED_KEY']);
  });
});

describe('plan importu względem bazy', () => {
  const rec = (key: string, namePl: string, status: 'APPROVED' | 'PENDING' = 'APPROVED'): ImportRecord =>
    ({
      importKey: key,
      seedKey: `import:${key}`,
      namePl,
      source: key.startsWith('ciqual') ? 'CIQUAL' : 'USDA',
      sourceRef: key.split(':')[1],
      status,
      review: [],
    }) as unknown as ImportRecord;

  it('pomija już zaimportowane, ten sam kod źródła i zajęte nazwy; podobne → do weryfikacji', () => {
    const existing = [
      { seed_key: 'import:usda:1', source: 'USDA', source_ref: '1', name_pl: 'Kalarepa', status: 'APPROVED' },
      { seed_key: 'usda:jablko', source: 'USDA', source_ref: '2', name_pl: 'Jabłko', status: 'APPROVED' },
      { seed_key: null, source: 'USER', source_ref: null, name_pl: 'Żółty ser', status: 'PENDING' },
      { seed_key: null, source: 'USER', source_ref: null, name_pl: 'Mąka pszenna', status: 'APPROVED' },
    ];
    const p = plan(
      [
        rec('usda:1', 'Kalarepa'),
        rec('usda:2', 'Jabłka'),
        rec('usda:3', 'Zolty ser'),
        rec('usda:4', 'Mąka pszenna typ 650'),
        rec('usda:5', 'Rzepa'),
        rec('usda:6', 'Rzepa'),
      ],
      existing,
    );
    expect(p.map((x) => x.action)).toEqual([
      'ALREADY_IMPORTED',
      'SAME_SOURCE_REF',
      'NAME_TAKEN',
      'INSERT',
      'INSERT',
      'NAME_TAKEN',
    ]);
    expect(p[3]).toMatchObject({ status: 'PENDING', review: ['PODOBNY_ISTNIEJACY:Mąka pszenna'] });
    expect(p[4].status).toBe('APPROVED');
  });

  it('UUID v7', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('ręczna weryfikacja w CSV', () => {
  const base = {
    seedKey: 'import:usda:1',
    nameEn: 'Ketchup',
    categoryCode: 'SAUCES',
    status: 'PENDING',
    source: 'USDA',
    sourceRef: '1',
    allergens: ['CELERY'],
    units: [{ code: 'PIECE', grams: 5, basis: 'AI' }],
    review: ['ZMIENNY_SKLAD', 'ALERGENY_TYLKO_AI:CELERY'],
    kcal: 100,
    protein: 1,
    fat: 0.1,
    carbs: 25,
  } as unknown as ImportRecord;

  it('eksport z polskimi nazwami, wczytanie decyzji z Excela (średnik, cudzysłowy, poprawki)', () => {
    const records = [
      { ...base, importKey: 'usda:1', namePl: 'Ketchup łagodny' },
      { ...base, importKey: 'usda:2', namePl: 'Ketchup ostry' },
    ] as ImportRecord[];
    const out = exportReview(records);
    expect(out).toContain('Ketchup łagodny');
    expect(out).toContain('Seler');
    expect(out).toContain('alergen tylko od AI: Seler');
    // Użytkownik: OK przy pierwszym, poprawia nazwę i alergeny (polskie nazwy), usuwa wagę sztuki
    const edited = [
      out.split('\n')[0],
      'tak;usda:1;"Ketchup łagodny; pikantny";Ketchup;Sosy i dodatki;Seler, Gorczyca;;"x | y";100;1;0,1;25;USDA 1',
      ';usda:2;Ketchup ostry;Ketchup;Sosy i dodatki;Seler;5;;100;1;0,1;25;USDA 2',
    ].join('\r\n');
    const res = readReview(records, edited);
    expect(res).toMatchObject({ approved: 1, skipped: 1, errors: [] });
    expect(res.decisions['usda:1']).toEqual({
      namePl: 'Ketchup łagodny; pikantny',
      nameEn: 'Ketchup',
      categoryCode: 'SAUCES',
      allergens: ['CELERY', 'MUSTARD'],
      pieceGrams: null,
    });
    expect(applyDecisions(records, res.decisions)).toBe(1);
    expect(records[0]).toMatchObject({ status: 'APPROVED', units: [], review: ['ZWERYFIKOWANY_RECZNIE'] });
    expect(records[1].status).toBe('PENDING');
  });

  it('błędy: nieznany alergen i kategoria', () => {
    const records = [{ ...base, importKey: 'usda:1', namePl: 'Ketchup' }] as ImportRecord[];
    const header = exportReview(records).split('\n')[0];
    const res = readReview(
      records,
      [
        header,
        'tak;usda:1;Ketchup;;Sosy i dodatki;Selerowiec;;;1;1;1;1;x',
        'tak;usda:1;Ketchup;;Zupy;;;;1;1;1;1;x',
      ].join('\n'),
    );
    expect(res.approved).toBe(0);
    expect(res.errors).toHaveLength(2);
  });
});
