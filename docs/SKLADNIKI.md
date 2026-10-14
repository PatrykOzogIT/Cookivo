# Rozbudowa bazy składników

Stan na 2026-10-14: **348** składników w katalogu (`backend/prisma/seed/ingredients.catalog.ts`),
wartości z USDA FoodData Central – SR Legacy (ok. 7 800 produktów, domena publiczna).
Cel: stopniowo, w paczkach po 50–80 pozycji, bez obniżania jakości danych.

## Zasady (bez wyjątków)

1. **Każdy składnik ma polską i angielską nazwę, kategorię, alergeny UE i typowe gramatury** (sztuka, łyżka, szklanka) – automatyczny import bez tego nie wchodzi.
   Brak oznaczonych alergenów wyglądałby jak „bezpieczny” – to obietnica aplikacji.
2. **Wartości na 100 g w standardzie etykiety UE** (1169/2011); `null` = brak danych, nigdy 0.
   Reguły spójności z `ingredients/nutrition.ts` muszą przejść (test `seed-data.spec.ts`).
3. **Tylko produkty, które realnie występują w przepisach** – bez dziesiątek wariantów tego samego
   („Beef, chuck, separable lean only, trimmed to 1/8"…). Jedna sensowna pozycja na produkt,
   kilka tylko tam, gdzie różnica ma znaczenie (np. twaróg chudy / półtłusty / tłusty).
4. **Źródło zapisane przy składniku** i pokazane w aplikacji (wymóg licencji CIQUAL, przejrzystość).
5. **Nie zgadujemy wartości.** Jeśli produktu nie ma w żadnym źródle, a odpowiednik nie jest
   naprawdę tym samym produktem – nie dodajemy go z katalogu (zostaje ścieżka: użytkownik dodaje,
   admin zatwierdza).

## Źródła

| Źródło                                         | Co daje                                                                                                      | Licencja                                                        | Uwagi                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **USDA FoodData Central – SR Legacy** (obecne) | ~7 800 produktów, surowce i podstawowe produkty                                                              | domena publiczna                                                | Węglowodany „by difference” – przeliczamy na UE (minus błonnik), sól = sód × 2,5 – robi to `tools/usda-extract.ts`                |
| **ANSES CIQUAL** (nowe, do dołączenia)         | ~3 500 produktów żywności europejskiej (sery, nabiał fermentowany, wędliny, pieczywo, mąki, produkty gotowe) | Licence Ouverte / Open Licence (Etalab) – wymaga podania źródła | Wartości już w formacie UE (energia wg 1169/2011, błonnik, sól, kwasy tłuszczowe nasycone). Do obsłużenia: „traces”, „< 0,5”, „-” |

Odrzucone: polskie tabele IŻŻ (prawa autorskie), Open Food Facts jako źródło katalogu (produkty
markowe, zmienna jakość – ewentualnie później do skanowania kodów kreskowych).

Atrybucja CIQUAL (karta składnika + strona „Jak to działa”/README):
„Anses. 2020. Table de composition nutritionnelle des aliments Ciqual” – wersja według pobranego pliku.

## Zmiany techniczne (jednorazowo, przed pierwszą paczką z CIQUAL)

- `IngredientSource`: dodać `CIQUAL` (migracja) i pole z identyfikatorem w źródle
  (kod USDA FDC / kod CIQUAL) – łatwiej aktualizować i sprawdzać.
- Katalog: pole `source` + `ref` zamiast samego `usda` (USDA zostaje domyślne – bez zmian w obecnych 348 pozycjach).
- `tools/ciqual-extract.ts` – jak `usda-extract.ts`: czyta plik CIQUAL (XML, bez nowych zależności
  w produkcji), dopisuje wartości do `ingredients.data.json`, ma tryb `--search "fromage blanc"`.
  Reguły: „-” → `null`, „traces” → 0, „< x” → `null` (nie znamy wartości).
- Karta składnika: „Źródło: USDA FoodData Central” / „Źródło: ANSES CIQUAL”.
- Wdrożenie już uruchamia idempotentny seed przy każdym pushu – nowe składniki pojawią się na
  cookivo.pl automatycznie, bez ruszania danych użytkowników.

## Paczki (kolejność według tego, co najczęściej brakuje w polskich przepisach)

| #   | Paczka                                          | Przykłady                                                                                                                                                                                                    | Źródło        | Szac. | Status       |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----- | ------------ |
| 1   | **Polska kuchnia – braki**                      | twaróg chudy / półtłusty / tłusty, serek wiejski, kabanosy, parówki, kiełbasa krakowska, szynka gotowana, makrela wędzona, śledź w oleju, mąka gryczana / orkiszowa / razowa, napój owsiany / sojowy, tahini | CIQUAL + USDA | ~60   | do zrobienia |
| 2   | Nabiał i sery                                   | jogurt naturalny 2% / grecki 10%, skyr, ricotta, mascarpone, camembert, ser kozi, gouda, edamski, ser topiony, śmietanka 30% / 36%                                                                           | CIQUAL        | ~40   |              |
| 3   | Ryby, owoce morza, jaja                         | dorsz, mintaj, pstrąg, tilapia, sardynki w puszce, tuńczyk w sosie własnym, krewetki, kalmary, jaja przepiórcze                                                                                              | USDA          | ~40   |              |
| 4   | Pieczywo, mąki, kasze, makarony                 | chleb żytni razowy / orkiszowy / pszenny, bułka kajzerka, tortilla, pita, płatki jaglane / gryczane, makaron pełnoziarnisty / ryżowy, mąka ryżowa / kukurydziana / migdałowa                                 | CIQUAL + USDA | ~50   |              |
| 5   | Grzyby, warzywa, owoce – uzupełnienie           | borowik, kurki, boczniak, shiitake, topinambur, pasternak, kalarepa, rabarbar, agrest, porzeczki, mrożonki (mieszanka warzyw), owoce suszone                                                                 | USDA + CIQUAL | ~60   |              |
| 6   | Strączki, orzechy, nasiona, roślinne zamienniki | fasola mung, edamame, tempeh, seitan, masło orzechowe, chia, siemię lniane, pestki dyni, napój kokosowy, jogurt sojowy                                                                                       | USDA + CIQUAL | ~40   |              |
| 7   | Przyprawy, sosy, słodycze, napoje               | majeranek suszony, lubczyk, przyprawa do piernika, sos pomidorowy, pesto, ajwar, miód gryczany, dżem niskosłodzony, gorzka czekolada 70%, kakao, kawa, herbata, sok pomarańczowy                             | USDA + CIQUAL | ~60   |              |

Łącznie ok. **350 nowych** → baza ~700 składników. Dalej według zgłoszeń użytkowników
(najczęściej dodawane własne składniki = kandydaci do katalogu).

## Jak wygląda jedna paczka

1. **Lista kandydatów** (Claude): nazwy PL/EN, kategoria, źródło i dopasowana pozycja ze źródła.
2. **Akceptacja listy** (Ty): skreślasz, dopisujesz – 5 minut, bez wartości liczbowych.
3. **Opracowanie** (Claude): wartości ze źródła, alergeny UE, gramatury jednostek, gęstość płynów.
4. **Kontrola**: `seed-data.spec.ts` (spójność, duplikaty nazw, reguły wartości), seed na lokalnej bazie,
   wyrywkowo 10 pozycji porównanych z etykietami produktów z polskiego sklepu.
5. **Commit + push** → wdrożenie wgrywa składniki na cookivo.pl (seed idempotentny).
6. Aktualizacja tabeli statusu powyżej.
