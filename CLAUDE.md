# Cookivo - wskazówki dla Claude

Komunikacja z właścicielem projektu po polsku. Komentarze w kodzie też po polsku.

## Uruchamianie

- Node 24 (`nvm use 24`), Docker Desktop. Postgres z docker-compose na porcie **5433** (5432 zajmuje lokalny Postgres 18).
- `npm run dev` - API :3000 + web :4200 (proxy `/api` → 3000). Maile w dev: Mailpit http://localhost:8025.
- Lokalny `backend/.env` ma `THROTTLE_ENABLED=false` (inaczej równoległe testy E2E trafiają w limity).

## Testy (wszystkie muszą być zielone przed uznaniem pracy za gotową)

- Backend: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run test:e2e` (w `backend/`, baza `cookivo_test`).
- Frontend: `npx eslint src`, `npx ng test --watch=false` (w `frontend/`).
- E2E + WCAG AA: `npx playwright test --project=desktop --project=tablet --project=mobile` (w katalogu głównym).
- Po zmianach w UI: sprawdzić w przeglądarce 375 / 768 / desktop, PL i EN, jasny i ciemny motyw.

## Konwencje

- Backend zwraca **kody błędów** (`{ code: 'USERNAME_TAKEN' }`), frontend tłumaczy je kluczem `errors.<KOD>` w `frontend/public/i18n/{pl,en}.json`. Nowy kod = tłumaczenie w obu plikach (test `translations.spec.ts` pilnuje zgodności kluczy).
- Każdy endpoint domyślnie wymaga logowania; dla gości `@Public()`, uprawnienia `@Roles('ADMIN')`.
- Backend to ESM - importy względne z rozszerzeniem `.js`. Klient Prisma generowany do `backend/src/generated/prisma`.
- Frontend: standalone + signals, zoneless, Reactive Forms, Angular Material 3. Kolory tylko przez tokeny `--ck-*` ze `styles.scss` (definiowane `light-dark()`); każda nowa para tekst/tło musi mieć kontrast AA.
- Mobile-first: cele dotyku ≥ 44 px, właściwe `type`/`inputmode`/`autocomplete`, `env(safe-area-inset-*)`. Filtry stron przez `app-page-layout` (panel z lewej / bottom sheet).
- Hasła: polityka (12+ znaków, zxcvbn ≥ 3) jest zdublowana w `backend/src/auth/password-policy.service.ts` i `frontend/src/app/features/auth/password/password-strength.service.ts` - zmieniać razem.
- Wartości odżywcze zawsze na 100 g w standardzie etykiety UE; `null` = brak danych (nigdy nie zamieniać na 0). Reguły spójności są zdublowane w `backend/src/ingredients/nutrition.ts` i `frontend/.../ingredients/form/nutrition-validators.ts`.
- Pola liczbowe w formularzach: `type="text" inputmode="decimal"` + `parseDecimal()` (przyjmuje polski przecinek); wyświetlanie przez pipe `num` z językiem.
- Nazwy ze słowników (alergeny, kategorie, jednostki) przychodzą jako `namePl`/`nameEn` - wyświetlać pipe'em `localized`.
- Dane startowe: `npm run db:seed` (idempotentny). Katalog składników w `backend/prisma/seed/ingredients.catalog.ts`; test `seed-data.spec.ts` sprawdza spójność. W testach e2e nie używać `TRUNCATE ... CASCADE` na `users` - wyczyści też składniki.
- Przyklejony nagłówek i dolny pasek: `scroll-padding` w `styles.scss` pilnuje, by fokus nie chował się pod nimi (WCAG 2.4.11).
- Przepisy: sumy wartości, waga i alergeny są zapisane w tabeli `recipes` i przeliczane przez `RecipeCalculatorService` (po zapisie przepisu, zmianie podprzepisu albo składnika z bazy - propagacja w górę). Czysta logika liczenia: `backend/src/recipes/recipe-math.ts`.
- Wartości przepisu: na porcję zawsze dokładne; na 100 g z opcjonalnego `cookedGrams` (waga po ugotowaniu), a bez niego z sumy surowych składników (flaga `approximate`).
- Zdjęcia: `POST /api/photos` (max 5 MB, JPG/PNG/WebP) → WebP 400/900/1600 px w `UPLOADS_DIR`, serwowane z `/api/media/`. Nieprzypięte do przepisu są sprzątane po dobie. Front zmniejsza zdjęcie przed wysyłką (`image-compress.ts`).
- Ilości w przepisach wyświetlać pipe'em `amountLabel` (polska odmiana: 1 łyżka / 2 łyżki / 5 łyżek; formy w `recipes.unitForms`).
- Testy E2E w WebKit na Windowsie (`PW_WEBKIT=1`) potrafią losowo crashować przy nawigacji ("Page crashed") - to błąd przeglądarki testowej; wiążący jest wynik CI (Linux).
- Kalkulator kcal/makro (Mifflin-St Jeor) jest zdublowany: `backend/src/profile/nutrition-calculator.ts` i `frontend/.../profile/nutrition-calculator.ts` - zmieniać razem (te same testy).
- Dane o zdrowiu (profil, alergie) wymagają zgody `HEALTH_DATA` (`403 HEALTH_CONSENT_REQUIRED`); wycofanie zgody je usuwa.
- Personalizacja list: `forMe` (domyślnie włączone dla zalogowanych, `?forMe=0` wyłącza) i sortowanie `forYou` - SQL w `backend/src/profile/personalization.ts`. Uwaga na NULL przy braku preferencji (`coalesce(..., false)`).
- Ciasteczko refresh ma ścieżkę `/api/auth` - poza nią bieżącą sesję rozpoznaje się po `sid` w access tokenie (`AuthUser.sessionId`).
- Gospodarstwa: jedno na osobę (`household_members.user_id` = PK), jeden właściciel (indeks częściowy). Przepisy `HOUSEHOLD` widzą domownicy (`householdMatesSql`, `canView(..., mates)`); przepis widoczny dla innych nie może używać prywatnych podprzepisów ani niezatwierdzonych składników. Alergie domownika tylko za jego zgodą `HOUSEHOLD_ALLERGIES` (`shareAllergies`); wycofanie zgody zdrowotnej ją wyłącza.
- Planer: `PlanCook` (partia: przepis ugotowany w N porcjach) + `PlanMeal` (porcje z partii zjedzone w dniu/posiłku). Dzień partii = najwcześniejszy posiłek, partia bez posiłków znika (`syncCookDate`). Plan należy do gospodarstwa albo użytkownika (CHECK `num_nonnulls`). Daty jako `@db.Date` / `YYYY-MM-DD`, na froncie bez stref (`plan-math.ts`).
- Dokładność opcjonalna: tryb prosty (porcje, równy podział) jest domyślny; gramy/udziały na osobę tylko po włączeniu `exactPortions` (etap 6b).
