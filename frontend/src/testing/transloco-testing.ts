import { TranslocoTestingModule, type TranslocoTestingOptions } from '@jsverse/transloco';
import en from '../../public/i18n/en.json';
import pl from '../../public/i18n/pl.json';

/** Transloco z prawdziwymi plikami tłumaczeń - testy przy okazji wyłapią brakujące klucze. */
export function translocoTesting(options: TranslocoTestingOptions = {}) {
  return TranslocoTestingModule.forRoot({
    langs: { pl, en },
    translocoConfig: { availableLangs: ['pl', 'en'], defaultLang: 'pl' },
    preloadLangs: true,
    ...options,
  });
}
