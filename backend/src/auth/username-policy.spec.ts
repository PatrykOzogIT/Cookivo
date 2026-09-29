import { checkUsername, normalizeUsername } from './username-policy.js';

describe('checkUsername', () => {
  it.each(['kasia', 'Jan_Kowalski', 'chef.anna', 'kuba-92', 'abc'])('akceptuje "%s"', (name) => {
    expect(checkUsername(name)).toBeNull();
  });

  it.each([
    ['ab', 'za krótka'],
    ['a'.repeat(21), 'za długa'],
    ['_kasia', 'zaczyna się od znaku specjalnego'],
    ['kasia.', 'kończy się znakiem specjalnym'],
    ['ka..sia', 'podwójny separator'],
    ['kasia zosia', 'spacja'],
    ['żaneta', 'znak spoza ASCII'],
    ['<script>', 'znaki HTML'],
  ])('odrzuca "%s" (%s) jako USERNAME_FORMAT', (name) => {
    expect(checkUsername(name)).toBe('USERNAME_FORMAT');
  });

  it.each(['admin', 'Admin', 'admin_kasia', 'cookivo.team', 'root', '4dmin', 'moderator1'])(
    'odrzuca zastrzeżoną nazwę "%s"',
    (name) => {
      expect(checkUsername(name)).toBe('USERNAME_RESERVED');
    },
  );

  it('nie blokuje nazw, które tylko zawierają krótkie zastrzeżone słowo', () => {
    expect(checkUsername('modern_chef')).toBeNull();
    expect(checkUsername('rapid_info_fan')).toBeNull();
  });

  it.each(['kurwa123', 'KuRw4', 'fuck_you', 'chuj', 'pizdeczka'])('odrzuca wulgarną nazwę "%s"', (name) => {
    expect(checkUsername(name)).toBe('USERNAME_OFFENSIVE');
  });
});

describe('normalizeUsername', () => {
  it('ujednolica wielkość liter i obcina spacje', () => {
    expect(normalizeUsername('  Jan_Kowalski ')).toBe('jan_kowalski');
  });
});
