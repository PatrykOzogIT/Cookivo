import { FormControl, FormGroup } from '@angular/forms';
import { formatNumber, parseDecimal } from '../../core/i18n/format.pipes';
import {
  decimalValidator,
  estimateKcal,
  kcalMismatch,
  nutritionGroupValidator,
} from './form/nutrition-validators';
import type { Ingredient, Unit } from './ingredients.models';
import { portionGrams, portionUnits } from './portion';

describe('parseDecimal / formatNumber', () => {
  it('przyjmuje przecinek i kropkę', () => {
    expect(parseDecimal('4,7')).toBe(4.7);
    expect(parseDecimal('4.7')).toBe(4.7);
    expect(parseDecimal(' 1 250,5 ')).toBe(1250.5);
    expect(parseDecimal(',5')).toBe(0.5);
  });

  it('puste pole to brak danych, śmieci to NaN', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('4,7g')).toBeNaN();
  });

  it('formatuje zgodnie z językiem, null jako "—"', () => {
    expect(formatNumber(4.75, 'pl', 1)).toBe('4,8');
    expect(formatNumber(4.75, 'en', 1)).toBe('4.8');
    expect(formatNumber(null, 'pl')).toBe('—');
  });
});

describe('walidatory formularza składnika', () => {
  const group = (values: Record<string, string>) =>
    new FormGroup(
      Object.fromEntries(
        ['kcal', 'protein', 'fat', 'saturatedFat', 'carbs', 'sugars', 'fiber', 'salt'].map((k) => [
          k,
          new FormControl(values[k] ?? ''),
        ]),
      ),
      { validators: nutritionGroupValidator },
    );

  it('decimalValidator sprawdza format i zakres', () => {
    const v = decimalValidator(0, 100);
    expect(v(new FormControl('4,7'))).toBeNull();
    expect(v(new FormControl(''))).toBeNull();
    expect(v(new FormControl('x'))).toEqual({ decimal: true });
    expect(v(new FormControl('101'))).toEqual({ range: { min: 0, max: 100 } });
  });

  it('akceptuje spójne wartości', () => {
    expect(
      group({ protein: '18,7', fat: '4,7', saturatedFat: '2,9', carbs: '3,7', sugars: '3,7' }).errors,
    ).toBeNull();
  });

  it('wykrywa te same niespójności co backend', () => {
    expect(group({ protein: '60', fat: '50' }).errors).toEqual({ NUTRITION_OVER_100G: true });
    expect(group({ fat: '4', saturatedFat: '5' }).errors).toEqual({ NUTRITION_SATFAT_GT_FAT: true });
    expect(group({ carbs: '3,7', sugars: '5' }).errors).toEqual({ NUTRITION_SUGARS_GT_CARBS: true });
  });

  it('ostrzega o kaloriach niepasujących do makro, toleruje drobne różnice', () => {
    const estimated = estimateKcal(18.7, 4.7, 3.7, 0);
    expect(Math.round(estimated)).toBe(132);
    expect(kcalMismatch(133, estimated)).toBe(false);
    expect(kcalMismatch(300, estimated)).toBe(true);
    expect(kcalMismatch(15, 5)).toBe(false); // mała różnica bezwzględna przy niskich wartościach
  });
});

describe('kalkulator porcji', () => {
  const dictionary: Unit[] = [
    { code: 'PIECE', namePl: 'sztuka', nameEn: 'piece', ml: null },
    { code: 'TABLESPOON', namePl: 'łyżka', nameEn: 'tablespoon', ml: 15 },
    { code: 'GLASS', namePl: 'szklanka', nameEn: 'glass', ml: 250 },
  ];
  const ingredient = (partial: Partial<Ingredient>) =>
    ({ units: [], density: null, ...partial }) as unknown as Ingredient;

  it('dla ciała stałego: gramy + jednostki składnika', () => {
    const units = portionUnits(
      ingredient({ units: [{ code: 'PIECE', namePl: 'sztuka', grams: 50 }] }),
      dictionary,
    );
    expect(units.map((u) => u.code)).toEqual(['g', 'PIECE']);
    expect(portionGrams(2, units[1])).toBe(100);
  });

  it('dla płynu: ml i jednostki objętościowe wyliczone z gęstości', () => {
    const milk = ingredient({ density: 1.03 });
    const units = portionUnits(milk, dictionary);
    expect(units.map((u) => u.code)).toEqual(['g', 'ml', 'TABLESPOON', 'GLASS']);
    expect(
      portionGrams(
        1,
        units.find((u) => u.code === 'GLASS'),
      ),
    ).toBe(257.5);
  });

  it('jednostka zdefiniowana przy składniku ma pierwszeństwo przed gęstością', () => {
    const honey = ingredient({ density: 1.42, units: [{ code: 'TABLESPOON', namePl: 'łyżka', grams: 21 }] });
    const spoon = portionUnits(honey, dictionary).filter((u) => u.code === 'TABLESPOON');
    expect(spoon).toHaveLength(1);
    expect(spoon[0].gramsPerUnit).toBe(21);
  });

  it('niepoprawna ilość nie daje porcji', () => {
    const [grams] = portionUnits(ingredient({}), dictionary);
    expect(portionGrams(0, grams)).toBeNull();
    expect(portionGrams(Number.NaN, grams)).toBeNull();
  });
});
