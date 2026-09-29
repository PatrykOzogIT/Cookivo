import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { PageLayoutComponent } from './page-layout';

@Component({
  imports: [PageLayoutComponent],
  template: `
    <app-page-layout [hasFilters]="hasFilters()" [activeFilters]="2">
      <div filters><button type="button" id="inside">Filtr</button></div>
      <p id="content">Treść</p>
    </app-page-layout>
  `,
})
class HostComponent {
  readonly hasFilters = signal(true);
}

describe('PageLayoutComponent', () => {
  async function render(hasFilters = true) {
    await TestBed.configureTestingModule({
      imports: [HostComponent, translocoTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hasFilters.set(hasFilters);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('bez filtrów renderuje tylko treść', async () => {
    const { el } = await render(false);
    expect(el.querySelector('#content')).not.toBeNull();
    expect(el.querySelector('aside')).toBeNull();
  });

  it('pokazuje filtry w <aside> z etykietą i licznikiem aktywnych', async () => {
    const { el } = await render();
    const aside = el.querySelector('aside')!;
    expect(aside.getAttribute('aria-label')).toBe('Filtry');
    expect(aside.querySelector('#inside')).not.toBeNull();
    expect(el.querySelector('.badge')?.getAttribute('aria-label')).toBe('Aktywne filtry: 2');
  });

  it('przycisk otwiera panel (aria-expanded), Escape go zamyka', async () => {
    const { fixture, el } = await render();
    const toggle = el.querySelector<HTMLButtonElement>('.filters-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('page-filters');

    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('aside')!.classList).toContain('open');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
