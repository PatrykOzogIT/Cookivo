import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { FeatureShowcaseComponent } from './feature-showcase';
import { SLIDES } from './showcase.data';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, MatButtonModule, TranslocoDirective, FeatureShowcaseComponent],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  /** Karty-skróty pod hero - te same funkcje i kolejność co w prezentacji */
  protected readonly slides = SLIDES;
}
