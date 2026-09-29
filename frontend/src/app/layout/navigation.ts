export interface NavItem {
  path: string;
  /** Klucz tłumaczenia */
  label: string;
  /** Krótsza etykieta dla dolnego paska na telefonie */
  shortLabel?: string;
  icon: string;
  exact?: boolean;
}

export const GUEST_NAV: NavItem[] = [
  { path: '/recipes', label: 'nav.recipes', icon: 'restaurant_menu' },
  { path: '/how-it-works', label: 'nav.howItWorks', shortLabel: 'nav.howItWorksShort', icon: 'lightbulb' },
];

export const USER_NAV: NavItem[] = [
  { path: '/recipes', label: 'nav.recipes', icon: 'restaurant_menu' },
  { path: '/planner', label: 'nav.planner', icon: 'calendar_month' },
  { path: '/shopping', label: 'nav.shopping', shortLabel: 'nav.shoppingShort', icon: 'shopping_cart' },
  { path: '/pantry', label: 'nav.pantry', icon: 'kitchen' },
  { path: '/prices', label: 'nav.prices', icon: 'sell' },
];

/** Dolny pasek na telefonie: max 5 pozycji, ostatnia to profil. */
export const USER_BOTTOM_NAV: NavItem[] = [
  USER_NAV[0],
  USER_NAV[1],
  USER_NAV[2],
  USER_NAV[3],
  { path: '/profile', label: 'nav.profile', shortLabel: 'nav.profileShort', icon: 'person' },
];

export const GUEST_BOTTOM_NAV: NavItem[] = [
  { path: '/', label: 'nav.home', icon: 'home', exact: true },
  ...GUEST_NAV,
  { path: '/auth/login', label: 'nav.login', icon: 'login' },
];

export const USER_MENU: NavItem[] = [
  { path: '/profile', label: 'nav.profile', icon: 'person' },
  { path: '/preferences', label: 'nav.preferences', icon: 'tune' },
  { path: '/my-recipes', label: 'nav.myRecipes', icon: 'menu_book' },
  { path: '/household', label: 'nav.household', icon: 'group' },
  { path: '/settings', label: 'nav.settings', icon: 'settings' },
];
