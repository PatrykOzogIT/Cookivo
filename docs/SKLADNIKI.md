# Rozbudowa bazy składników

Stan na 2026-10-14: **375** składników (347 z USDA + 28 z Ciqual) w katalogu (`backend/prisma/seed/ingredients.catalog.ts`),
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

| Źródło                                         | Co daje                                                                                                    | Licencja                                                                                                                             | Uwagi                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **USDA FoodData Central – SR Legacy** (obecne) | ~7 800 produktów, surowce i podstawowe produkty                                                            | domena publiczna                                                                                                                     | Węglowodany „by difference” – przeliczamy na UE (minus błonnik), sól = sód × 2,5 – robi to `tools/usda-extract.ts`                |
| **ANSES CIQUAL 2025** (nowe, do dołączenia)    | 3 484 produkty żywności europejskiej (sery, nabiał fermentowany, wędliny, pieczywo, mąki, produkty gotowe) | **Licence Ouverte 2.0 (Etalab)** – zgodna z CC BY 2.0; wymaga podania źródła i daty ostatniej aktualizacji (potwierdzone 2026-10-14) | Wartości już w formacie UE (energia wg 1169/2011, błonnik, sól, kwasy tłuszczowe nasycone). Do obsłużenia: „traces”, „< 0,5”, „-” |

Odrzucone: polskie tabele IŻŻ (prawa autorskie), Open Food Facts jako źródło katalogu (produkty
markowe, zmienna jakość – ewentualnie później do skanowania kodów kreskowych).

Atrybucja CIQUAL (karta składnika + strona „Jak to działa”/README):
„Anses. 2025. Table de composition nutritionnelle des aliments Ciqual” + data aktualizacji pobranego pliku, z odnośnikiem do źródła i licencji Licence Ouverte 2.0.

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

| #   | Paczka                                          | Przykłady                                                                                                                                                                                                                          | Źródło        | Szac. | Status    |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----- | --------- |
| 1   | **Polska kuchnia – braki**                      | twaróg, serek homogenizowany, mascarpone, napoje roślinne, podroby, królik, halibut, makrela wędzona, mąki gryczana / orkiszowa / ryżowa / jaglana, polenta, otręby, pita, tahini – [skladniki-paczka-1.md](skladniki-paczka-1.md) | CIQUAL        | 28    | ✅ dodane |
| 2   | Nabiał i sery – uzupełnienie                    | kefir / maślanka smakowe, halloumi, ser kozi twardy, pecorino, jogurt pitny, serek naturalny do smarowania                                                                                                                         | CIQUAL        | ~30   |           |
| 3   | Ryby, owoce morza, jaja                         | sola, okoń, sandacz, flądra, małże, ośmiornica, ikra, jaja kacze                                                                                                                                                                   | USDA + CIQUAL | ~30   |           |
| 4   | Pieczywo, kasze, makarony                       | chleb bezglutenowy, kasza orkiszowa, amarantus, makaron gryczany / z soczewicy, gnocchi, ryż jaśminowy / basmati / dziki                                                                                                           | CIQUAL + USDA | ~40   |           |
| 5   | Grzyby, warzywa, owoce – uzupełnienie           | borowik, boczniak, shiitake, topinambur, pasternak, kalarepa, rabarbar, agrest, porzeczki, mrożonki, owoce suszone                                                                                                                 | USDA + CIQUAL | ~60   |           |
| 6   | Strączki, orzechy, nasiona, roślinne zamienniki | fasola mung, edamame, tempeh, seitan, chia, siemię lniane                                                                                                                                                                          | USDA + CIQUAL | ~35   |           |
| 7   | Przyprawy, sosy, słodycze, napoje               | lubczyk, przyprawa do piernika, pesto, ajwar, tzatziki, syrop klonowy, dżem niskosłodzony, kompot, kwas chlebowy                                                                                                                   | USDA + CIQUAL | ~60   |           |

Łącznie ok. **300 nowych** → baza ~650 składników (przed każdą paczką lista jest sprawdzana z katalogiem, żeby nie dublować pozycji). Dalej według zgłoszeń użytkowników
(najczęściej dodawane własne składniki = kandydaci do katalogu).

## Jak wygląda jedna paczka

1. **Lista kandydatów** (Claude): nazwy PL/EN, kategoria, źródło i dopasowana pozycja ze źródła.
2. **Akceptacja listy** (Ty): skreślasz, dopisujesz – 5 minut, bez wartości liczbowych.
3. **Opracowanie** (Claude): wartości ze źródła, alergeny UE, gramatury jednostek, gęstość płynów.
4. **Kontrola**: `seed-data.spec.ts` (spójność, duplikaty nazw, reguły wartości), seed na lokalnej bazie,
   wyrywkowo 10 pozycji porównanych z etykietami produktów z polskiego sklepu.
5. **Commit + push** → wdrożenie wgrywa składniki na cookivo.pl (seed idempotentny).
6. Aktualizacja tabeli statusu powyżej.
