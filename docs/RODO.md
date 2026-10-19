# RODO i wymagania prawne – dokumentacja wewnętrzna

> Dokument roboczy administratora (nie jest publikowany w aplikacji). Teksty dla użytkowników:
> polityka prywatności i regulamin w `frontend/public/i18n/{pl,en}.json` (`legal.privacyDoc`, `legal.termsDoc`),
> strona `/legal/privacy` i `/legal/terms`. Przygotowane starannie, ale **bez weryfikacji prawnika** –
> przed promocją serwisu warto zlecić krótki przegląd.

- **Administrator / usługodawca:** Patryk Ożóg (osoba prywatna), kontakt: kontakt@cookivo.pl
  (też punkt kontaktowy DSA, art. 11–12).
- **Inspektor ochrony danych:** nie wyznaczono (art. 37 – brak obowiązku).
- **Wersje dokumentów:** `backend/src/legal/legal.ts` (`TERMS_VERSION`, `PRIVACY_POLICY_VERSION`) =
  `LEGAL_EFFECTIVE` we `frontend/src/app/features/legal/legal.ts` = data „Obowiązuje od” na stronie.

## Do zrobienia przez administratora (poza kodem)

- [x] Skrzynka **kontakt@cookivo.pl** założona (2026-10-15) – czytać regularnie.
- [x] **JCHost** – umowa powierzenia to załącznik nr 1 do regulaminu (rozdz. 24), zawarta z zamówieniem
      hostingu: https://jchost.pl/regulamin/. Usługodawca: Marcin Ćwiertnia JC HOST.PL, NIP 5130232935. - [ ] Zapisać PDF regulaminu („Pobierz regulamin”) jako dowód brzmienia umowy.
