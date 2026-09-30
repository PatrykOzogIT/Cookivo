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
}

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type Visibility = 'PRIVATE' | 'PUBLIC';

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
  author: { username: string } | null;
  isOwn: boolean;
  /** Alergeny z listy zalogowanego użytkownika (kody) */
  myAllergens: string[];
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
  sort?: 'newest' | 'kcal' | 'time' | 'name' | 'forYou';
  lang?: string;
  page?: number;
  pageSize?: number;
}

export interface SaveRecipe {
  title: string;
  description?: string;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: Difficulty | null;
  visibility: Visibility;
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
