import type { Wiki } from './types.js';

/** Przepis gotowy do zapisu w bazie (wiersz recipes.import.jsonl) */
export interface RecipeRecord {
  /** wikibooks-pl:123#1 = RecipeSource.externalId */
  key: string;
  wiki: Wiki;
  revId: number;
  course: string;
  views: number | null;
  /** Treść główna przepisu - zawsze po polsku */
  title: string;
  description: string | null;
  servings: number;
  servingsEstimated: boolean;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | null;
  mealTypes: string[];
  ingredients: {
    /** Nazwa zatwierdzonego składnika (importer szuka jej po normalizacji w bazie docelowej) */
    ingredient: string;
    amount: number;
    unitCode: string;
    groupName: string | null;
    note: string | null;
  }[];
  steps: { text: string; timerMinutes: number | null }[];
  /** Druga wersja językowa (angielska) - kroki i pozycje w tej samej kolejności */
  translation: {
    locale: 'en';
    title: string;
    description: string | null;
    steps: string[];
    lines: { groupName: string | null; note: string | null }[];
  };
  source: {
    sourceName: string;
    sourceLocale: Wiki;
    sourceTitle: string;
    url: string;
    historyUrl: string;
    license: string;
    licenseUrl: string;
    changes: string[];
    datasetVersion: string;
  };
  photo: RecipePhoto | null;
}

export interface RecipePhoto {
  /** Stałe id zdjęcia (nazwa plików WebP) - nadawane raz, w photo-cache.json */
  id: string;
  file: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
  author: string | null;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string;
}

export const LICENSE = 'CC BY-SA 4.0';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
