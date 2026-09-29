import { Pipe, type PipeTransform, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { prettyFraction } from './recipe-units';
import { pluralForm } from './unit-plural';

/**
 * "2 łyżki", "150 g", "1½ szklanki", "1 porcja".
 * `{{ line.amount | amountLabel: line.unitCode : lang() }}` - język w argumencie, żeby pipe przeliczył się po zmianie.
 */
@Pipe({ name: 'amountLabel' })
export class AmountLabelPipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);

  transform(amount: number, unitCode: string, lang: string): string {
    if (unitCode === 'g' || unitCode === 'ml') {
      const n = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { maximumFractionDigits: 1 }).format(
        amount,
      );
      return `${n} ${unitCode}`;
    }
    const forms = this.transloco.translate(`recipes.unitForms.${unitCode}`, {}, lang);
    return `${prettyFraction(amount, lang)} ${pluralForm(forms, amount, lang)}`;
  }
}
