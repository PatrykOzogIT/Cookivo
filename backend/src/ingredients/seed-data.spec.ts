import ciqualData from '../../prisma/seed/ciqual.data.json' with { type: 'json' };
import { INGREDIENT_CATALOG } from '../../prisma/seed/ingredients.catalog.js';
import { CIQUAL_CATALOG } from '../../prisma/seed/ingredients.ciqual.js';
import usdaData from '../../prisma/seed/ingredients.data.json' with { type: 'json' };
import { ALLERGENS, CATEGORIES, UNITS } from '../../prisma/seed/reference-data.js';
import { seedItems } from '../../prisma/seed/seed.js';
import { normalizeSearch } from '../common/text.js';
import { checkNutrition, type Nutrition } from './nutrition.js';

const usda = usdaData as Record<string, Nutrition & { fdcId: number }>;
const ciqual = ciqualData as Record<string, Nutrition>;

describe('Dane startowe składników', () => {
  it('każdy wpis katalogu USDA ma dane z USDA', () => {
    const missing = INGREDIENT_CATALOG.filter((i) => !usda[i.usda]).map((i) => i.pl);
    expect(missing).toEqual([]);
  });

  it('każdy wpis katalogu Ciqual ma dane z Ciqual', () => {
    const missing = CIQUAL_CATALOG.filter((i) => !ciqual[String(i.ciqual)]).map((i) => i.pl);
    expect(missing).toEqual([]);
  });

  it('wartości odżywcze spełniają te same reguły co API', () => {
    const invalid = seedItems()
      .map((i) => [i.pl, checkNutrition(i.nutrition)] as const)
      .filter(([, problem]) => problem);
    expect(invalid).toEqual([]);
  });

  it('nazwy są unikalne w obu źródłach razem (po normalizacji)', () => {
    const names = seedItems().map((i) => normalizeSearch(i.pl));
    expect(names.filter((n, idx) => names.indexOf(n) !== idx)).toEqual([]);
  });

  it('kategorie, alergeny i jednostki istnieją w słownikach', () => {
    const categories = new Set<string>(CATEGORIES.map((c) => c.code));
    const allergens = new Set<string>(ALLERGENS.map((a) => a.code));
    const units = new Set<string>(UNITS.map((u) => u.code));
    for (const item of seedItems()) {
      expect(categories.has(item.category), item.pl).toBe(true);
      for (const a of item.allergens ?? []) expect(allergens.has(a), `${item.pl}: ${a}`).toBe(true);
      for (const [u, grams] of Object.entries(item.units ?? {})) {
        expect(units.has(u), `${item.pl}: ${u}`).toBe(true);
        expect(grams, `${item.pl}: ${u}`).toBeGreaterThan(0);
      }
    }
  });

  it('produkty z mąki pszennej i żytniej są oznaczone glutenem, nabiał mlekiem', () => {
    const byName = new Map(seedItems().map((i) => [i.pl, i]));
    for (const name of [
      'Mąka pszenna',
      'Mąka żytnia',
      'Chleb pszenny',
      'Makaron pszenny',
      'Kasza manna',
      'Mąka orkiszowa',
      'Pita',
    ]) {
      expect(byName.get(name)?.allergens, name).toContain('GLUTEN');
    }
    for (const name of [
      'Mleko 3,2%',
      'Masło',
      'Jogurt naturalny',
      'Ser gouda',
      'Śmietana 18%',
      'Twaróg chudy',
      'Mascarpone',
    ]) {
      expect(byName.get(name)?.allergens, name).toContain('MILK');
    }
  });

  it('kategorie z jednoznacznym alergenem mają go zawsze (ryby, jaja, nabiał krowi)', () => {
    for (const item of seedItems()) {
      if (
        item.category === 'FISH' &&
        /ryb|łosoś|dorsz|karp|makrel|śledź|tuńczyk|pstrąg|halibut|morszczuk|mintaj|tilapia|sardyn/i.test(
          item.pl,
        )
      ) {
        expect(item.allergens, item.pl).toContain('FISH');
      }
      if (item.category === 'EGGS') expect(item.allergens, item.pl).toContain('EGGS');
    }
  });

  it('dokładnie 14 alergenów UE', () => {
    expect(ALLERGENS).toHaveLength(14);
  });
});
