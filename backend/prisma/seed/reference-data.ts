/** Dane słownikowe: alergeny, kategorie składników i jednostki miar. */

/** 14 alergenów, które w UE trzeba oznaczać (rozporządzenie 1169/2011, zał. II). */
export const ALLERGENS = [
  { code: 'GLUTEN', pl: 'Gluten', en: 'Gluten', icon: 'grain' },
  { code: 'CRUSTACEANS', pl: 'Skorupiaki', en: 'Crustaceans', icon: 'set_meal' },
  { code: 'EGGS', pl: 'Jaja', en: 'Eggs', icon: 'egg' },
  { code: 'FISH', pl: 'Ryby', en: 'Fish', icon: 'phishing' },
  { code: 'PEANUTS', pl: 'Orzeszki ziemne', en: 'Peanuts', icon: 'nutrition' },
  { code: 'SOY', pl: 'Soja', en: 'Soy', icon: 'eco' },
  { code: 'MILK', pl: 'Mleko (w tym laktoza)', en: 'Milk (incl. lactose)', icon: 'water_drop' },
  { code: 'NUTS', pl: 'Orzechy', en: 'Tree nuts', icon: 'forest' },
  { code: 'CELERY', pl: 'Seler', en: 'Celery', icon: 'grass' },
  { code: 'MUSTARD', pl: 'Gorczyca', en: 'Mustard', icon: 'local_florist' },
  { code: 'SESAME', pl: 'Sezam', en: 'Sesame', icon: 'scatter_plot' },
  { code: 'SULPHITES', pl: 'Dwutlenek siarki i siarczyny', en: 'Sulphites', icon: 'science' },
  { code: 'LUPIN', pl: 'Łubin', en: 'Lupin', icon: 'spa' },
  { code: 'MOLLUSCS', pl: 'Mięczaki', en: 'Molluscs', icon: 'waves' },
] as const;

export type AllergenCode = (typeof ALLERGENS)[number]['code'];

export const CATEGORIES = [
  { code: 'VEGETABLES', pl: 'Warzywa', en: 'Vegetables', icon: 'eco' },
  { code: 'FRUITS', pl: 'Owoce', en: 'Fruits', icon: 'nutrition' },
  { code: 'MUSHROOMS', pl: 'Grzyby', en: 'Mushrooms', icon: 'forest' },
  { code: 'LEGUMES', pl: 'Rośliny strączkowe', en: 'Legumes', icon: 'grain' },
  { code: 'GRAINS', pl: 'Zboża, kasze i makarony', en: 'Grains & pasta', icon: 'rice_bowl' },
  { code: 'BAKERY', pl: 'Pieczywo', en: 'Bread & bakery', icon: 'bakery_dining' },
  { code: 'BAKING', pl: 'Do pieczenia', en: 'Baking', icon: 'cake' },
  { code: 'DAIRY', pl: 'Nabiał', en: 'Dairy', icon: 'water_drop' },
  { code: 'EGGS', pl: 'Jaja', en: 'Eggs', icon: 'egg' },
  { code: 'MEAT', pl: 'Mięso', en: 'Meat', icon: 'kebab_dining' },
  { code: 'POULTRY', pl: 'Drób', en: 'Poultry', icon: 'egg_alt' },
  { code: 'FISH', pl: 'Ryby i owoce morza', en: 'Fish & seafood', icon: 'set_meal' },
  { code: 'NUTS_SEEDS', pl: 'Orzechy i nasiona', en: 'Nuts & seeds', icon: 'scatter_plot' },
  { code: 'FATS', pl: 'Tłuszcze i oleje', en: 'Fats & oils', icon: 'oil_barrel' },
  { code: 'HERBS_SPICES', pl: 'Zioła i przyprawy', en: 'Herbs & spices', icon: 'spa' },
  { code: 'SAUCES', pl: 'Sosy i dodatki', en: 'Sauces & condiments', icon: 'soup_kitchen' },
  { code: 'SWEETS', pl: 'Słodycze i słodziki', en: 'Sweets & sweeteners', icon: 'icecream' },
  { code: 'BEVERAGES', pl: 'Napoje', en: 'Beverages', icon: 'local_cafe' },
  { code: 'OTHER', pl: 'Inne', en: 'Other', icon: 'category' },
] as const;

export type CategoryCode = (typeof CATEGORIES)[number]['code'];

/**
 * Jednostki kuchenne. Gramatura zależy od składnika (łyżka mąki ≠ łyżka miodu),
 * więc przeliczniki trzymamy przy składniku. Tu tylko słownik i wartości domyślne
 * dla płynów (ml), używane gdy składnik ma gęstość.
 */
export const UNITS = [
  { code: 'PIECE', pl: 'sztuka', en: 'piece', ml: null },
  { code: 'SLICE', pl: 'plaster', en: 'slice', ml: null },
  { code: 'CLOVE', pl: 'ząbek', en: 'clove', ml: null },
  { code: 'BUNCH', pl: 'pęczek', en: 'bunch', ml: null },
  { code: 'HANDFUL', pl: 'garść', en: 'handful', ml: null },
  { code: 'PINCH', pl: 'szczypta', en: 'pinch', ml: null },
  { code: 'CAN', pl: 'puszka', en: 'can', ml: null },
  { code: 'PACKAGE', pl: 'opakowanie', en: 'package', ml: null },
  { code: 'TEASPOON', pl: 'łyżeczka', en: 'teaspoon', ml: 5 },
  { code: 'TABLESPOON', pl: 'łyżka', en: 'tablespoon', ml: 15 },
  { code: 'GLASS', pl: 'szklanka', en: 'glass (250 ml)', ml: 250 },
] as const;

export type UnitCode = (typeof UNITS)[number]['code'];
