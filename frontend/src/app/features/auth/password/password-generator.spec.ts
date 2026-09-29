import { GENERATED_PASSWORD_LENGTH, generatePassword } from './password-generator';

describe('generatePassword', () => {
  it('ma domyślną długość i zawiera każdą klasę znaków', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
    }
  });

  it('nie używa znaków łatwych do pomylenia', () => {
    const sample = Array.from({ length: 200 }, () => generatePassword()).join('');
    expect(sample).not.toMatch(/[lI1O0]/);
  });

  it('generuje różne hasła', () => {
    const set = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(set.size).toBe(100);
  });

  it('korzysta z kryptograficznego źródła losowości', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    generatePassword(12);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('odrzuca zbyt krótką długość', () => {
    expect(() => generatePassword(3)).toThrow();
  });
});
