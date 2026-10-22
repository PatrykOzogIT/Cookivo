/*
 * Alergeny UE (14) z nazwy produktu - reguły dla produktów jednoskładnikowych i oczywistych
 * przetworów. Żadne źródło (Ciqual, USDA) nie podaje alergenów, więc:
 *  - reguła daje alergeny pewne tylko tam, gdzie nazwa jednoznacznie określa produkt,
 *  - wyroby złożone (sosy, słodycze, pieczywo słodkie, wędliny…) zawsze idą do weryfikacji.
 */

export type AllergenCode =
  | 'GLUTEN'
  | 'CRUSTACEANS'
  | 'EGGS'
  | 'FISH'
  | 'PEANUTS'
  | 'SOY'
  | 'MILK'
  | 'NUTS'
  | 'CELERY'
  | 'MUSTARD'
  | 'SESAME'
  | 'SULPHITES'
  | 'LUPIN'
  | 'MOLLUSCS';

const RULES: [AllergenCode, RegExp, RegExp?][] = [
  [
    'GLUTEN',
    /\b(wheat|flour|bread|pasta|spaghetti|macaroni|noodle|couscous|bulgur|semolina|barley|rye|spelt|oat|oats|oatmeal|cracker|biscuit|cake|croissant|brioche|pastry|pie crust|bagel|muffin|pretzel|waffle|pancake|beer|seitan|malt|bran|crouton|breadcrumb|tortilla|pita|matzo|farina|durum|kamut|triticale|freekeh)\b/i,
    // Mąki i produkty bez glutenu - także w szyku USDA ("Flour, rice", "Rice bran")
    /\b((rice|corn|maize|potato|buckwheat|chickpea|almond|coconut|soy|soya|tapioca|chestnut|quinoa|millet|teff|sorghum|amaranth|lentil|pea|bean|cassava|arrowroot) (flour|meal|starch|noodles?|bran)|flour,? (of )?(rice|corn|maize|potato|buckwheat|chickpea|almond|coconut|soy|soya|tapioca|chestnut|quinoa|millet|teff|sorghum|amaranth|lentil|pea|bean|cassava|arrowroot)|cornmeal|buckwheat|tapioca|gluten[- ]free|rice cakes?|rice crackers?|corn tortillas?|oat milk|nutmeg)\b/i,
  ],
  [
    'MILK',
    /\b(milk|cheese|yogh?urt|cream|butter|whey|kefir|quark|curd|ricotta|mozzarella|cheddar|parmesan|feta|brie|camembert|gouda|emmental|mascarpone|buttermilk|ghee|casein|lactose|custard|ice cream|fromage|skyr|labneh|paneer|halloumi)\b/i,
    /\b(coconut milk|coconut cream|almond milk|soy milk|soya milk|oat milk|rice milk|rice drink|oat drink|almond drink|soy drink|soya drink|cocoa butter|peanut butter|nut butter|almond butter|cashew butter|shea butter|butternut|butter bean|cream of tartar|ice cream bean|cream soda)\b/i,
  ],
  ['EGGS', /\b(egg|eggs|yolk|mayonnaise|meringue|egg noodle)\b/i, /\b(eggplant|egg plant|egg-free)\b/i],
  [
    'FISH',
    /\b(fish|salmon|tuna|cod|herring|mackerel|sardine|anchov(y|ies)|trout|carp|pike|perch|hake|pollock|haddock|halibut|sole|plaice|flounder|tilapia|pangasius|catfish|eel|sprat|bream|zander|whiting|monkfish|sea bass|bass|swordfish|caviar|roe|surimi|fish sauce|cod liver)\b/i,
  ],
  ['CRUSTACEANS', /\b(shrimp|prawn|crab|lobster|crayfish|langoustine|krill|scampi)\b/i],
  [
    'MOLLUSCS',
    /\b(mussel|oyster|clam|scallop|squid|octopus|snail|cuttlefish|whelk|cockle|abalone|calamari)\b/i,
  ],
  ['PEANUTS', /\b(peanut|groundnut)\b/i],
  [
    'NUTS',
    /\b(almond|hazelnut|filbert|walnut|cashew|pecan|pistachio|macadamia|brazil nut|praline|marzipan|nougat)\b/i,
    /\b(nutmeg|coconut|chestnut|water chestnut|butternut|peanut|tiger nut)\b/i,
  ],
  ['SOY', /\b(soy|soya|soybean|tofu|tempeh|edamame|miso|tamari)\b/i],
  ['SESAME', /\b(sesame|tahini|halva|halvah)\b/i],
  ['MUSTARD', /\b(mustard)\b/i],
  ['CELERY', /\b(celery|celeriac)\b/i],
  ['LUPIN', /\b(lupin|lupine)\b/i],
  ['SULPHITES', /\b(wine|sulphite|sulfite|sulfured)\b/i, /\b(wine vinegar)\b/i],
];

/** Alergeny z nazwy (EN; dla Ciqual także FR po angielskiej nazwie wystarczy) */
export function allergensFromName(nameEn: string): AllergenCode[] {
  // Reguły są w liczbie pojedynczej - sprawdzamy też nazwę bez końcówek liczby mnogiej ("muffins", "cashews")
  const singular = nameEn.replace(/\b([a-z]{3,}?)(ies)\b/gi, '$1y').replace(/\b([a-z]{3,}?[^s])s\b/gi, '$1');
  const out: AllergenCode[] = [];
  for (const [code, include, exclude] of RULES) {
    const hit = [nameEn, singular].some((name) =>
      include.test(exclude ? name.replace(new RegExp(exclude.source, 'gi'), ' ') : name),
    );
    if (hit) out.push(code);
  }
  return out;
}

/**
 * Kategorie, w których produkty są zwykle jednoskładnikowe - tu reguła z nazwy wystarcza.
 * W pozostałych (sosy, słodycze, pieczywo, wędliny, napoje) skład zależy od receptury.
 */
const SIMPLE_CATEGORIES = new Set([
  'VEGETABLES',
  'FRUITS',
  'MUSHROOMS',
  'LEGUMES',
  'GRAINS',
  'EGGS',
  'MEAT',
  'POULTRY',
  'FISH',
  'NUTS_SEEDS',
  'FATS',
  'HERBS_SPICES',
  'DAIRY',
]);

export function simpleCategory(category: string): boolean {
  return SIMPLE_CATEGORIES.has(category);
}
