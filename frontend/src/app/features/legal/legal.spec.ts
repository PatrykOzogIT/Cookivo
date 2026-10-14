import { segments } from './legal';

describe('segments (linki w dokumentach prawnych)', () => {
  it('wydziela e-mail bez kropki kończącej zdanie', () => {
    expect(segments('Pisz na kontakt@cookivo.pl.')).toEqual([
      { kind: 'text', value: 'Pisz na ' },
      { kind: 'mail', value: 'kontakt@cookivo.pl' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('wydziela adres https bez nawiasu i kropki', () => {
    expect(segments('(Warszawa, https://uodo.gov.pl).')).toEqual([
      { kind: 'text', value: '(Warszawa, ' },
      { kind: 'url', value: 'https://uodo.gov.pl' },
      { kind: 'text', value: ').' },
    ]);
  });

  it('zwykły tekst zostaje bez zmian', () => {
    expect(segments('Bez linków')).toEqual([{ kind: 'text', value: 'Bez linków' }]);
  });
});
