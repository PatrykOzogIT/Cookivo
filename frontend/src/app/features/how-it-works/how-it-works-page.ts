import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { buildCalculatorForm, CalculatorFormComponent, liveTargets } from '../profile/calculator-form';
import { TargetsCardComponent } from '../profile/targets-card';

/**
 * "Jak to działa" - opis metody i kalkulator dla gości.
 * Nic nie jest zapisywane ani wysyłane - liczymy w przeglądarce.
 */
@Component({
  selector: 'app-how-it-works-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    TranslocoDirective,
    CalculatorFormComponent,
    TargetsCardComponent,
  ],
  templateUrl: './how-it-works-page.html',
  styleUrl: '../profile/profile-pages.scss',
  styles: `
    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;
      li {
        padding: 18px;
      }
      .material-symbols-rounded {
        font-size: 32px;
        color: var(--ck-link);
      }
      h3 {
        margin: 8px 0 4px;
        font-size: 1.05rem;
      }
      p {
        margin: 0;
        color: var(--ck-text-muted);
      }
    }
  `,
})
export class HowItWorksPage {
  protected readonly auth = inject(AuthService);
  protected readonly form = buildCalculatorForm(inject(NonNullableFormBuilder));
  protected readonly targets = liveTargets(this.form);
  protected readonly steps = [
    { key: 'bmr', icon: 'monitor_heart' },
    { key: 'activity', icon: 'directions_run' },
    { key: 'goal', icon: 'flag' },
    { key: 'macros', icon: 'pie_chart' },
  ];
}
