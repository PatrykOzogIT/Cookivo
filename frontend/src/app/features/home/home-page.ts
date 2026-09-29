import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, MatButtonModule, TranslocoDirective],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected readonly auth = inject(AuthService);

  protected readonly features = [
    { icon: 'monitoring', key: 'goals' },
    { icon: 'calendar_month', key: 'planner' },
    { icon: 'shopping_cart', key: 'shopping' },
    { icon: 'no_food', key: 'allergies' },
    { icon: 'kitchen', key: 'pantry' },
    { icon: 'group', key: 'household' },
  ];
}
