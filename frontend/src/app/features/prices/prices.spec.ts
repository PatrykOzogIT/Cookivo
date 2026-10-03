import { formatMoney } from './prices.api';

describe('kwoty', () => {
  it('złote po polsku i euro po angielsku', () => {
    // Intl używa twardej spacji przed walutą
    expect(formatMoney(1299, 'PLN', 'pl').replace(/\s/g, ' ')).toBe('12,99 zł');
    expect(formatMoney(429, 'EUR', 'en')).toBe('€4.29');
  });
});
