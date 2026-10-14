# Rozbudowa bazy składników

Stan na 2026-10-14: **557** składników – 347 z USDA FoodData Central SR Legacy (`backend/prisma/seed/ingredients.catalog.ts`)

- 210 z ANSES Ciqual 2025 (`backend/prisma/seed/ingredients.ciqual.ts`).
  Cel: duże paczki tematyczne, bez obniżania jakości danych.

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
  Reguły: „-” → `null`, „traces” i „< x” → 0 (poniżej progu oznaczalności), przecinek dziesiętny.
  Produkt bez kcal, białka, tłuszczu lub węglowodanów w źródle nie wchodzi do katalogu.
- Karta składnika: „Źródło: USDA FoodData Central” / „Źródło: ANSES CIQUAL”.
- Wdrożenie już uruchamia idempotentny seed przy każdym pushu – nowe składniki pojawią się na
  cookivo.pl automatycznie, bez ruszania danych użytkowników.

## Paczki

| #   | Paczka                                                  | Przykłady                                                                                                                                                                                  | Źródło | Liczba | Status    |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ | --------- |
| 1   | **Polska kuchnia – braki**                              | twaróg, serek homogenizowany, mascarpone, napoje roślinne, podroby, królik, halibut, makrela wędzona, mąki, polenta, otręby, pita, tahini – [skladniki-paczka-1.md](skladniki-paczka-1.md) | CIQUAL | 28     | ✅ dodane |
| 2   | **Warzywa, strączki, grzyby, owoce, orzechy**           | ziemniaki młode, topinambur, brukiew, dynia hokkaido, roszponka, rukiew, szczaw, kiełki, borowik, uszaki, groch łuskany, łubin, bób, liczi, kaki, pomelo, kasztany, mak                    | CIQUAL | 53     | ✅ dodane |
| 3   | **Zboża, mąki, jaja, mięso, ryby i owoce morza**        | orkisz, ryż basmati / dziki / czerwony, amarantus, kasza gryczana niepalona, mąka z ciecierzycy, jaja kacze, antrykot, ozór, dziczyzna, kaczka, sandacz, leszcz, przegrzebki, raki         | CIQUAL | 76     | ✅ dodane |
| 4   | **Nabiał i sery, tłuszcze, zioła i przyprawy, dodatki** | twaróg tłusty, mleko kozie, burrata, pecorino, grana padano, gorgonzola, olej lniany, masło solone, świeże zioła, szafran, sól selerowa, sos rybny, nori, płatki drożdżowe                 | CIQUAL | 53     | ✅ dodane |
| 5   | Wyroby o zmiennym składzie                              | pasztet, parówki, salami, kabanosy, sosy gotowe, miso, musztardy – alergeny zależą od producenta, wymagają weryfikacji albo oznaczenia „sprawdź etykietę”                                  | CIQUAL | ~40    |           |
| 6   | Braki spoza Ciqual                                      | golonka, mąka owsiana, mąka migdałowa, tempeh, seitan, edamame                                                                                                                             | USDA   | ~20    |           |

Odrzucone przy przeglądzie: produkty, dla których Ciqual nie podaje energii lub makroskładników
(np. skórka cytryny, kumkwat, morwa, czarny bez, laska wanilii, agar, syrop z agawy, olej rydzowy),
regionalne odmiany (Martynika, Reunion), dania i produkty przetworzone, oraz pozycje dublujące
katalog USDA (sprawdzane po fragmentach nazw i testem unikalności).

Dalej według zgłoszeń użytkowników
(najczęściej dodawane własne składniki = kandydaci do katalogu).

## Jak wygląda jedna paczka

1. **Lista kandydatów** (Claude): nazwy PL/EN, kategoria, źródło i dopasowana pozycja ze źródła.
2. **Akceptacja listy** (Ty): skreślasz, dopisujesz – 5 minut, bez wartości liczbowych.
3. **Opracowanie** (Claude): wartości ze źródła, alergeny UE, gramatury jednostek, gęstość płynów.
4. **Kontrola**: `seed-data.spec.ts` (spójność, duplikaty nazw, reguły wartości), seed na lokalnej bazie,
   wyrywkowo 10 pozycji porównanych z etykietami produktów z polskiego sklepu.
5. **Commit + push** → wdrożenie wgrywa składniki na cookivo.pl (seed idempotentny).
6. Aktualizacja tabeli statusu powyżej.
