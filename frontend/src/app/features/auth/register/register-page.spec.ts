import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { translocoTesting } from '../../../../testing/transloco-testing';
import { PasswordStrengthService } from '../password/password-strength.service';
import { RegisterPage } from './register-page';

describe('RegisterPage', () => {
  let backend: HttpTestingController;

  async function render() {
    await TestBed.configureTestingModule({
      imports: [RegisterPage, translocoTesting()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        // Prawdziwy zxcvbn ładuje duże słowniki - w teście komponentu podstawiamy prosty model
        {
          provide: PasswordStrengthService,
          useValue: {
            evaluate: async (pw: string) => ({
              score: pw.length >= 16 ? 4 : 1,
              acceptable: pw.length >= 16,
              tooShort: pw.length < 12,
            }),
          },
        },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RegisterPage);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  }

  const flush = () => new Promise((r) => setTimeout(r, 500));

  it('pola mają poprawne typy i autouzupełnianie (klawiatury mobilne, menedżery haseł)', async () => {
    const { el } = await render();
    const email = el.querySelector<HTMLInputElement>('input[formcontrolname=email]')!;
    expect(email.type).toBe('email');
    expect(email.getAttribute('inputmode')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(el.querySelector('input[autocomplete=new-password]')).not.toBeNull();
    expect(el.querySelector('input[formcontrolname=username]')?.getAttribute('autocomplete')).toBe(
      'username',
    );
  });

  it('generator wypełnia hasło i pokazuje je użytkownikowi', async () => {
    const { fixture, el } = await render();
    const generate = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Wygeneruj'))!;
    generate.click();
    await fixture.whenStable();

    const password = el.querySelector<HTMLInputElement>('input[autocomplete=new-password]')!;
    expect(password.value).toHaveLength(20);
    expect(password.type).toBe('text');
  });

  it('wysyła poprawne dane i pokazuje ekran "sprawdź skrzynkę"', async () => {
    const { fixture, el } = await render();
    type(el, 'input[formcontrolname=username]', 'Kasia_Gotuje');
    type(el, 'input[formcontrolname=email]', 'kasia@example.com');
    type(el, 'input[autocomplete=new-password]', 'Zielony-Kalafior-Tanczy-42');
    el.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();

    await flush();
    backend.expectOne((r) => r.url === '/api/auth/username-available').flush({ available: true });

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();

    const req = backend.expectOne('/api/auth/register');
    expect(req.request.body).toEqual({
      username: 'Kasia_Gotuje',
      email: 'kasia@example.com',
      password: 'Zielony-Kalafior-Tanczy-42',
      acceptTerms: true,
      locale: 'pl',
    });
    req.flush({ status: 'CHECK_EMAIL' });
    await flush();
    await fixture.whenStable();

    expect(el.textContent).toContain('Sprawdź skrzynkę');
    expect(el.textContent).toContain('kasia@example.com');
  });

  it('nie wysyła formularza bez zgody na regulamin', async () => {
    const { fixture, el } = await render();
    type(el, 'input[formcontrolname=username]', 'Kasia_Gotuje');
    type(el, 'input[formcontrolname=email]', 'kasia@example.com');
    type(el, 'input[autocomplete=new-password]', 'Zielony-Kalafior-Tanczy-42');
    await flush();
    backend.expectOne((r) => r.url === '/api/auth/username-available').flush({ available: true });

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    await fixture.whenStable();

    backend.expectNone('/api/auth/register');
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Zaakceptuj regulamin');
  });

  it('pokazuje błąd serwera przy właściwym polu', async () => {
    const { fixture, el } = await render();
    type(el, 'input[formcontrolname=username]', 'Kasia_Gotuje');
    type(el, 'input[formcontrolname=email]', 'kasia@example.com');
    type(el, 'input[autocomplete=new-password]', 'Zielony-Kalafior-Tanczy-42');
    el.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await flush();
    backend.expectOne((r) => r.url === '/api/auth/username-available').flush({ available: true });

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    backend
      .expectOne('/api/auth/register')
      .flush({ code: 'PASSWORD_PWNED' }, { status: 400, statusText: 'Bad Request' });
    await flush();
    await fixture.whenStable();

    expect(el.querySelector('mat-error')?.textContent).toContain('wyciekło');
  });
});
