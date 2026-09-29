import { formatClock, pause, resume, secondsLeft, startTimer } from './cook/timers';
import { groupLines } from './detail/recipe-detail-page';
import { defaultUnit, prettyFraction, scaleAmount, unitOptions, type LineItem } from './recipe-units';
import type { RecipeLine } from './recipes.models';
import { pluralForm, pluralIndex } from './unit-plural';

describe('odmiana jednostek', () => {
  const spoon = 'łyżka|łyżki|łyżek';

  it.each([
    [1, 'łyżka'],
    [2, 'łyżki'],
    [4, 'łyżki'],
    [5, 'łyżek'],
    [12, 'łyżek'],
    [14, 'łyżek'],
    [22, 'łyżki'],
    [25, 'łyżek'],
    [0.5, 'łyżki'],
    [1.5, 'łyżki'],
  ])('PL: %s → %s', (n, expected) => {
    expect(pluralForm(spoon, n, 'pl')).toBe(expected);
  });

  it('EN: 1 → liczba pojedyncza, reszta mnoga', () => {
    expect(pluralForm('glass|glasses|glasses', 1, 'en')).toBe('glass');
    expect(pluralForm('glass|glasses|glasses', 1.5, 'en')).toBe('glasses');
    expect(pluralIndex(3, 'en')).toBe(1);
  });
});

describe('skalowanie ilości', () => {
  it('gramy zaokrągla po kuchennemu, sztuki i łyżki do ćwiartek', () => {
    expect(scaleAmount(150, 1.5, 'g')).toBe(225);
    expect(scaleAmount(333, 1, 'g')).toBe(335);
    expect(scaleAmount(7, 0.5, 'g')).toBe(3.5);
    expect(scaleAmount(1.5, 1.5, 'GLASS')).toBe(2.25);
    expect(scaleAmount(1, 0.1, 'PIECE')).toBe(0.25); // nie schodzimy do zera
  });

  it('ułamki jako ¼ ½ ¾', () => {
    expect(prettyFraction(2.25, 'pl')).toBe('2¼');
    expect(prettyFraction(0.5, 'pl')).toBe('½');
    expect(prettyFraction(3, 'pl')).toBe('3');
    expect(prettyFraction(0.75, 'en')).toBe('¾');
  });
});

describe('jednostki pozycji przepisu', () => {
  const units = [
    { code: 'TABLESPOON', namePl: 'łyżka', nameEn: 'tablespoon', ml: 15 },
    { code: 'PIECE', namePl: 'sztuka', nameEn: 'piece', ml: null },
  ];
  const milk: LineItem = { kind: 'ingredient', id: 'm', name: { namePl: 'Mleko' }, density: 1.03, units: [] };
  const egg: LineItem = {
    kind: 'ingredient',
    id: 'e',
    name: { namePl: 'Jajko' },
    density: null,
    units: [{ code: 'PIECE', namePl: 'sztuka', grams: 50 }],
  };
  const broth: LineItem = { kind: 'recipe', id: 'r', name: { namePl: 'Rosół' }, servings: 4 };

  it('płyn: g, ml i łyżka z gęstości', () => {
    expect(unitOptions(milk, units).map((u) => u.code)).toEqual(['g', 'ml', 'TABLESPOON']);
    expect(defaultUnit(milk)).toBe('ml');
  });

  it('składnik z jednostką: domyślnie sztuka', () => {
    expect(unitOptions(egg, units).map((u) => u.code)).toEqual(['g', 'PIECE']);
    expect(defaultUnit(egg)).toBe('PIECE');
  });

  it('podprzepis: porcja albo gramy', () => {
    expect(unitOptions(broth, units).map((u) => u.code)).toEqual(['SERVING', 'g']);
    expect(defaultUnit(broth)).toBe('SERVING');
  });
});

describe('minutniki', () => {
  it('odlicza z zegara, pauzuje i wznawia', () => {
    const t0 = 1_000_000;
    let t = startTimer(1, 2, t0);
    expect(secondsLeft(t, t0 + 30_000)).toBe(90);
    t = pause(t, t0 + 30_000);
    expect(secondsLeft(t, t0 + 600_000)).toBe(90); // w pauzie czas stoi
    t = resume(t, t0 + 600_000);
    expect(secondsLeft(t, t0 + 660_000)).toBe(30);
    expect(secondsLeft(t, t0 + 999_999)).toBe(0);
  });

  it('formatuje zegar', () => {
    expect(formatClock(90)).toBe('01:30');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});

describe('grupowanie składników', () => {
  const line = (id: string, groupName: string | null) => ({ id, groupName }) as RecipeLine;

  it('łączy kolejne pozycje z tej samej grupy', () => {
    const groups = groupLines([line('a', 'Ciasto'), line('b', 'Ciasto'), line('c', 'Krem'), line('d', null)]);
    expect(groups.map((g) => [g.name, g.lines.map((l) => l.id)])).toEqual([
      ['Ciasto', ['a', 'b']],
      ['Krem', ['c']],
      [null, ['d']],
    ]);
  });
});
