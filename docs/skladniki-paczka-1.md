# Paczka 1 – polska kuchnia: braki

> **Status: dodane 28 pozycji** (`backend/prisma/seed/ingredients.ciqual.ts`).
> Z listy poniżej wypadło 8:
>
> - **już były w katalogu USDA** (test unikalności nazw): karp, morszczuk (jest „Morszczuk / łupacz”),
>   boczek surowy, udo z indyka (jest „Udziec z indyka”);
> - **przeniesione do paczki wyrobów o zmiennym składzie** (alergeny zależą od producenta): pasztet,
>   parówki wieprzowe, parówki drobiowe, salami.

Sprawdzone z katalogiem (348 pozycji).
Dopasowania sprawdzone w **ANSES Ciqual 2025** (Licence Ouverte 2.0) – kod produktu w nawiasie,
wartości na 100 g wg źródła. Alergeny: propozycja wg 14 alergenów UE.

## ✅ Mają pewny odpowiednik w Ciqual (36)

| #   | Nazwa PL                       | Ciqual (kod)                                           | kcal | B    | W    | T    | Alergeny       |
| --- | ------------------------------ | ------------------------------------------------------ | ---- | ---- | ---- | ---- | -------------- |
| 1   | Twaróg chudy                   | Quark, plain, 0% fat (19644)                           | 48   | 7,3  | 4,2  | <0,1 | mleko          |
| 2   | Twaróg półtłusty               | Quark, plain, 2-3% fat (19646)                         | 76   | 7,3  | 3,9  | 3,2  | mleko          |
| 3   | Serek homogenizowany naturalny | Fresh cream cheese, petit-suisse type, ~4% fat (19664) | 88   | 9,7  | 3,1  | 3,9  | mleko          |
| 4   | Serek do smarowania naturalny  | Uncured soft cheese, spreadable, plain (12068)         | 225  | 6,3  | 3,3  | 20,7 | mleko          |
| 5   | Mascarpone                     | Mascarpone cheese (19584)                              | 369  | 6,0  | 3,1  | 37   | mleko          |
| 6   | Ser topiony w plastrach        | Processed cheese, in slices (12300)                    | 246  | 14,1 | 5,3  | 18,5 | mleko          |
| 7   | Śmietana 30% gęsta             | Cream 30% fat, thick (19410)                           | 285  | 2,3  | 1,4  | 29,9 | mleko          |
| 8   | Napój owsiany niesłodzony      | Oat drink, plain, no added sugar (18899)               | 41   | 0,3  | 7,8  | 1,1  | gluten         |
| 9   | Napój sojowy niesłodzony       | Soy drink, plain, not fortified (18900)                | 42   | 3,2  | 1,9  | 2,1  | soja           |
| 10  | Jogurt sojowy naturalny        | Soy dessert, plain, no added sugars, fermented (19693) | 45   | 3,8  | 2,1  | 1,9  | soja           |
| 11  | Parówki wieprzowe              | Strasbourg sausage / knack (30742)                     | 291  | 12,4 | 1,4  | 25,9 | –              |
| 12  | Parówki drobiowe               | Poultry sausage, knack-style (30131)                   | 236  | 14,0 | 1,8  | 18,9 | –              |
| 13  | Salami                         | Salami (30350)                                         | 457  | 17,7 | 2,6  | 41,8 | –              |
| 14  | Pasztet wieprzowy              | Pork liver pâté (8305)                                 | 355  | 10,8 | 2,9  | 33,3 | do sprawdzenia |
| 15  | Boczek surowy (solony)         | Pork belly, cured, plain, raw (28507)                  | 288  | 15,7 | 0,8  | 24,7 | –              |
| 16  | Wątróbka wieprzowa             | Liver, pork, raw (40119)                               | 124  | 20,6 | 1,1  | 4,2  | –              |
| 17  | Kurczak – tuszka ze skórą      | Chicken, meat and skin, raw (36016)                    | 173  | 21,5 | 0,3  | 9,5  | –              |
| 18  | Żołądki drobiowe               | Gizzard, chicken, raw (40700)                          | 99   | 16,8 | 0    | 3,5  | –              |
| 19  | Serca drobiowe                 | Heart, chicken, raw (40054)                            | 149  | 15,6 | 0,7  | 9,3  | –              |
| 20  | Udo z indyka (ze skórą)        | Turkey, leg, meat and skin, raw (36305)                | 149  | 19,7 | 0    | 7,9  | –              |
| 21  | Królik                         | Rabbit, meat, raw (34001)                              | 188  | 20,4 | 0,6  | 11,6 | –              |
| 22  | Karp                           | Carp, raw, farmed (27003)                              | 114  | 17,7 | 0    | 4,8  | ryby           |
| 23  | Morszczuk                      | European hake, raw (26044)                             | 83   | 17,6 | 0    | 1,4  | ryby           |
| 24  | Halibut                        | Atlantic halibut, raw (26009)                          | 97   | 21,2 | 0    | 1,3  | ryby           |
| 25  | Makrela wędzona                | Mackerel, smoked (26087)                               | 289  | 19,8 | 0,9  | 22,9 | ryby           |
| 26  | Mąka gryczana                  | Buckwheat flour (9540)                                 | 348  | 11,5 | 68,4 | 2,2  | –              |
| 27  | Mąka orkiszowa                 | Spelt flour (9480)                                     | 352  | 11,4 | 64   | 3,0  | gluten         |
| 28  | Mąka ryżowa                    | Rice flour (9520)                                      | 357  | 7,6  | 73,9 | 2,5  | –              |
| 29  | Mąka jaglana                   | Millet flour (9555)                                    | 350  | 10,2 | 63,2 | 4,1  | –              |
| 30  | Kasza kukurydziana (polenta)   | Polenta, pre-cooked, raw (9614)                        | 350  | 7,9  | 74   | 1,8  | –              |
| 31  | Otręby owsiane                 | Oat bran (9640)                                        | 361  | 16,8 | 50,6 | 6,5  | gluten         |
| 32  | Otręby pszenne                 | Wheat bran (9621)                                      | 270  | 14,8 | 22,7 | 3,9  | gluten         |
| 33  | Pita                           | Bread, pita (7180)                                     | 249  | 7,5  | 48,8 | 1,5  | gluten         |
| 34  | Tahini (pasta sezamowa)        | Tahini (15203)                                         | 631  | 17,7 | 13,8 | 53,4 | sezam          |
| 35  | Buraki gotowane                | Beetroot, cooked (20003)                               | 42   | 1,4  | 7,1  | 0,4  | –              |
| 36  | Jajka przepiórcze              | Quail egg, raw (22050)                                 | 154  | 13,1 | 0,4  | 11,1 | jaja           |

