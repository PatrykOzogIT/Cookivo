# Biblioteka przepisów (import z Wikibooks)

Startowa biblioteka publicznych przepisów pochodzi z polskich i angielskich Wikibooks (książka kucharska, licencja **CC BY-SA 4.0**). Zdjęcia z Wikimedia Commons, tylko na wolnych licencjach (CC0, domena publiczna, CC BY, CC BY-SA), z autorem i licencją. Zdjęć nie generujemy: przepis bez zdjęcia z wolną licencją zostaje bez zdjęcia.

## Jak to wygląda w aplikacji

- Właściciel techniczny: konto **Cookivo** (`przepisy@cookivo.pl`; nazwa zastrzeżona przy rejestracji; nie da się na nie zalogować). Pochodzenie każdego przepisu jest w `recipe_sources`: strona, wersja (`revision_id`), historia zmian (autorzy), licencja, zmiany względem oryginału (`changes`), wersja zbioru.
- Strona przepisu pokazuje sekcję „Źródło i licencja” z linkami do strony, historii zmian i licencji. Pokazuje też informację o tłumaczeniu (gdy czytelnik ma inny język niż źródło), o uporządkowaniu treści, przeliczeniu miar i umownych ilościach „do smaku”. Pod zdjęciem jest jego autor i licencja z linkiem do pliku na Commons.
- „Zrób własną wersję” daje utwór zależny: wersja pokazuje źródło oryginału z dopiskiem „Zmieniony przez autora tej wersji” (ShareAlike).
- Treść jest w dwóch językach. Pola przepisu są po polsku, a `recipe_translations` (`locale`) przechowuje angielski tytuł, opis, kroki oraz grupy i dopiski składników w tej samej kolejności. API: `GET /api/recipes/:id?lang=en`, lista z `lang`. Bez `lang` dostajesz treść zapisaną, której używa formularz. Wyszukiwanie działa po obu językach (`search_text`). Kolejny język to kolejne wiersze `recipe_translations`.
- Edycja przepisu w formularzu usuwa jego tłumaczenia, bo byłyby nieaktualne.
- Wartości odżywcze liczy `RecipeCalculatorService` ze składników z bazy. Niczego nie zgadujemy.

## Proces (`backend/prisma/recipes-import/`)

| Krok                     | Polecenie (w `backend/`)                                                                                                                                                                                                                                                                                                                               | Koszt                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| 1. Strony                | `npm run recipes:fetch -- pages`: lista stron obu Wikibooks i ich treść (do `out/`). Prosta kontrola bez AI: lista składników z ilościami i opis wykonania.                                                                                                                                                                                            | 0                      |
| 2. Wyświetlenia          | `npm run recipes:fetch -- views`: wyświetlenia z 12 miesięcy, tylko dla kompletnych stron                                                                                                                                                                                                                                                              | 0                      |
| 3. Składniki z produkcji | `npm run recipes:fetch -- snapshot`: zatwierdzone składniki i tytuły przepisów z cookivo.pl (publiczne API)                                                                                                                                                                                                                                            | 0                      |
| 4. Odczyt                | `npm run recipes:ai -- structure submit --pl N --en M`, potem `structure fetch`. Haiku przez Batch API. Bierze kolejne nieprzetworzone strony: polskie, potem angielskie wg wyświetleń.                                                                                                                                                                | ~0,0015 USD / strona   |
| 5. Składanie             | `npm run recipes:build -- --target 1000 --cap 0.15`: kontrola jakości, miary, dopasowanie składników, duble, limity kategorii, raporty                                                                                                                                                                                                                 | 0                      |
| 6. Tłumaczenia           | `npm run recipes:ai -- translate submit`, potem `translate fetch`. Sonnet przez Batch API: PL→EN i EN→PL.                                                                                                                                                                                                                                              | ~0,0075 USD / przepis  |
| 6a. Miary                | `npx tsx prisma/recipes-import/units.ts submit`, potem `fetch`: szacunek wag łyżki, łyżeczki, szklanki, szczypty i sztuki dla składników z przepisów czekających na miarę (Haiku, Batch API, te same zakresy co w aplikacji). Wynik w `unit-estimates.json`; `build` i importer z niego korzystają (importer zapisuje miary w bazie jako szacunek AI). | ~0,0001 USD / składnik |
| 7. Zdjęcia               | `npm run recipes:photos -- meta`: licencje z Commons, wymiary; potem znowu krok 5                                                                                                                                                                                                                                                                      | 0                      |
| 8. Import                | workflow **Import przepisów** (produkcja: dry-run → import; dry-run cofa wszystkie zapisy). Import najpierw wgrywa zdjęcia przez FTP (`vars.FTP_UPLOADS_DIR`).                                                                                                                                                                                         | 0                      |

