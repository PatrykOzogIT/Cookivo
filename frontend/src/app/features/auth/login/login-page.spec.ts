import { safeReturnUrl } from './login-page';

describe('safeReturnUrl', () => {
  it('przepuszcza ścieżki wewnętrzne', () => {
    expect(safeReturnUrl('/planner')).toBe('/planner');
    expect(safeReturnUrl('/recipes?meal=lunch')).toBe('/recipes?meal=lunch');
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', ''])(
    'blokuje przekierowanie na "%s"',
    (url) => {
      expect(safeReturnUrl(url)).toBe('/');
    },
  );

  it('domyślnie wraca na start', () => {
    expect(safeReturnUrl(undefined)).toBe('/');
  });
});
