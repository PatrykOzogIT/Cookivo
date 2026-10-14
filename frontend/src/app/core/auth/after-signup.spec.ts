import { clearAfterSignup, pendingAfterSignup, rememberAfterSignup } from './after-signup';

describe('powrót po rejestracji', () => {
  afterEach(() => localStorage.clear());

  it('zapamiętuje ścieżkę wewnętrzną i ją czyści', () => {
    rememberAfterSignup('/planner');
    expect(pendingAfterSignup()).toBe('/planner');
    clearAfterSignup();
    expect(pendingAfterSignup()).toBeNull();
  });

  it('odrzuca adresy zewnętrzne i stronę główną', () => {
    for (const url of ['https://zly.pl', '//zly.pl', '/\\zly.pl', '/', undefined, null]) {
      rememberAfterSignup(url);
      expect(pendingAfterSignup()).toBeNull();
    }
  });

  it('ignoruje podmieniony wpis w localStorage', () => {
    localStorage.setItem('ck-after-signup', 'https://zly.pl');
    expect(pendingAfterSignup()).toBeNull();
  });
});
