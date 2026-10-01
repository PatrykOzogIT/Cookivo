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
    children: [
      {
        path: '',
        loadComponent: () => import('./features/recipes/recipes-page').then((m) => m.RecipesPage),
        data: { titleKey: 'nav.recipes' },
      },
      {
        path: 'new',
        canMatch: [authGuard],
        loadComponent: () => import('./features/recipes/form/recipe-form-page').then((m) => m.RecipeFormPage),
        data: { titleKey: 'recipes.form.addTitle' },
      },
      {
        path: ':id/edit',
        canMatch: [authGuard],
        loadComponent: () => import('./features/recipes/form/recipe-form-page').then((m) => m.RecipeFormPage),
        data: { titleKey: 'recipes.form.editTitle' },
      },
      {
        path: ':id/cook',
        loadComponent: () =>
          import('./features/recipes/cook/cooking-mode-page').then((m) => m.CookingModePage),
        data: { titleKey: 'recipes.cook.title' },
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./features/recipes/detail/recipe-detail-page').then((m) => m.RecipeDetailPage),
        data: { titleKey: 'nav.recipes' },
      },
    ],
  },
  {
    path: 'ingredients',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/ingredients/list/ingredients-page').then((m) => m.IngredientsPage),
        data: { titleKey: 'nav.ingredients' },
      },
      {
        path: 'new',
        canMatch: [authGuard],
        loadComponent: () =>
          import('./features/ingredients/form/ingredient-form-page').then((m) => m.IngredientFormPage),
        data: { titleKey: 'ingredients.form.addTitle' },
      },
      {
        path: ':id/edit',
        canMatch: [authGuard],
        loadComponent: () =>
          import('./features/ingredients/form/ingredient-form-page').then((m) => m.IngredientFormPage),
        data: { titleKey: 'ingredients.form.editTitle' },
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./features/ingredients/detail/ingredient-detail-page').then((m) => m.IngredientDetailPage),
        data: { titleKey: 'nav.ingredients' },
      },
    ],
  },
  {
    path: 'how-it-works',
    loadComponent: () => import('./features/how-it-works/how-it-works-page').then((m) => m.HowItWorksPage),
    data: { titleKey: 'nav.howItWorks' },
  },
  {
    path: 'profile',
    canMatch: [authGuard],
    loadComponent: () => import('./features/profile/profile-page').then((m) => m.ProfilePage),
    data: { titleKey: 'nav.profile' },
  },
  {
    path: 'preferences',
    canMatch: [authGuard],
    loadComponent: () => import('./features/profile/preferences-page').then((m) => m.PreferencesPage),
    data: { titleKey: 'nav.preferences' },
  },
  {
    path: 'planner',
    canMatch: [authGuard],
    data: { titleKey: 'nav.planner' },
    loadComponent: () => import('./features/planner/planner-page').then((m) => m.PlannerPage),
  },
  {
    path: 'shopping',
    canMatch: [authGuard],
    data: { titleKey: 'nav.shopping' },
    loadComponent: () => import('./features/shopping/shopping-page').then((m) => m.ShoppingPage),
  },
  {
    path: 'pantry',
    canMatch: [authGuard],
    data: { titleKey: 'nav.pantry' },
    loadComponent: () => import('./features/pantry/pantry-page').then((m) => m.PantryPage),
  },
  {
    path: 'household',
    children: [
      {
        path: 'join',
        data: { titleKey: 'household.join.pageTitle' },
        loadComponent: () => import('./features/household/join-page').then((m) => m.HouseholdJoinPage),
      },
      {
        path: '',
        canMatch: [authGuard],
        data: { titleKey: 'nav.household' },
        loadComponent: () => import('./features/household/household-page').then((m) => m.HouseholdPage),
      },
    ],
  },
  { path: 'my-recipes', redirectTo: '/recipes?mine=1' },
  {
    path: 'settings',
    canMatch: [authGuard],
    loadComponent: () => import('./features/profile/settings-page').then((m) => m.SettingsPage),
    data: { titleKey: 'nav.settings' },
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
        path: 'confirm-email',
        data: { titleKey: 'settings.confirmEmail.title' },
        loadComponent: () => import('./features/profile/confirm-email-page').then((m) => m.ConfirmEmailPage),
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
  ...([['prices', 'nav.prices', 'sell', 7]] as const).map(([path, titleKey, icon, stage]) => ({
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
