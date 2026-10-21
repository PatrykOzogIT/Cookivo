import { describe, expect, it } from 'vitest';
import type { PrepStep } from './assistant.api';
import { backgroundsAfter, clockAt, duration } from './prep-view';

const step = (dish: string, index: number, start: number, minutes: number, wait = 0): PrepStep => ({
  dish,
  index,
  text: '',
  timerMinutes: null,
  start,
  minutes,
  wait,
  background: wait ? 'piecze się' : null,
  equipment: wait ? 'OVEN' : 'NONE',
  estimated: true,
});

describe('prep-view', () => {
  it('godzina od startu, także przez północ', () => {
    expect(clockAt('10:00', 0)).toBe('10:00');
    expect(clockAt('10:00', 140)).toBe('12:20');
    expect(clockAt('23:30', 45)).toBe('00:15');
  });

  it('czas trwania', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(140)).toBe('2 h 20 min');
    expect(duration(120)).toBe('2 h');
  });

  it('w tle: trwające czasy oczekiwania po zakończeniu kroku', () => {
    const steps = [step('A', 1, 0, 15), step('A', 2, 15, 2, 43), step('B', 1, 17, 20), step('A', 3, 60, 10)];
    // Po włożeniu do piekarnika - piecze się do 60
    expect(backgroundsAfter(steps, steps[1])).toEqual([{ dish: 'A', text: 'piecze się', until: 60 }]);
    expect(backgroundsAfter(steps, steps[2])).toHaveLength(1);
    expect(backgroundsAfter(steps, steps[0])).toEqual([]);
    expect(backgroundsAfter(steps, steps[3])).toEqual([]);
  });
});
