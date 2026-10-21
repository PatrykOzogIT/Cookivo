import { isConfidentMatch, unitAllowed } from './ingredient-names.js';

describe('pewne dopasowanie nazwy do składnika', () => {
  it('ta sama nazwa albo nazwa z doprecyzowaniem', () => {
    expect(isConfidentMatch('mleko', { namePl: 'Mleko 3,2%' })).toBe(true);
    expect(isConfidentMatch('mąka pszenna', { namePl: 'Mąka pszenna' })).toBe(true);
  });

  it('liczba mnoga w bazie (1-2 litery końcówki)', () => {
    expect(isConfidentMatch('ziemniak', { namePl: 'Ziemniaki' })).toBe(true);
    expect(isConfidentMatch('pomidor', { namePl: 'Pomidory' })).toBe(true);
  });

  it('inne produkty nie są "pewne"', () => {
    expect(isConfidentMatch('mleko 2%', { namePl: 'Mleko 3,2%' })).toBe(false);
    expect(isConfidentMatch('ser', { namePl: 'Serca drobiowe' })).toBe(false);
    expect(isConfidentMatch('banan', { namePl: 'Banan plantan' })).toBe(true);
    expect(isConfidentMatch('jajko', { namePl: 'Jajko przepiórcze' })).toBe(true);
    expect(isConfidentMatch('kasza', { namePl: 'Kaszanka' })).toBe(false);
  });

  it('jednostki: kg zawsze, l tylko przy gęstości', () => {
    expect(unitAllowed('kg', { density: null, units: [] }, {})).toBe(true);
    expect(unitAllowed('l', { density: null, units: [] }, {})).toBe(false);
    expect(unitAllowed('l', { density: 1.03, units: [] }, {})).toBe(true);
  });
});
