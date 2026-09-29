import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
    title: 'Cookivo',
  },
  {
    path: 'recipes',
    loadComponent: () => import('./features/recipes/recipes-page').then((m) => m.RecipesPage),
    data: { titleKey: 'nav.recipes' },
  },
  {
    path: 'how-it-works',
    loadComponent: () => import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
    data: { titleKey: 'nav.howItWorks', icon: 'lightbulb', stage: 4 },
  },
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        canMatch: [guestGuard],
        data: { titleKey: 'auth.login.title' },
        loadComponent: () => import('./features/auth/login/login-page').then((m) => m.LoginPage),
      },
      {
        path: 'register',
        canMatch: [guestGuard],
        data: { titleKey: 'auth.register.title' },
        loadComponent: () => import('./features/auth/register/register-page').then((m) => m.RegisterPage),
      },
      {
        path: 'verify-email',
        data: { titleKey: 'auth.verify.title' },
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email-page').then((m) => m.VerifyEmailPage),
      },
      {
        path: 'forgot-password',
        data: { titleKey: 'auth.forgot.title' },
        loadComponent: () =>
          import('./features/auth/forgot-password/forgot-password-page').then((m) => m.ForgotPasswordPage),
      },
      {
        path: 'reset-password',
        data: { titleKey: 'auth.reset.title' },
        loadComponent: () =>
          import('./features/auth/reset-password/reset-password-page').then((m) => m.ResetPasswordPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },
  {
    path: 'legal/:doc',
    loadComponent: () => import('./features/legal/legal-page').then((m) => m.LegalPage),
  },
  // Sekcje dla zalogowanych - wypełniamy je w kolejnych etapach.
  ...(
    [
      ['planner', 'nav.planner', 'calendar_month', 6],
      ['shopping', 'nav.shopping', 'shopping_cart', 7],
      ['pantry', 'nav.pantry', 'kitchen', 7],
      ['prices', 'nav.prices', 'sell', 7],
      ['profile', 'nav.profile', 'person', 4],
      ['preferences', 'nav.preferences', 'tune', 4],
      ['my-recipes', 'nav.myRecipes', 'menu_book', 3],
      ['household', 'nav.household', 'group', 5],
      ['settings', 'nav.settings', 'settings', 4],
    ] as const
  ).map(([path, titleKey, icon, stage]) => ({
    path,
    canMatch: [authGuard],
    loadComponent: () => import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
    data: { titleKey, icon, stage },
  })),
  {
    path: '**',
    data: { titleKey: 'notFound.title' },
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
