import { A11yModule } from '@angular/cdk/a11y';
import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Układ strony: treść + opcjonalne filtry.
 * Desktop/tablet: filtry w pionowym panelu z lewej.
 * Telefon: przycisk "Filtry" otwiera panel wysuwany od dołu (bottom sheet).
 *
 *   <app-page-layout [hasFilters]="true" [activeFilters]="3">
 *     <div filters>...</div>
 *     ...treść...
 *   </app-page-layout>
 */
@Component({
  selector: 'app-page-layout',
  imports: [MatButtonModule, TranslocoDirective, A11yModule],
  templateUrl: './page-layout.html',
  styleUrl: './page-layout.scss',
  host: {
    '[class.with-filters]': 'hasFilters()',
    '(document:keydown.escape)': 'closeFilters()',
  },
})
export class PageLayoutComponent {
  private readonly injector = inject(Injector);

  readonly hasFilters = input(false);
  readonly activeFilters = input(0);

  protected readonly filtersOpen = signal(false);
  private readonly toggleButton = viewChild('toggle', { read: ElementRef<HTMLButtonElement> });
  private readonly closeButton = viewChild('close', { read: ElementRef<HTMLButtonElement> });

  openFilters(): void {
    this.filtersOpen.set(true);
    // Fokus do panelu (WCAG 2.4.3) - dopiero po wyrenderowaniu, gdy panel jest widoczny
    afterNextRender(() => this.closeButton()?.nativeElement.focus(), { injector: this.injector });
  }

  closeFilters(): void {
    if (!this.filtersOpen()) return;
    this.filtersOpen.set(false);
    // Fokus wraca na przycisk, który otworzył panel
    this.toggleButton()?.nativeElement.focus();
  }
}