## ⚠️ Brak w Ciqual – można uzupełnić z USDA (wymaga pobrania pliku USDA, 6,1 MB)

| Nazwa PL          | Uwagi                                      |
| ----------------- | ------------------------------------------ |
| Golonka wieprzowa | USDA: pork hock                            |
| Mąka owsiana      | USDA: oat flour                            |
| Mąka migdałowa    | do sprawdzenia w USDA                      |
| Napój kokosowy    | prawdopodobnie brak także w USDA SR Legacy |

## ❌ Bez pewnego odpowiednika – proponuję pominąć (dodają użytkownicy)

| Nazwa PL                                     | Dlaczego                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Twaróg tłusty                                | dodany w paczce 4 (Ciqual 19711, twaróg 7-8% tłuszczu)                           |
| Śmietana 12% / 18% kwaśna                    | Ciqual ma kwaśną gęstą tylko 30% (18% już jest w katalogu z USDA)                |
| Serek homogenizowany waniliowy               | brak                                                                             |
| Szprotki wędzone                             | Ciqual ma tylko surowe                                                           |
| Śledź w oleju                                | Ciqual: śledź **wędzony** w oleju – inny produkt niż polski śledź solony w oleju |
| Płatki żytnie, chleb orkiszowy               | brak                                                                             |
| Kabanosy, kiełbasa krakowska sucha           | saucisson sec to inny produkt                                                    |
| Polędwica sopocka, grahamka, ćwikła, powidła | brak pewnego odpowiednika                                                        |
