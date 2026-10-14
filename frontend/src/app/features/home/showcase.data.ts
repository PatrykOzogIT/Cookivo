/** Prezentacja możliwości Cookivo na stronie głównej (slajdy + karty-skróty) */
export interface ShowcaseSlide {
  /** Klucz tłumaczeń `home.showcase.slides.<key>` */
  key: string;
  icon: string;
  /** Dostęp: dla każdego czy po zalogowaniu */
  access: 'public' | 'account';
  /** Coś, co można (ale nie trzeba) uzupełnić */
  optional: boolean;
  /** Dokąd prowadzi przycisk */
  path: string;
}

/** Kolejność: od podstaw (bez konta) do funkcji zaawansowanych */
export const SLIDES: readonly ShowcaseSlide[] = [
  { key: 'recipes', icon: 'fork_spoon', access: 'public', optional: false, path: '/recipes' },
  { key: 'ingredients', icon: 'nutrition', access: 'public', optional: false, path: '/ingredients' },
  { key: 'planner', icon: 'calendar_month', access: 'account', optional: false, path: '/planner' },
  { key: 'shopping', icon: 'shopping_cart', access: 'account', optional: false, path: '/shopping' },
  { key: 'goals', icon: 'monitoring', access: 'account', optional: true, path: '/profile' },
  { key: 'pantry', icon: 'kitchen', access: 'account', optional: true, path: '/pantry' },
  { key: 'budget', icon: 'sell', access: 'account', optional: true, path: '/prices' },
  { key: 'household', icon: 'group', access: 'account', optional: true, path: '/household' },
];

/** Na start pokazujemy wykres kalorii - najlepiej oddaje charakter aplikacji */
export const INITIAL_SLIDE = 'goals';

/** Indeks po przesunięciu o `delta` z zawijaniem */
export function stepIndex(current: number, delta: number, total: number): number {
  return (((current + delta) % total) + total) % total;
}
