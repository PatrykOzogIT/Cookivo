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
