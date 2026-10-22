import type { Allergen, Localized, Nutrition, Page } from '../ingredients/ingredients.models';

export type { Page };

export interface MealType extends Localized {
  code: string;
  icon: string;
}

export interface Photo {
  id: string;
  width: number;
  height: number;
  urls: { small: string; medium: string; large: string };
  /** Zdjęcie z otwartej licencji (np. Wikimedia Commons) */
  credit?: PhotoCredit;
}

export interface PhotoCredit {
  author: string | null;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string | null;
}

/** Przepis z otwartego źródła (biblioteka startowa) - atrybucja wymagana przez licencję */
export interface RecipeSource {
  name: string;
  locale: 'pl' | 'en';
  title: string;
  url: string;
  historyUrl: string | null;
  authors: string | null;
  license: string;
  licenseUrl: string;
  changes: string[];
  /** To wersja przepisu z tego źródła */
  adapted: boolean;
}

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type Visibility = 'PRIVATE' | 'HOUSEHOLD' | 'GROUPS' | 'PUBLIC';

export interface RecipeSummary {
  id: string;
  title: string;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: Difficulty | null;
  visibility: Visibility;
  canBeIngredient: boolean;
  hidden: boolean;
  kcalPerServing: number;
  mealTypes: MealType[];
  allergens: Allergen[];
  cover: Photo | null;
  author: { id: string; username: string } | null;
  isOwn: boolean;
  /** Alergeny z listy zalogowanego użytkownika (kody) */
  myAllergens: string[];
  /** Średnia ocen (null = brak ocen) */
  ratingAvg: number | null;
  ratingCount: number;
  isVariant: boolean;
  /** Grupy znajomych, w których przepis jest udostępniony (autor widzi wszystkie, inni - swoje) */
  groups: { id: string; name: string }[];
}

export interface MyRating {
  stars: number;
  comment: string | null;
}

export interface RatingSummary {
  ratingAvg: number | null;
  ratingCount: number;
  myRating: MyRating | null;
}

export interface RatingItem {
  userId: string;
  /** null = nazwa ukryta po zgłoszeniach */
  username: string | null;
  isMine: boolean;
  /** Ukryta przez moderację (widzi ją tylko autor opinii) */
  hidden: boolean;
  stars: number;
  comment: string | null;
  updatedAt: string;
}

/** Oryginał albo wariant w sekcji "Alternatywy" */
export interface VariantSummary extends RecipeSummary {
  variantNote: string | null;
  isOriginal: boolean;
}

export interface RecipeLine {
  id: string;
  groupName: string | null;
  amount: number;
  unitCode: string;
  grams: number;
  note: string | null;
  ingredient: {
    id: string;
    namePl: string;
    nameEn: string | null;
    density: number | null;
    units: (Localized & { code: string; grams: number })[];
    allergens: string[];
  } | null;
  subRecipe: { id: string; title: string; servings: number; viewable: boolean } | null;
}

export interface RecipeDetail extends RecipeSummary {
  description: string | null;
  cookedGrams: number | null;
  totalGrams: number;
  nutrition: {
    total: Nutrition;
    per100g: Nutrition | null;
    perServing: Nutrition;
    servingGrams: number;
    approximate: boolean;
  };
  photos: Photo[];
  ingredients: RecipeLine[];
  steps: { text: string; timerMinutes: number | null; photo: Photo | null }[];
  usedInCount: number;
  variantNote: string | null;
  variantOf: { id: string; title: string; author: string | null; viewable: boolean } | null;
  variantsCount: number;
  myRating: MyRating | null;
  source: RecipeSource | null;
  canEdit: boolean;
  hiddenReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeQuery {
  q?: string;
  mealTypes?: string[];
  excludeAllergens?: string[];
  maxKcal?: number;
  maxMinutes?: number;
  canBeIngredient?: boolean;
  mine?: boolean;
  forMe?: boolean;
  forUs?: boolean;
  household?: boolean;
  groups?: boolean;
  groupId?: string;
  sort?: 'newest' | 'kcal' | 'time' | 'name' | 'forYou' | 'fromPantry' | 'rating';
  lang?: string;
  page?: number;
  pageSize?: number;
}

export interface SaveRecipe {
  variantNote?: string | null;
  /** Tylko przy tworzeniu: wersja tego przepisu (np. od asystenta) */
  variantOfId?: string;
  title: string;
  description?: string;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: Difficulty | null;
  visibility: Visibility;
  /** Tylko przy visibility = GROUPS */
  groupIds: string[];
  canBeIngredient: boolean;
  cookedGrams: number | null;
  mealTypes: string[];
  ingredients: {
    ingredientId?: string;
    subRecipeId?: string;
    amount: number;
    unitCode: string;
    groupName?: string;
    note?: string;
  }[];
  steps: { text: string; timerMinutes: number | null; photoId: string | null }[];
  photoIds: string[];
}
