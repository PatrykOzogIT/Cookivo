import { randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';
import { similarName } from '../../../src/ai/ingredient-names.js';
import { normalizeSearch } from '../../../src/common/text.js';
import type { ImportRecord } from './record.js';

/*
 * Import do PostgreSQL (lokalnie albo Neon przez zwykłe połączenie TCP, sterownik `pg`).
 * Zamiast COPY: tabela tymczasowa (staging) ładowana paczkami przez jsonb_to_recordset - jedno
 * zapytanie na paczkę, działa przez każde połączenie (także pooler), bez dodatkowych zależności.
 * Idempotencja: unikalny seed_key ("import:ciqual:20917") + ON CONFLICT DO NOTHING - ponowne
 * uruchomienie albo wznowienie po przerwaniu niczego nie dubluje. Istniejących rekordów nie dotykamy.
 */

export type Action = 'INSERT' | 'ALREADY_IMPORTED' | 'SAME_SOURCE_REF' | 'NAME_TAKEN';

export interface PlannedRecord {
  record: ImportRecord;
  action: Action;
  detail: string;
  /** Status po porównaniu z bazą (podobny istniejący = do weryfikacji) */
  status: 'APPROVED' | 'PENDING';
  review: string[];
}

export interface ImportReport {
  mode: 'dry-run' | 'commit';
  planned: number;
  inserted: number;
  approved: number;
  pending: number;
  skipped: Record<Exclude<Action, 'INSERT'>, number>;
  batches: number;
  ms: number;
  plan: PlannedRecord[];
}

export const BATCH_SIZE = 1000;

/** UUID v7 (czas + losowość) - jak domyślne id w Prisma, bo kolumna nie ma wartości domyślnej w bazie */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface Existing {
  seed_key: string | null;
  source: string;
  source_ref: string | null;
  name_pl: string;
  status: string;
}

/** Porównanie z bazą (tylko odczyt): co wstawić, co pominąć i dlaczego */
export function plan(records: ImportRecord[], existing: Existing[]): PlannedRecord[] {
  const seedKeys = new Set(existing.map((e) => e.seed_key).filter(Boolean));
  const refs = new Set(existing.filter((e) => e.source_ref).map((e) => `${e.source}:${e.source_ref}`));
  const live = existing.filter((e) => e.status !== 'REJECTED');
  const names = new Map(live.map((e) => [normalizeSearch(e.name_pl), e.name_pl]));
  const taken = new Set<string>();
  return records.map((record) => {
    const base = { record, status: record.status, review: [...record.review] };
    if (seedKeys.has(record.seedKey)) return { ...base, action: 'ALREADY_IMPORTED', detail: '' };
    if (refs.has(`${record.source}:${record.sourceRef}`))
      return { ...base, action: 'SAME_SOURCE_REF', detail: record.sourceRef };
    const key = normalizeSearch(record.namePl);
    if (names.has(key) || taken.has(key))
      return { ...base, action: 'NAME_TAKEN', detail: names.get(key) ?? record.namePl };
    taken.add(key);
    // Podobny do istniejącego (także dodanego przez użytkownika) - dodajemy, ale do weryfikacji
    const similar = live.find((e) => similarName(record.namePl, { namePl: e.name_pl, nameEn: null }));
    if (similar) base.review.push(`PODOBNY_ISTNIEJACY:${similar.name_pl}`);
    return { ...base, action: 'INSERT', detail: '', status: base.review.length ? 'PENDING' : record.status };
  });
}

const STAGING = `
  CREATE TEMP TABLE IF NOT EXISTS import_staging (
    id uuid PRIMARY KEY, batch int NOT NULL, seed_key text NOT NULL UNIQUE, name_pl text NOT NULL, name_en text,
    search_text text NOT NULL, category text NOT NULL, status text NOT NULL, source text NOT NULL,
    source_ref text NOT NULL, kcal float8 NOT NULL, protein float8 NOT NULL, fat float8 NOT NULL,
    saturated_fat float8, carbs float8 NOT NULL, sugars float8, fiber float8, salt float8, density float8,
    allergens text[] NOT NULL, units jsonb NOT NULL
  )`;
const COLUMNS = `id uuid, batch int, seed_key text, name_pl text, name_en text, search_text text, category text,
  status text, source text, source_ref text, kcal float8, protein float8, fat float8, saturated_fat float8,
  carbs float8, sugars float8, fiber float8, salt float8, density float8, allergens text[], units jsonb`;

async function insertBatch(db: ClientBase, batch: number): Promise<number> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO ingredients (id, name_pl, name_en, search_text, category_id, status, source, source_ref, seed_key,
       kcal, protein, fat, saturated_fat, carbs, sugars, fiber, salt, density, reviewed_at, updated_at)
     SELECT s.id, s.name_pl, s.name_en, s.search_text, c.id, s.status::"IngredientStatus", s.source::"IngredientSource",
       s.source_ref, s.seed_key, s.kcal, s.protein, s.fat, s.saturated_fat, s.carbs, s.sugars, s.fiber, s.salt,
       s.density, CASE WHEN s.status = 'APPROVED' THEN now() END, now()
     FROM import_staging s JOIN ingredient_categories c ON c.code = s.category
     WHERE s.batch = $1
     ON CONFLICT (seed_key) DO NOTHING
     RETURNING id`,
    [batch],
  );
  // Alergeny i jednostki tylko dla wierszy wstawionych teraz (join po id ze stagingu)
  await db.query(
    `INSERT INTO ingredient_allergens (ingredient_id, allergen_id)
     SELECT s.id, a.id FROM import_staging s
     JOIN ingredients i ON i.id = s.id
     CROSS JOIN LATERAL unnest(s.allergens) AS al(allergen_code)
     JOIN allergens a ON a.code = al.allergen_code
     WHERE s.batch = $1 ON CONFLICT DO NOTHING`,
    [batch],
  );
  await db.query(
    `INSERT INTO ingredient_units (ingredient_id, unit_code, grams)
     SELECT s.id, u.code, u.grams FROM import_staging s
     JOIN ingredients i ON i.id = s.id
     CROSS JOIN LATERAL jsonb_to_recordset(s.units) AS u(code text, grams float8)
     JOIN units un ON un.code = u.code
     WHERE s.batch = $1 ON CONFLICT DO NOTHING`,
    [batch],
  );
  return inserted.rowCount ?? 0;
}

export async function runImport(
  db: ClientBase,
  records: ImportRecord[],
  opts: { dryRun: boolean; limit?: number; batchSize?: number; log?: (s: string) => void },
): Promise<ImportReport> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const existing = (
    await db.query<Existing>(
      'SELECT seed_key, source::text AS source, source_ref, name_pl, status::text AS status FROM ingredients',
    )
  ).rows;
  const planned = plan(records, existing);
  const toInsert = planned.filter((p) => p.action === 'INSERT').slice(0, opts.limit ?? Infinity);
  const rows = toInsert.map((p, i) => ({
    id: uuidv7(),
    batch: Math.floor(i / batchSize),
    seed_key: p.record.seedKey,
    name_pl: p.record.namePl,
    name_en: p.record.nameEn,
    search_text: normalizeSearch(`${p.record.namePl} ${p.record.nameEn ?? ''}`),
    category: p.record.categoryCode,
    status: p.status,
    source: p.record.source,
    source_ref: p.record.sourceRef,
    kcal: p.record.kcal,
    protein: p.record.protein,
    fat: p.record.fat,
    saturated_fat: p.record.saturatedFat,
    carbs: p.record.carbs,
    sugars: p.record.sugars,
    fiber: p.record.fiber,
    salt: p.record.salt,
    density: p.record.density,
    allergens: p.record.allergens,
    units: p.record.units.map((u) => ({ code: u.code, grams: u.grams })),
  }));
  const batches = Math.ceil(rows.length / batchSize);

  await db.query(STAGING);
  await db.query('TRUNCATE import_staging');
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.query(
      `INSERT INTO import_staging SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${COLUMNS})`,
      [JSON.stringify(rows.slice(i, i + batchSize))],
    );
  }

  let inserted = 0;
  if (opts.dryRun) {
    // Pełny przebieg w jednej transakcji i wycofanie - raport bez zapisu
    await db.query('BEGIN');
    try {
      for (let b = 0; b < batches; b++) inserted += await insertBatch(db, b);
    } finally {
      await db.query('ROLLBACK');
    }
  } else {
    // Każda paczka w osobnej transakcji - przerwanie zostawia spójne, kompletne paczki
    for (let b = 0; b < batches; b++) {
      await db.query('BEGIN');
      try {
        const n = await insertBatch(db, b);
        await db.query('COMMIT');
        inserted += n;
        log(`Paczka ${b + 1}/${batches}: +${n}`);
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }
  }
  await db.query('DROP TABLE IF EXISTS import_staging');

  const count = (a: Action) => planned.filter((p) => p.action === a).length;
  return {
    mode: opts.dryRun ? 'dry-run' : 'commit',
    planned: toInsert.length,
    inserted,
    approved: toInsert.filter((p) => p.status === 'APPROVED').length,
    pending: toInsert.filter((p) => p.status === 'PENDING').length,
    skipped: {
      ALREADY_IMPORTED: count('ALREADY_IMPORTED'),
      SAME_SOURCE_REF: count('SAME_SOURCE_REF'),
      NAME_TAKEN: count('NAME_TAKEN'),
    },
    batches,
    ms: Date.now() - started,
    plan: planned,
  };
}

/** Tabele, w których składnik może być użyty - takich importowanych rekordów nie cofamy */
const REFERENCES = [
  'recipe_ingredients',
  'pantry_items',
  'shopping_items',
  'price_entries',
  'price_observations',
  'receipt_alias_votes',
  'ingredient_requests',
  'ingredient_preferences',
];

/** Cofnięcie importu: usuwa tylko rekordy z prefiksem "import:", które nigdzie nie są używane */
export async function undoImport(
  db: ClientBase,
  dryRun: boolean,
): Promise<{ removable: number; kept: number }> {
  const used = REFERENCES.map((t) => `EXISTS (SELECT 1 FROM ${t} r WHERE r.ingredient_id = i.id)`).join(
    ' OR ',
  );
  const { rows } = await db.query<{ removable: string; kept: string }>(
    `SELECT count(*) FILTER (WHERE NOT (${used})) AS removable, count(*) FILTER (WHERE ${used}) AS kept
     FROM ingredients i WHERE i.seed_key LIKE 'import:%'`,
  );
  if (!dryRun) {
    await db.query(`DELETE FROM ingredients i WHERE i.seed_key LIKE 'import:%' AND NOT (${used})`);
  }
  return { removable: Number(rows[0].removable), kept: Number(rows[0].kept) };
}
