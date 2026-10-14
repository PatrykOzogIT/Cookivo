import { readPreference } from './theme.service';

describe('readPreference', () => {
  afterEach(() => localStorage.clear());

  it('bez zapisu - tryb automatyczny', () => {
    expect(readPreference()).toBe('auto');
  });

  it('nowe motywy wracają bez zmian', () => {
    for (const t of ['fresh', 'citrus', 'midnight', 'contrast']) {
      localStorage.setItem('ck-theme', t);
      expect(readPreference()).toBe(t);
    }
  });

  it('dawne jasny/ciemny przechodzą na Fresh & Tasty / Midnight Mango', () => {
    localStorage.setItem('ck-theme', 'light');
    expect(readPreference()).toBe('fresh');
    localStorage.setItem('ck-theme', 'dark');
    expect(readPreference()).toBe('midnight');
  });

  it('nieznana wartość - tryb automatyczny', () => {
    localStorage.setItem('ck-theme', 'constructor');
    expect(readPreference()).toBe('auto');
  });
});
