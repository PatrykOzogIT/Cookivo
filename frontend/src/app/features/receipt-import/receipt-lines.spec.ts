import type { ReceiptDraftLine } from './receipt-import.api';
import { fromDraft, lineProblems, lineTotalCents, summarize, toCommitLine } from './receipt-lines';

const milk = {
  id: 'm',
  namePl: 'Mleko 3,2%',
  nameEn: 'Milk',
  density: 1.03,
  units: [],
  category: { icon: 'egg' },
};

const draft = (over: Partial<ReceiptDraftLine> = {}): ReceiptDraftLine => ({
  key: 0,
  text: 'MLEKO UHT 3,2% 1L 2 x 4,29',
  name: 'mleko 3,2%',
  status: 'MATCHED',
  ingredient: milk,
  suggestions: [],
  packages: 2,
  packageAmount: 1,
  packageUnitCode: 'l',
  priceCents: 429,
  lineTotalCents: 858,
  uncertain: false,
  warnings: [],
  ...over,
});

describe('pozycje paragonu w podglądzie', () => {
  it('liczby z polskim przecinkiem, oba cele domyślnie zaznaczone', () => {
    expect(fromDraft(draft({ packages: 0.734, packageUnitCode: 'kg', priceCents: 999 }), 'pl')).toMatchObject(
      {
        packages: '0,734',
        price: '9,99',
        toPantry: true,
        toPrices: true,
      },
    );
    expect(fromDraft(draft(), 'en').price).toBe('4.29');
  });

  it('braki zależą od celów: cena tylko dla cennika, pozycja bez celu niczego nie wymaga', () => {
    const noPrice = { ...fromDraft(draft({ priceCents: null }), 'pl') };
    expect(lineProblems(noPrice, true, true)).toEqual(['PRICE']);
    expect(lineProblems(noPrice, true, false)).toEqual([]);
    expect(lineProblems({ ...noPrice, toPantry: false, toPrices: false }, true, true)).toEqual([]);
    const unknown = fromDraft(draft({ ingredient: null, packageAmount: null, packageUnitCode: null }), 'pl');
    expect(lineProblems({ ...unknown, packages: 'abc' }, true, false)).toEqual([
      'NO_INGREDIENT',
      'PACKAGES',
      'PACKAGE',
    ]);
  });

  it('wartość pozycji i podsumowanie', () => {
    const a = fromDraft(draft(), 'pl');
    const b = {
      ...fromDraft(draft({ key: 1, priceCents: null, warnings: ['NO_PRICE'] }), 'pl'),
      toPantry: false,
    };
    expect(lineTotalCents(a)).toBe(858);
    expect(lineTotalCents(b)).toBeNull();
    expect(summarize([a, b], true, true)).toEqual({
      lines: 2,
      pantry: 1,
      prices: 2,
      attention: 1,
      totalCents: 858,
    });
    // Cennik odznaczony - nic do cennika
    expect(summarize([a, b], true, false)).toMatchObject({ pantry: 1, prices: 0 });
  });

  it('do zatwierdzenia: liczby i cele, cena tylko przy cenniku', () => {
    const line = { ...fromDraft(draft(), 'pl'), price: '4,29' };
    expect(toCommitLine(line, true, true)).toEqual({
      ingredientId: 'm',
      toPantry: true,
      toPrices: true,
      packages: 2,
      packageAmount: 1,
      packageUnitCode: 'l',
      price: 4.29,
    });
    expect(toCommitLine({ ...line, toPrices: false }, true, true)).toMatchObject({
      toPrices: false,
      price: null,
    });
  });
});