Wyniki AI są w cache w repozytorium (`ai-structure-cache.json`, `ai-translate-cache.json`, `photo-cache.json`), więc ponowne uruchomienie nie płaci drugi raz.

### Kontrola jakości

- AI (Haiku) tylko porządkuje treść: składniki (linia ze strony, ilość, jednostka ze strony, nazwa PL, nazwa z listy składników Cookivo) i kroki. Niczego nie dopisuje.
- Kod sprawdza odczyt z tekstem strony. Każda ilość musi być w swojej linii (`amountInText`), a słowa linii składników i kroków muszą pochodzić ze strony (`overlap`). Inaczej przepis jest odrzucany (`AMOUNT_NOT_IN_SOURCE`, `LINE_NOT_IN_SOURCE`, `STEP_NOT_IN_SOURCE`).
- Odrzucane są też: problemy zgłoszone przez model (brak ilości lub kroków, przepis urwany, napój alkoholowy, nie jedzenie, metoda niebezpieczna), mniej niż 2 składniki, brak porcji, za długie pola.
- Miary: kg i l zostają, dag, mg, dl i cl przeliczamy dokładnie na g i ml. Amerykańskie zaokrąglamy (oz, lb, stick, fl oz, pint), a cup zamieniamy na szklankę. Przepis dostaje wtedy zmianę `UNITS_CONVERTED`.
- Bez ilości przechodzą tylko przyprawy „do smaku” (szczypta albo 1 g) i tłuszcz do smażenia (łyżka albo 10 g). Przepis dostaje zmianę `TO_TASTE`. Każdy inny brak ilości odrzuca przepis.
- Porcje: gdy strona ich nie podaje, model je szacuje (`servingsEstimated`).
- Duble: ten sam rodzaj dania i zestaw składników podobny w ≥ 85% (także między językami), ten sam polski tytuł albo tytuł istniejącego przepisu publicznego. Zostaje ważniejszy przepis: z poprzedniego pliku importu, potem polski, potem z większą liczbą wyświetleń.

### Rejestr (`catalog.jsonl`)

Rejestr obejmuje wszystkie strony obu Wikibooks, także odrzucone. Dzięki temu kolejne uruchomienia wiedzą, co już było.

- Strona: `NEW` (nieprzetworzona), `INCOMPLETE` (odpadła w prostej kontroli; `reason`), `REJECTED` (to nie przepis), `PROCESSED`.
- Przepis ze strony (`recipes`; jedna strona może mieć kilka przepisów, klucz `…#2`): `READY` (w pliku importu), `WAITING_INGREDIENT` / `WAITING_UNIT` (`missing`), `WAITING_TRANSLATION`, `DUPLICATE` (`duplicateOf`), `REJECTED` (`reason`), `OVER_LIMIT` (poprawny, nie zmieścił się w limicie).
- Importer jest idempotentny po `recipe_sources.external_id` (`wikibooks-pl:<pageid>#<n>`). Przepisy z pliku importu zostają w nim przy każdym `build`.

**Następna paczka:** `structure submit --pl 0 --en 300` → `structure fetch` → `build --target 1300` → `translate submit/fetch` → `photos meta` → `build --target 1300` → workflow.

**Czekające na składnik:** lista jest w `raport/brakujace-skladniki.csv` i `raport/brakujace-jednostki.csv` (jednostka albo gęstość). Po dodaniu składnika na produkcji wystarczy `fetch snapshot` i `build`: przepis wraca bez ponownego płacenia za AI, potrzebne jest tylko tłumaczenie.

### Raporty (`raport/`)

`podsumowanie.json`, `odrzucone.csv`, `duble.csv`, `brakujace-skladniki.csv`, `brakujace-jednostki.csv`, `bez-zdjec.csv` oraz `atrybucje.csv` (eksport licencji: przepis, źródło, historia, licencja, zdjęcie, autor, licencja zdjęcia).

### Cofnięcie

Workflow w trybie `undo-dry-run` / `undo` usuwa przepisy z biblioteki, których nikt nie używa: bez ocen, planów, wersji, zgłoszeń i użycia jako składnik. Pliki zdjęć na serwerze zostają.
