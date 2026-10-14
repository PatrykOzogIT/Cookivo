import type { AllergenCode, CategoryCode, UnitCode } from './reference-data.js';

/**
 * Składniki z tabeli ANSES Ciqual 2025 (Licence Ouverte 2.0 - wymaga podania źródła).
 * Wartości odżywcze (już w standardzie etykiety UE) wyciąga `tools/ciqual-extract.ts`
 * do `ciqual.data.json`. Tu trzymamy to, czego w Ciqual nie ma: polskie nazwy, kategorie,
 * alergeny UE i typowe gramatury jednostek kuchennych.
 *
 * Tylko produkty o pewnym składzie - wyroby, których alergeny zależą od receptury producenta
 * (wędliny, pasztety, sosy), wymagają osobnej weryfikacji.
 */
export interface CiqualItem {
  pl: string;
  en: string;
  /** Kod produktu w Ciqual (alim_code) */
  ciqual: number;
  category: CategoryCode;
  allergens?: AllergenCode[];
  /** Gęstość w g/ml - tylko dla płynów */
  density?: number;
  /** Gramy na jednostkę */
  units?: Partial<Record<UnitCode, number>>;
}

export const CIQUAL_CATALOG: CiqualItem[] = [
  // --- Paczka 1: polska kuchnia - braki ----------------------------------------
  // Nabiał i zamienniki roślinne
  {
    pl: 'Twaróg chudy',
    en: 'Quark, low-fat',
    ciqual: 19644,
    category: 'DAIRY',
    allergens: ['MILK'],
    units: { TABLESPOON: 25, PACKAGE: 250 },
  },
  {
    pl: 'Twaróg półtłusty',
    en: 'Quark, semi-skimmed',
    ciqual: 19646,
    category: 'DAIRY',
    allergens: ['MILK'],
    units: { TABLESPOON: 25, PACKAGE: 250 },
  },
  {
    pl: 'Serek homogenizowany naturalny',
    en: 'Smooth quark, plain',
    ciqual: 19664,
    category: 'DAIRY',
    allergens: ['MILK'],
    units: { TABLESPOON: 25, PACKAGE: 150 },
  },
  {
    pl: 'Serek kremowy do smarowania',
    en: 'Cream cheese spread, plain',
    ciqual: 12068,
    category: 'DAIRY',
    allergens: ['MILK'],
    units: { TABLESPOON: 20, TEASPOON: 7, PACKAGE: 150 },
  },
  {
    pl: 'Mascarpone',
    en: 'Mascarpone',
    ciqual: 19584,
    category: 'DAIRY',
    allergens: ['MILK'],
    units: { TABLESPOON: 25, PACKAGE: 250 },
  },
  {
    pl: 'Ser topiony w plastrach',
    en: 'Processed cheese slices',
    ciqual: 12300,
    category: 'DAIRY',
    allergens: ['MILK'],
    units: { SLICE: 20 },
  },
  {
    pl: 'Śmietana 30% gęsta',
    en: 'Thick cream 30%',
    ciqual: 19410,
    category: 'DAIRY',
    allergens: ['MILK'],
    density: 1.0,
    units: { TABLESPOON: 15, GLASS: 240 },
  },
  {
    pl: 'Napój owsiany niesłodzony',
    en: 'Oat drink, unsweetened',
    ciqual: 18899,
    category: 'BEVERAGES',
    allergens: ['GLUTEN'],
    density: 1.03,
  },
  {
    pl: 'Napój sojowy niesłodzony',
    en: 'Soy drink, unsweetened',
    ciqual: 18900,
    category: 'BEVERAGES',
    allergens: ['SOY'],
    density: 1.03,
  },
  {
    pl: 'Jogurt sojowy naturalny',
    en: 'Soy yogurt, plain',
    ciqual: 19693,
    category: 'DAIRY',
    allergens: ['SOY'],
    units: { TABLESPOON: 20, PACKAGE: 400 },
  },

  // Mięso i podroby
  { pl: 'Wątróbka wieprzowa', en: 'Pork liver', ciqual: 40119, category: 'MEAT' },
  { pl: 'Królik', en: 'Rabbit', ciqual: 34001, category: 'MEAT' },
  {
    pl: 'Kurczak - tuszka ze skórą',
    en: 'Whole chicken, with skin',
    ciqual: 36016,
    category: 'POULTRY',
    units: { PIECE: 1500 },
  },
  { pl: 'Żołądki drobiowe', en: 'Chicken gizzards', ciqual: 40700, category: 'POULTRY' },
  { pl: 'Serca drobiowe', en: 'Chicken hearts', ciqual: 40054, category: 'POULTRY' },

  // Ryby
  { pl: 'Halibut', en: 'Halibut', ciqual: 26009, category: 'FISH', allergens: ['FISH'] },
  {
    pl: 'Makrela wędzona',
    en: 'Smoked mackerel',
    ciqual: 26087,
    category: 'FISH',
    allergens: ['FISH'],
    units: { PIECE: 250 },
  },

  // Mąki, kasze, pieczywo
  {
    pl: 'Mąka gryczana',
    en: 'Buckwheat flour',
    ciqual: 9540,
    category: 'BAKING',
    units: { GLASS: 130, TABLESPOON: 8 },
  },
  {
    pl: 'Mąka orkiszowa',
    en: 'Spelt flour',
    ciqual: 9480,
    category: 'BAKING',
    allergens: ['GLUTEN'],
    units: { GLASS: 140, TABLESPOON: 8, TEASPOON: 3 },
  },
  {
    pl: 'Mąka ryżowa',
    en: 'Rice flour',
    ciqual: 9520,
    category: 'BAKING',
    units: { GLASS: 150, TABLESPOON: 9 },
  },
  {
    pl: 'Mąka jaglana',
    en: 'Millet flour',
    ciqual: 9555,
    category: 'BAKING',
    units: { GLASS: 130, TABLESPOON: 8 },
  },
  {
    pl: 'Kasza kukurydziana (polenta)',
    en: 'Polenta (cornmeal)',
    ciqual: 9614,
    category: 'GRAINS',
    units: { GLASS: 160, TABLESPOON: 12 },
  },
  {
    pl: 'Otręby owsiane',
    en: 'Oat bran',
    ciqual: 9640,
    category: 'GRAINS',
    allergens: ['GLUTEN'],
    units: { GLASS: 90, TABLESPOON: 7 },
  },
  {
    pl: 'Otręby pszenne',
    en: 'Wheat bran',
    ciqual: 9621,
    category: 'GRAINS',
    allergens: ['GLUTEN'],
    units: { GLASS: 60, TABLESPOON: 5 },
  },
  {
    pl: 'Pita',
    en: 'Pita bread',
    ciqual: 7180,
    category: 'BAKERY',
    allergens: ['GLUTEN'],
    units: { PIECE: 60 },
  },

  // Inne
  {
    pl: 'Tahini (pasta sezamowa)',
    en: 'Tahini',
    ciqual: 15203,
    category: 'NUTS_SEEDS',
    allergens: ['SESAME'],
    units: { TABLESPOON: 15, TEASPOON: 5 },
  },
  {
    pl: 'Buraki gotowane',
    en: 'Beetroot, cooked',
    ciqual: 20003,
    category: 'VEGETABLES',
    units: { PIECE: 150 },
  },
  {
    pl: 'Jajko przepiórcze',
    en: 'Quail egg',
    ciqual: 22050,
    category: 'EGGS',
    allergens: ['EGGS'],
    units: { PIECE: 10 },
  },
];
