import type { StructuredLine, StructuredRecipe } from './ai-schema.js';
import {
  evaluate,
  ingredientIndex,
  jaccard,
  resolveLine,
  type Candidate,
  type CatalogIngredient,
} from './build.js';
import { amountInText, overlap, toCookivo, valuesInText, wordSet } from './units.js';
import { cleanWikitext, judge } from './wikitext.js';

const PAGE = `{{Plik|plik=Ukrainian potato pancakes.jpg|auto=tak|opis=Placki}}
Placki to [[Książka kucharska/Ziemniak|ziemniaki]] smażone na tłuszczu.
[[Kategoria:Przepisy kulinarne]]
== Placki ==
=== Składniki ===
* ''2 kg ziemniaków''
* ''1 jajko''
* ''0,5 szklanki mąki''
* ''sól''
=== Przygotowanie ===
Ziemniaki zetrzeć, dodać jajko i mąkę. Piec w temp. {{C|250}}.
<gallery>
File:Placki 2.jpg|Inne
</gallery>`;

describe('wikitekst', () => {
  it('prosta kontrola kompletności', () => {
    expect(judge(PAGE)).toBe('OK');
    expect(judge(PAGE.replace('=== Przygotowanie ===', '=== Uwagi ==='))).toBe('NO_STEPS');
    expect(judge('== Ingredients ==\n* salt\n* pepper\n* oil\n== Procedure ==\nMix.')).toBe('NO_AMOUNTS');
    expect(judge('Strona o składniku.')).toBe('NO_INGREDIENTS');
  });

  it('czysty tekst, zdjęcia (szablon strony pierwszy) i kategorie', () => {
    const c = cleanWikitext(PAGE);
    expect(c.images).toEqual(['Ukrainian potato pancakes.jpg', 'Placki 2.jpg']);
    expect(c.categories).toEqual(['Przepisy kulinarne']);
    expect(c.text).toContain('Placki to ziemniaki smażone');
    expect(c.text).toContain('250 °C');
    expect(c.text).toContain('* 2 kg ziemniaków');
    expect(c.text).not.toMatch(/\[\[|\{\{|''/);
  });

  it('szablon przepisu z angielskich Wikibooks: pola jako tekst, zdjęcie z pola', () => {
    const c = cleanWikitext(
      '{{recipesummary|category=Dessert recipes|servings=4|time=30 minutes|difficulty=2|Image=[[File:Pancakes.jpg|300px]]}}\n== Ingredients ==',
    );
    expect(c.images).toEqual(['Pancakes.jpg']);
    expect(c.text).toContain('servings: 4');
    expect(c.text).toContain('category: Dessert recipes');
  });
});

describe('ilości i jednostki', () => {
  it('liczby w tekście: przecinek, ułamki, mieszane, słowa', () => {
    expect(valuesInText('0,5 szklanki')).toContain(0.5);
    expect(valuesInText('1 1/2 cups flour')).toContain(1.5);
    expect(valuesInText('½ tsp salt')).toContain(0.5);
    expect(valuesInText('pół kostki masła')).toContain(0.5);
    expect(valuesInText('two eggs')).toContain(2);
    expect(amountInText(3, '2 tbsp sugar')).toBe(false);
    expect(amountInText(2, '2 tbsp sugar')).toBe(true);
    // 1 bez liczby ("cebula", "an egg")
    expect(amountInText(1, 'cebula')).toBe(true);
  });

  it('przeliczenia: metryczne dokładnie, amerykańskie zaokrąglone i oznaczone', () => {
    expect(toCookivo(2, 'kg')).toEqual({ amount: 2, unitCode: 'kg', converted: false });
    expect(toCookivo(1.5, 'dl')).toEqual({ amount: 150, unitCode: 'ml', converted: false });
    expect(toCookivo(8, 'OZ')).toEqual({ amount: 225, unitCode: 'g', converted: true });
    expect(toCookivo(2, 'CUP')).toEqual({ amount: 2, unitCode: 'GLASS', converted: true });
    expect(toCookivo(3, 'TABLESPOON')).toEqual({ amount: 3, unitCode: 'TABLESPOON', converted: false });
  });

  it('udział słów ze strony (kroki nie mogą być dopisane)', () => {
    const words = wordSet('Ziemniaki zetrzeć na tarce, dodać jajko i mąkę, smażyć na oleju.');
    expect(overlap('Ziemniaki zetrzeć na tarce.', words)).toBe(1);
    expect(overlap('Udekorować kawiorem i podawać z szampanem.', words)).toBeLessThan(0.5);
  });
});

const ING: CatalogIngredient[] = [
  {
    namePl: 'Ziemniaki',
    nameEn: 'Potatoes',
    category: 'VEGETABLES',
    density: null,
    units: [{ code: 'PIECE', grams: 150 }],
  },
  {
    namePl: 'Jajko kurze',
    nameEn: 'Egg',
    category: 'EGGS',
    density: null,
    units: [{ code: 'PIECE', grams: 50 }],
  },
  { namePl: 'Mąka pszenna', nameEn: 'Wheat flour', category: 'GRAINS', density: 0.55, units: [] },
  {
    namePl: 'Sól',
    nameEn: 'Salt',
    category: 'HERBS_SPICES',
    density: 1.2,
    units: [{ code: 'PINCH', grams: 0.5 }],
  },
  { namePl: 'Olej rzepakowy', nameEn: 'Rapeseed oil', category: 'FATS', density: 0.92, units: [] },
  { namePl: 'Mleko 3,2%', nameEn: 'Milk', category: 'DAIRY', density: null, units: [] },
];
const index = ingredientIndex(ING, { TEASPOON: 5, TABLESPOON: 15, GLASS: 250, PIECE: null, PINCH: null });

const line = (over: Partial<StructuredLine>): StructuredLine => ({
  text: 'x',
  group: null,
  name: 'ziemniak',
  catalogName: null,
  amount: 1,
  unit: 'PIECE',
  note: null,
  toTaste: false,
  ...over,
});

describe('pozycje przepisu', () => {
  it('nazwa z listy, pewne dopasowanie albo brak składnika', () => {
    expect(
      resolveLine(line({ name: 'jajko', catalogName: 'Jajko kurze', amount: 2 }), index, null).line,
    ).toMatchObject({
      ingredient: 'Jajko kurze',
      amount: 2,
      unitCode: 'PIECE',
    });
    expect(resolveLine(line({ name: 'ziemniak', amount: 2, unit: 'kg' }), index, null).line).toMatchObject({
      ingredient: 'Ziemniaki',
      amount: 2,
      unitCode: 'kg',
    });
    expect(resolveLine(line({ name: 'szafran' }), index, null)).toEqual({ missing: 'szafran' });
  });

  it('jednostka bez gęstości czeka na uzupełnienie składnika', () => {
    expect(
      resolveLine(line({ name: 'mleko', catalogName: 'Mleko 3,2%', amount: 1, unit: 'GLASS' }), index, null),
    ).toEqual({
      missingUnit: 'Mleko 3,2% (szklanka)',
      unitNeed: { ingredient: 'Mleko 3,2%', unitCode: 'GLASS' },
    });
  });

  it('bez ilości: przyprawa = szczypta, tłuszcz = łyżka, reszta odrzuca przepis', () => {
    expect(
      resolveLine(line({ name: 'sól', amount: null, unit: null, toTaste: true }), index, null),
    ).toMatchObject({
      line: { ingredient: 'Sól', amount: 1, unitCode: 'PINCH' },
      assumed: true,
    });
    expect(
      resolveLine(line({ name: 'olej rzepakowy', amount: null, unit: null, toTaste: true }), index, null)
        .line,
    ).toMatchObject({ amount: 1, unitCode: 'TABLESPOON' });
    expect(
      resolveLine(line({ name: 'jajko', catalogName: 'Jajko kurze', amount: null }), index, null),
    ).toEqual({
      reject: 'MISSING_AMOUNT',
    });
  });
});

const recipe = (over: Partial<StructuredRecipe> = {}): StructuredRecipe => ({
  title: 'Placki',
  description: null,
  servings: 4,
  servingsEstimated: false,
  prepMinutes: null,
  cookMinutes: null,
  difficulty: 'EASY',
  mealTypes: ['DINNER'],
  course: 'MAIN',
  ingredients: [
    line({ name: 'ziemniak', amount: 2, unit: 'kg' }),
    line({ name: 'jajko', catalogName: 'Jajko kurze' }),
    line({ name: 'cukier', catalogName: null, amount: 1, unit: 'TABLESPOON', toTaste: false }),
  ],
  steps: [{ text: 'Zetrzeć i smażyć.', timerMinutes: null }],
  problems: [],
  ...over,
});
const candidate = (r: StructuredRecipe, checks: string[] = []): Candidate => ({
  key: 'wikibooks-pl:1#1',
  pageKey: 'wikibooks-pl:1',
  wiki: 'pl',
  pageTitle: 'Książka kucharska/Placki',
  revId: 5,
  views: 10,
  index: 0,
  recipe: r,
  checks,
  images: [],
});

describe('kontrola jakości przepisu', () => {
  it('dodatek do podania bez ilości trafia do opisu, nie odrzuca przepisu', () => {
    const e = evaluate(
      candidate(
        recipe({
          ingredients: [
            ...recipe().ingredients.slice(0, 2),
            line({
              text: 'do podania: starty parmezan',
              name: 'parmezan',
              amount: null,
              unit: null,
              toTaste: true,
            }),
          ],
        }),
      ),
      index,
    );
    expect(e.status).toBe('READY');
    expect(e.recipe.ingredients).toHaveLength(2);
    expect(e.recipe.description).toBe('Do podania: starty parmezan.');
    expect(e.changes).toContain('SERVED_WITH');
  });

  it('brak składnika w bazie = czeka (lista braków), poza tym gotowy', () => {
    expect(evaluate(candidate(recipe()), index)).toMatchObject({
      status: 'WAITING_INGREDIENT',
      missing: ['cukier'],
    });
    const ok = evaluate(candidate(recipe({ ingredients: recipe().ingredients.slice(0, 2) })), index);
    expect(ok.status).toBe('READY');
    expect(ok.changes).toEqual(['RESTRUCTURED']);
  });

  it('problem z odczytu, ilość spoza strony albo brak porcji = odrzucony', () => {
    expect(evaluate(candidate(recipe({ problems: ['MISSING_AMOUNTS'] })), index)).toMatchObject({
      status: 'REJECTED',
      reason: expect.stringContaining('MISSING_AMOUNTS'),
    });
    expect(evaluate(candidate(recipe(), ['AMOUNT_NOT_IN_SOURCE:0']), index).reason).toContain(
      'AMOUNT_NOT_IN_SOURCE',
    );
    expect(evaluate(candidate(recipe({ servings: 0 })), index).reason).toContain('SERVINGS');
  });

  it('podobieństwo zestawów składników', () => {
    expect(jaccard(new Set(['a', 'b', 'c', 'd']), new Set(['a', 'b', 'c', 'd']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['c']))).toBe(0);
  });
});