- [ ] **Neon = Databricks, Inc.** (USA, właściciel Neon, LLC) – DPA wchodzi automatycznie przez Master Cloud
      Services Agreement (https://neon.com/platform-terms → databricks.com/legal/mcsa → databricks.com/legal/dpa).
      Opcjonalnie podpisać elektronicznie: https://www.databricks.com/legal/databricks-data-processing-addendum. - [ ] W PDF DPA potwierdzić mechanizm transferu (szukać „Standard Contractual Clauses” / „Data Privacy Framework”);
      jeśli inny niż SCC – poprawić akapit „Komu przekazujemy dane” w polityce (PL i EN). - [ ] W konsoli Neon (projekt → Settings → General) potwierdzić region AWS Europe Central 1 (Frankfurt).
- [ ] **Anthropic** (gdy włączysz import ze zdjęć): założyć konto w console.anthropic.com, ustawić **limit wydatków** (Settings → Limits), zaakceptować DPA i wpisać klucz jako sekret `ANTHROPIC_API_KEY` (GitHub Secrets → .env na hostingu). Bez klucza funkcja jest ukryta.
- [ ] Sprawdzić retencję kopii zapasowych w planie Neon (polityka mówi „do kilku dni”).
- [ ] Przy zmianie dokumentów: nowa data w obu stałych + w treści, po zalogowaniu użytkownicy zobaczą
      prośbę o akceptację (`GET /api/me/legal` → `pending`). Zmianę regulaminu ogłaszać ≥ 14 dni wcześniej.

## Rejestr czynności przetwarzania (art. 30)

Obowiązkowy mimo małej skali – przetwarzamy dane szczególnej kategorii (zdrowie).

| Czynność                    | Cel                                                     | Podstawa                     | Kategorie osób               | Dane                                                                                            | Odbiorcy            | Retencja                                                               |
| --------------------------- | ------------------------------------------------------- | ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| Konto                       | rejestracja, logowanie, maile o koncie                  | 6(1)(b)                      | użytkownicy                  | nazwa, e-mail, skrót hasła, język, daty                                                         | JCHost, Neon        | do usunięcia konta                                                     |
| Treści użytkownika          | przepisy, zdjęcia, oceny, planer, lodówka, zakupy, ceny | 6(1)(b)                      | użytkownicy                  | treści, zdjęcia (bez metadanych GPS)                                                            | JCHost, Neon        | do usunięcia; publiczne przepisy zostają anonimowo                     |
| Profil żywieniowy i alergie | kalkulator, filtrowanie przepisów                       | 9(2)(a) – zgoda HEALTH_DATA  | użytkownicy                  | płeć, data urodzenia, wzrost, waga, aktywność, cel, alergie                                     | Neon                | do wycofania zgody / usunięcia konta                                   |
| Gospodarstwo                | wspólne plany, podział porcji                           | 6(1)(b); 9(2)(a) dla zdrowia | użytkownicy, osoby bez konta | członkostwo, zaproszenia (e-mail), osoby bez konta: imię/pseudonim, rok ur., płeć, kcal         | Neon, JCHost (mail) | do usunięcia gospodarstwa / osoby                                      |
| Grupy znajomych             | dzielenie się przepisami w grupie                       | 6(1)(b)                      | użytkownicy                  | członkostwo, rola, status akceptacji, kto zaprosił, zaproszenia (e-mail), udostępnione przepisy | Neon, JCHost (mail) | do wyjścia z grupy / usunięcia konta; wyjście cofa udostępnienie       |
| Odczyt przepisu ze zdjęć    | wypełnienie formularza przepisu                         | 6(1)(b)                      | użytkownicy                  | zdjęcia przepisu (tylko w trakcie odczytu), licznik użycia (data, liczba zdjęć, wynik, tokeny)  | Anthropic PBC       | zdjęcia: nie przechowujemy; licznik: 90 dni                            |
| Bezpieczeństwo              | ochrona kont, wykazanie zgód                            | 6(1)(f), 7(1)                | użytkownicy                  | IP i przeglądarka sesji, nieudane logowania, historia zgód z IP                                 | Neon                | sesje: 30 dni po wygaśnięciu (`purgeStale`); zgody: do usunięcia konta |
| Moderacja                   | zgłoszenia, decyzje, blokady (DSA)                      | 6(1)(c), 6(1)(f)             | użytkownicy, zgłaszający     | zgłoszenia, powody, decyzje, blokady                                                            | Neon, JCHost (mail) | do usunięcia treści / konta zgłaszającego                              |
| Korespondencja              | odpowiedzi na wiadomości                                | 6(1)(f)                      | osoby piszące                | e-mail, treść                                                                                   | JCHost              | do zakończenia sprawy + okres przedawnienia roszczeń                   |

Środki bezpieczeństwa (art. 32): Argon2id, HTTPS + HSTS na API, refresh token w ciasteczku `httpOnly; SameSite=Strict`
z rotacją i wykrywaniem ponownego użycia, blokada po 5 nieudanych logowaniach, limity żądań, walidacja DTO,
zdjęcia bez metadanych, eksport i usuwanie danych w ustawieniach, sekrety tylko w GitHub Secrets / na hostingu.

## Podmioty przetwarzające

| Podmiot                 | Rola                                   | Lokalizacja danych   | Umowa powierzenia                                | Transfer poza EOG                                             |
| ----------------------- | -------------------------------------- | -------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| JCHost                  | hosting aplikacji, zdjęć, poczta       | Polska               | zał. 1 do regulaminu                             | nie                                                           |
| Databricks, Inc. (Neon) | baza PostgreSQL                        | UE – Frankfurt (AWS) | DPA w MCSA (automatycznie)                       | możliwy dostęp z USA – SCC (do potwierdzenia)                 |
| Anthropic PBC           | odczyt przepisów ze zdjęć (Claude API) | USA                  | do akceptacji (Commercial Terms + DPA w konsoli) | tak - SCC (do potwierdzenia w DPA); API nie trenuje na danych |

Nie są podmiotami przetwarzającymi: Have I Been Pwned (dostaje tylko 5 znaków skrótu SHA-1 hasła),
GitHub (kod i CI – bez danych użytkowników). Fonty i ikony serwujemy sami (`scripts/icons.mjs`) –
bez przekazywania IP do Google.

## Naruszenie ochrony danych – procedura

1. **Ustal i ogranicz** – co wyciekło / zostało zmienione, od kiedy, ilu osób dotyczy; odetnij przyczynę
   (zmiana sekretów w GitHub Secrets i na hostingu, unieważnienie sesji: `UPDATE sessions SET revoked_at = now()`).
2. **Oceń ryzyko** dla osób (dane o zdrowiu = zwykle wysokie).
3. **Zgłoś do Prezesa UODO w ciągu 72 h** od wykrycia (https://uodo.gov.pl – formularz zgłoszenia naruszenia),
   chyba że naruszenie jest mało prawdopodobne, by powodowało ryzyko.
4. **Zawiadom osoby** bez zbędnej zwłoki, gdy ryzyko jest wysokie (mail: co się stało, skutki, co zrobiliśmy, co mogą zrobić).
5. **Zapisz w rejestrze naruszeń** (poniżej) – także te niezgłaszane.

| Data | Opis | Liczba osób | Ryzyko | Zgłoszone do UODO | Działania |
| ---- | ---- | ----------- | ------ | ----------------- | --------- |
| –    | –    | –           | –      | –                 | –         |

## Ocena skutków (DPIA)

Przetwarzanie danych o zdrowiu na niewielką skalę, za wyraźną zgodą, bez profilowania o skutkach prawnych –
nie spełnia kryteriów obowiązkowej DPIA z wykazu UODO. Wrócić do oceny przy dużym wzroście liczby użytkowników
lub nowych funkcjach (np. integracje z urządzeniami, porady zdrowotne).
