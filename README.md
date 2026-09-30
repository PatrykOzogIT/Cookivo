# Cookivo

## Food Planner

Food planning and recipe management application built with
Angular and NestJS.

## Features

- 🍲 Recipe management
- 📅 Weekly meal planning
- 🥗 Nutrition & calorie tracking
- 🛒 Automatic shopping lists
- 💰 Food budget planning
- 🏠 Household meal planning
- 🥕 Pantry management
- ⚠️ Allergies & food intolerances
- ⭐ Recipe ratings and variants

## Tech Stack

**Frontend**

- Angular
- TypeScript
- Angular Material

**Backend**

- NestJS
- TypeScript
- Prisma
- REST API

**Database**

- PostgreSQL

## Architecture

- **Frontend** — Angular single-page app (standalone components, signals), mobile-first, PL/EN, light & dark theme, WCAG 2.1 AA.
- **Backend** — NestJS REST API under `/api`, JWT access tokens + rotating refresh tokens in `httpOnly` cookies, role-based access (guest → user → admin → super admin).
- **Database** — PostgreSQL with Prisma migrations.
- **Quality** — unit & API integration tests (Vitest), end-to-end and accessibility tests (Playwright + axe-core), CI on GitHub Actions.

## Screenshots

Coming soon.

## Project status

🚧 Currently under active development.

---

## Dokumentacja deweloperska

Planer posiłków: kalorie i makro pod cel, przepisy (publiczne/prywatne), plan tygodnia, lodówka, listy zakupów i cenniki — także dla całego gospodarstwa domowego.

| Warstwa  | Technologie                                                                         |
| -------- | ----------------------------------------------------------------------------------- |
| Frontend | Angular 22 (standalone, signals, zoneless), Angular Material 3, Transloco (PL/EN)   |
| Backend  | NestJS 12, Prisma 7, PostgreSQL 17                                                  |
| Testy    | Vitest (unit + integracyjne API), Playwright + axe-core (E2E, WCAG AA)              |
| Dev      | Docker Compose (Postgres + Mailpit), ESLint/oxlint, Prettier, husky, GitHub Actions |

### Szybki start

Wymagania: **Node 24** (`nvm use 24`), **Docker Desktop**.

```bash
npm run setup      # instalacja zależności, kontenery, migracje
cp backend/.env.example backend/.env   # i ustaw JWT_ACCESS_SECRET
npm run dev        # API :3000 + frontend :4200
```

| Adres                          | Co to                                 |
| ------------------------------ | ------------------------------------- |
| http://localhost:4200          | aplikacja                             |
| http://localhost:3000/api/docs | dokumentacja API (Swagger, tylko dev) |
| http://localhost:8025          | Mailpit - podgląd wysyłanych maili    |

> Postgres w kontenerze działa na porcie **5433**, żeby nie kolidować z lokalną instalacją.

#### Dane startowe

`npm run db:seed --prefix backend` wgrywa 14 alergenów UE, kategorie, jednostki i ~350 składników.
Wartości odżywcze pochodzą z [USDA FoodData Central](https://fdc.nal.usda.gov/) (SR Legacy, domena publiczna),
przeliczone na standard etykiety UE (węglowodany bez błonnika, sól = sód × 2,5). Polskie nazwy, alergeny i przeliczniki
kuchenne są w `backend/prisma/seed/ingredients.catalog.ts`; wartości odświeża `npm run db:usda --prefix backend -- <katalog-CSV>`.

#### Konto super admina

Nie da się go założyć przez API — tylko komendą na serwerze:

```bash
npm run create-super-admin --prefix backend -- --username szef --email szef@example.com
```

### Testy

```bash
npm test                 # unit: backend + frontend
npm run test:e2e         # integracyjne API na prawdziwej bazie (cookivo_test)
npx playwright test      # E2E + audyt dostępności na desktop / tablet / telefon
```

Definicja „gotowe” dla każdej funkcji: testy zielone, lint czysty, sprawdzone na 375 / 768 / desktop, w PL i EN, w jasnym i ciemnym motywie, bez naruszeń axe (WCAG 2.1 AA).

### Struktura

```
backend/
  prisma/            schemat i migracje bazy, seed (prisma/seed)
  src/auth/          rejestracja, logowanie, sesje, reset hasła
  src/common/        guardy (JWT, role) i dekoratory (@Public, @Roles, @CurrentUser)
  src/ingredients/   składniki: wyszukiwarka (pg_trgm), akceptacja admina, walidacja wartości
  src/recipes/       przepisy: podprzepisy, wyliczanie wartości i alergenów (recipe-math.ts)
  src/photos/        zdjęcia: WebP w 3 rozmiarach (sharp), bez metadanych GPS
  src/profile/       profil żywieniowy, kalkulator kcal/makro, alergie, preferencje, dopasowanie list
  src/account/       ustawienia konta, urządzenia, eksport danych i usunięcie konta (RODO)
  src/moderation/    filtr wulgaryzmów
  src/mail/          maile (PL/EN)
  test/              testy integracyjne API
frontend/
  public/i18n/       tłumaczenia pl.json / en.json
  src/app/core/      auth, i18n, motyw
  src/app/layout/    menu, układ strony z filtrami (panel / bottom sheet)
  src/app/features/  strony
e2e/                 testy Playwright
```

### Bezpieczeństwo (skrót)

- Hasła: argon2id, min. 12 znaków, ocena siły zxcvbn (PL/EN), sprawdzanie wycieków HaveIBeenPwned (k-anonymity).
- Sesja: access token JWT (15 min) w pamięci + refresh token w ciasteczku `httpOnly; SameSite=Strict`, rotowany, z wykrywaniem ponownego użycia.
- Blokada konta po 5 nieudanych logowaniach, limity żądań na IP, `helmet`, walidacja DTO (odrzucanie nieznanych pól).
- Odpowiedzi nie zdradzają, czy konto o danym mailu istnieje.
- Dane o zdrowiu (waga, cel, alergie) tylko po wyraźnej zgodzie; jej wycofanie usuwa te dane. Eksport wszystkich danych (JSON) i usunięcie konta w ustawieniach - publiczne przepisy zostają jako anonimowe.
- Role: gość → `USER` → `ADMIN` → `SUPER_ADMIN` (globalny guard, endpointy publiczne oznaczone `@Public()`).

### Plan

0. Fundament ✅ · 1. Konta ✅ · 2. Składniki i alergeny ✅ · 3. Przepisy, tryb gotowania, zdjęcia ✅ · 4. Profil żywieniowy, kalkulator, preferencje, RODO (eksport/usuwanie) ✅ · 5. Gospodarstwa · 6. Planer · 7. Lodówka, zakupy, cenniki · 8. Warianty i oceny · 9. Moderacja i panel admina · 10. PWA · 11. Wdrożenie

---

## License

Copyright © 2026 Patryk Ożóg. All rights reserved.

This repository is publicly available for portfolio and demonstration
purposes only. No permission is granted to copy, modify, distribute,
sublicense, or use this software or substantial portions of it for
commercial or non-commercial purposes without prior written permission
from the copyright holder.
