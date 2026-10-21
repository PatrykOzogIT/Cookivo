import { describe, expect, it } from 'vitest';
import { buildSchedule, orderSteps, type PrepDish, type ProposedStep } from './prep-math.js';

const dishes: PrepDish[] = [
  {
    letter: 'A',
    steps: [
      { text: 'Pokrój warzywa.', timerMinutes: null },
      { text: 'Piecz 45 minut.', timerMinutes: 45 },
      { text: 'Podziel na porcje.', timerMinutes: null },
    ],
  },
  {
    letter: 'B',
    steps: [
      { text: 'Obsmaż mięso.', timerMinutes: null },
      { text: 'Duś godzinę.', timerMinutes: 60 },
    ],
  },
];

const p = (
  step: string,
  minutes: number,
  waitMinutes = 0,
  equipment: ProposedStep['equipment'] = 'NONE',
): ProposedStep => ({
  step,
  minutes,
  waitMinutes,
  background: waitMinutes ? 'w tle' : null,
  equipment,
});

describe('orderSteps', () => {
  it('pomija nieznane i powtórzone kody, naprawia kolejność w daniu, dopisuje pominięte', () => {
    const order = orderSteps(dishes, [
      p('A2', 5),
      p('B1', 10),
      p('A1', 15),
      p('A1', 1),
      p('Z9', 1),
      p('A7', 1),
    ]);
    expect(order.map((o) => `${o.dish}${o.index}`)).toEqual(['A1', 'B1', 'A2', 'A3', 'B2']);
    // Parametry czasu idą za numerem kroku, nie za miejscem
    expect(order[0].p?.minutes).toBe(15);
    expect(order[2].p?.minutes).toBe(5);
    expect(order[3].p).toBeNull();
  });
});

describe('buildSchedule', () => {
  it('ręce robią jedno naraz, danie czeka na swój czas w tle, piekarnik w oknach', () => {
    const s = buildSchedule(dishes, [
      p('A1', 15),
      p('A2', 2, 43, 'OVEN'),
      p('B1', 20),
      p('B2', 5, 55, 'HOB'),
      p('A3', 10),
    ]);
    expect(s.steps.map((x) => [`${x.dish}${x.index}`, x.start, x.minutes, x.wait])).toEqual([
      ['A1', 0, 15, 0],
      ['A2', 15, 2, 43],
      ['B1', 17, 20, 0],
      ['B2', 37, 5, 55],
      // A3 dopiero po pieczeniu (15 + 2 + 43 = 60)
      ['A3', 60, 10, 0],
    ]);
    expect(s.end).toBe(97);
    expect(s.handsOn).toBe(52);
    expect(s.oven).toEqual([{ from: 15, to: 60 }]);
    expect(s.steps[0].estimated).toBe(true);
    expect(s.steps[1].estimated).toBe(false);
  });

  it('minutnik z przepisu jest wiążący', () => {
    const s = buildSchedule(dishes, [p('B1', 10), p('B2', 5, 10, 'HOB')]);
    const b2 = s.steps.find((x) => x.dish === 'B' && x.index === 2)!;
    expect(b2.minutes + b2.wait).toBe(60);
    // Bez czasu w tle minutnik wydłuża pracę rękami
    const a = buildSchedule(dishes, [p('A2', 5)]).steps.find((x) => x.index === 2 && x.dish === 'A')!;
    expect(a.minutes).toBe(45);
  });
});
