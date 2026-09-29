import { Component, computed, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslocoDirective } from '@jsverse/transloco';
import { PageLayoutComponent } from '../../layout/page-layout/page-layout';
import { CatalogTabsComponent } from '../../shared/catalog-tabs';

export const MEAL_TYPES = [
  'breakfast',
  'lunch',
  'dinner',
  'afternoonSnack',
  'supper',
  'snack',
  'party',
] as const;

/**
 * Szkielet listy przepisów - na razie demonstruje układ z filtrami.
 * Prawdziwe dane pojawią się w etapie 3.
 */
@Component({
  selector: 'app-recipes-page',
  imports: [
    PageLayoutComponent,
    CatalogTabsComponent,
    MatCheckboxModule,
    MatSlideToggleModule,
    TranslocoDirective,
  ],
  templateUrl: './recipes-page.html',
  styleUrl: './recipes-page.scss',
})
export class RecipesPage {
  protected readonly mealTypes = MEAL_TYPES;
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly withoutAllergens = signal(true);
  protected readonly fromPantry = signal(false);
  protected readonly skeletons = Array.from({ length: 6 }, (_, i) => i);

  protected readonly activeCount = computed(
    () => this.selected().size + (this.withoutAllergens() ? 1 : 0) + (this.fromPantry() ? 1 : 0),
  );

  protected toggleMealType(type: string, checked: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }
}
