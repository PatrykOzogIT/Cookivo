# Wdrożenie Cookivo (cookivo.pl)

Każdy push do `main` po zielonych testach aktualizuje stronę (GitHub Actions → zadanie **Wdrożenie**).

## Architektura

```
przeglądarka ──► cookivo.pl (hosting jchost, DirectAdmin + CloudLinux)
                  ├─ /            Apache: frontend Angular z public_html (.htaccess: HTTPS, trasy SPA, cache)
                  └─ /api         Passenger: backend NestJS ("Setup Node.js App", Node 22)
                                    └─► PostgreSQL 17 w Neon (Frankfurt) - połączenie przez pooler
GitHub Actions ── FTP(S) ──► pliki na hostingu
               ── direct ──► Neon: `prisma migrate deploy` + dane startowe
```

- Hosting nie ma PostgreSQL ani SSH, dlatego baza jest w Neon, a pliki trafiają na serwer przez FTP.
- Hosting blokuje wychodzący port 5432, więc aplikacja łączy się z Neon przez **WebSocket po 443** (`DB_DRIVER=neon`: `@prisma/adapter-neon` + `@neondatabase/serverless`). Lokalnie, w testach i przy migracjach z GitHub Actions - zwykły `pg` po TCP.
- Backend wgrywamy jako jeden plik (`backend/scripts/bundle.mjs`: `dist/main.mjs` + moduły natywne `argon2`, `sharp` dla Linuksa x64 w `dist/node_modules`). Zależności nie są instalowane na serwerze.
- Restart aplikacji: Passenger restartuje ją, gdy zmieni się `tmp/restart.txt` (wgrywany na końcu).
- Konfiguracja (`.env`) powstaje w Actions z sekretów i trafia do katalogu aplikacji poza `public_html`.
- Zdjęcia: `UPLOADS_DIR` poza katalogiem wdrożenia (np. `../cookivo-data/uploads`), więc wdrożenie ich nie nadpisuje.
- Osobne konto FTP zamknięte w katalogu domeny - wdrożenie nie ma dostępu do reszty hostingu:

```
/home/<login>/domains/cookivo.pl/   ← katalog główny konta FTP "deploy@cookivo.pl"
├── public_html/     frontend
├── cookivo-api/     backend (Setup Node.js App)
└── cookivo-data/uploads/   zdjęcia
```

## Jednorazowa konfiguracja

### 1. Hosting (DirectAdmin)

1. **SSL**: certyfikat Let's Encrypt dla `cookivo.pl` i `www.cookivo.pl` (przed pierwszym wdrożeniem - `.htaccess` przekierowuje na HTTPS).
2. **Poczta**: skrzynka np. `no-reply@cookivo.pl`; dane SMTP z panelu: `mail.cookivo.pl`, port 587 (STARTTLS - w produkcji wymuszony) albo 465 (SSL).
3. **Setup Node.js App → Create application**:

   | Pole                     | Wartość                          |
   | ------------------------ | -------------------------------- |
   | Wersja Node.js           | 22.x                             |
   | Tryb aplikacji           | Production                       |
   | Katalog główny aplikacji | `domains/cookivo.pl/cookivo-api` |
   | URL aplikacji            | `cookivo.pl` / `api`             |
   | Plik startowy            | `app.cjs`                        |

   Zmiennych środowiskowych w panelu nie trzeba - aplikacja czyta `.env` wgrywany przy wdrożeniu.

4. **FTP**: osobne konto (np. `deploy@cookivo.pl`) z katalogiem `/home/<login>/domains/cookivo.pl` (opcja własnej ścieżki), połączenie FTPS (jawne FTP przez TLS). Ścieżki w zmiennych są względem tego katalogu.

### 2. Baza (Neon)

Projekt `cookivo`, region AWS Europe Central 1 (Frankfurt). Potrzebne dwa adresy z **Connect**:

- z `-pooler` w nazwie hosta → sekret `DATABASE_URL` (aplikacja),
- bez `-pooler` → sekret `DATABASE_URL_DIRECT` (migracje).

### 3. GitHub (Settings → Environments → `production`)

**Secrets**

| Nazwa                                              | Wartość                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                     | adres Neon z `-pooler`                                                                                                                     |
| `DATABASE_URL_DIRECT`                              | adres Neon bez `-pooler`                                                                                                                   |
| `JWT_ACCESS_SECRET`                                | losowy, min. 32 znaki: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`                                    |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | dane skrzynki (465 = SSL, 587 = STARTTLS)                                                                                                  |
| `ANTHROPIC_API_KEY` (opcjonalny)                   | klucz Claude API do odczytu przepisów i paragonów ze zdjęć; bez niego obie funkcje są ukryte. Ustaw limit wydatków w console.anthropic.com |
| `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`       | konto FTP                                                                                                                                  |

**Variables**

| Nazwa              | Przykład                                                        |
| ------------------ | --------------------------------------------------------------- |
| `APP_URL`          | `https://cookivo.pl`                                            |
| `MAIL_FROM`        | `Cookivo <no-reply@cookivo.pl>`                                 |
| `UPLOADS_DIR`      | `../cookivo-data/uploads`                                       |
| `FTP_BACKEND_DIR`  | `cookivo-api/` (z ukośnikiem na końcu)                          |
| `FTP_FRONTEND_DIR` | `public_html/`                                                  |
| `FTP_PROTOCOL`     | `ftps` (domyślnie) albo `ftp`, jeśli hosting nie obsługuje FTPS |

Na końcu w **Settings → Secrets and variables → Actions → Variables** (poziom repozytorium) ustaw `DEPLOY_ENABLED` = `true`. Bez tego zadanie wdrożenia jest pomijane.

### 4. Konto super admina

Raz, z własnego komputera, na bazie produkcyjnej (adres bez `-pooler`):

```bash
cd backend
DATABASE_URL="<adres Neon bez -pooler>" npm run create-super-admin -- --username <nazwa> --email <mail>
```

Hasło jest generowane i wypisywane jeden raz (albo podane w `SUPER_ADMIN_PASSWORD`).

## Co robi zadanie „Wdrożenie”

1. Czeka na zielone: formatowanie, backend (Node 22 i 24), frontend, E2E.
2. Buduje frontend i paczkę backendu.
3. `prisma migrate deploy` i dane startowe (idempotentne) na Neon.
4. Tworzy `.env`, wgrywa backend, potem `tmp/restart.txt` (restart), potem frontend.
5. Sprawdza `https://cookivo.pl/api/health` i stronę główną - błąd oznacza czerwone zadanie.

Wdrożenia na `main` nie przerywają się nawzajem (kolejka `deploy-production`).

## Gdy coś nie działa

- **Strona 503 / błąd aplikacji**: Setup Node.js App → aplikacja → log (stderr). Restart: przycisk _Restart_ albo ponowne uruchomienie zadania.
- **Błąd `.env`**: zadanie wypisze, którego sekretu/zmiennej brakuje.
- **Migracja się nie udała**: zadanie zatrzymuje się przed wgraniem plików - strona działa na poprzedniej wersji.
- **FTPS nie działa**: ustaw zmienną `FTP_PROTOCOL` = `ftp` (hasło idzie wtedy otwartym tekstem - tylko jeśli hosting nie ma FTPS).
