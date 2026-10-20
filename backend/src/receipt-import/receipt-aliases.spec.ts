import { pickDefault, storeKey, textKey } from './receipt-aliases.js';

describe('powiązania tekst z paragonu → składnik', () => {
  it('klucz sieci: pierwsze słowo nazwy', () => {
    expect(storeKey('Biedronka')).toBe('biedronka');
    expect(storeKey('BIEDRONKA "CODZIENNIE NISKIE CENY" 3360')).toBe('biedronka');
    expect(storeKey('Lidl sp. z o.o.')).toBe('lidl');
    expect(storeKey('Żabka')).toBe('zabka');
    expect(storeKey(null)).toBe('');
  });

  it('klucz tekstu: drobne różnice odczytu dają ten sam klucz', () => {
    expect(textKey('MlekoŚw3,2 1l')).toBe('mlekosw321l');
    expect(textKey('Mleko Sw 3,2 1L')).toBe('mlekosw321l');
    expect(textKey('MasłExtraMlDol200g')).toBe('maslextramldol200g');
  });

  it('domyślne: większość głosów; pewne od 3 głosów i 70%', () => {
    expect(pickDefault([{ ingredientId: 'a', votes: 1 }])).toEqual({
      ingredientId: 'a',
      votes: 1,
      total: 1,
      confident: false,
    });
    expect(pickDefault([{ ingredientId: 'a', votes: 3 }])?.confident).toBe(true);
    // 3 z 5 = 60% - za mało przewagi
    expect(
      pickDefault([
        { ingredientId: 'a', votes: 3 },
        { ingredientId: 'b', votes: 2 },
      ]),
    ).toMatchObject({ ingredientId: 'a', confident: false });
    // Głosy z różnych sieci sumują się
    expect(
      pickDefault([
        { ingredientId: 'a', votes: 2 },
        { ingredientId: 'a', votes: 2 },
        { ingredientId: 'b', votes: 1 },
      ]),
    ).toMatchObject({ ingredientId: 'a', votes: 4, total: 5, confident: true });
  });

  it('remis i brak głosów - bez domyślnego', () => {
    expect(
      pickDefault([
        { ingredientId: 'a', votes: 2 },
        { ingredientId: 'b', votes: 2 },
      ]),
    ).toBeNull();
    expect(pickDefault([])).toBeNull();
  });
});
