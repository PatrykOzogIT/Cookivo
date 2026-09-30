export interface Localized {
  namePl: string;
  nameEn?: string | null;
}

export interface Allergen extends Localized {
  code: string;
  icon: string;
}

export interface Category extends Localized {
  code: string;
  icon: string;
}

export interface Unit extends Localized {
  code: string;
  /** Objętość jednostki w ml (np. łyżka = 15) */
  ml: number | null;
}

export interface Dictionaries {
  allergens: Allergen[];
  categories: Category[];
  units: Unit[];
  mealTypes: (Localized & { code: string; icon: string })[];
}

/** Na 100 g; null = brak danych */
export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
}

export type IngredientStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Ingredient extends Localized {
  id: string;
  category: Category;
  status: IngredientStatus;
  source: 'USDA' | 'USER';
  sourceRef: string | null;
  nutrition: Nutrition;
  density: number | null;
  allergens: Allergen[];
  units: (Localized & { code: string; grams: number })[];
  createdBy: { username: string } | null;
  isOwn: boolean;
  canEdit: boolean;
  canDelete: boolean;
  rejectionReason: string | null;
  /** Dopasowanie do zalogowanego użytkownika; brak dla gości */
  personal?: PersonalInfo;
  createdAt: string;
  updatedAt: string;
}

export type PreferenceLevel = 'NEVER' | 'SOMETIMES' | 'LIKE' | 'LOVE';

export interface PersonalInfo {
  preference: PreferenceLevel | null;
  categoryPreference: PreferenceLevel | null;
  myAllergens: string[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IngredientQuery {
  q?: string;
  category?: string;
  excludeAllergens?: string[];
  mine?: boolean;
  forMe?: boolean;
  status?: IngredientStatus;
  lang?: string;
  page?: number;
  pageSize?: number;
}

export interface SaveIngredient {
  namePl: string;
  nameEn?: string;
  categoryCode: string;
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  density: number | null;
  allergens: string[];
  units: { code: string; grams: number }[];
}
