import { Clipboard } from '@angular/cdk/clipboard';
import { Component, DestroyRef, computed, inject, input, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoDirective } from '@jsverse/transloco';
import { debounceTime, startWith } from 'rxjs';
import { generatePassword } from './password-generator';
import { PASSWORD_MIN, PasswordStrengthService } from './password-strength.service';

let nextId = 0;

/**
 * Pole nowego hasła: pokaż/ukryj, generator, kopiowanie i miernik siły.
 * Walidację (długość, siła) ustawia rodzic przez `passwordPolicyValidator`.
 */
@Component({
  selector: 'app-password-field',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatTooltipModule,
    TranslocoDirective,
  ],
  templateUrl: './password-field.html',
  styleUrl: './password-field.scss',
})
export class PasswordFieldComponent implements OnInit {
  private readonly strength = inject(PasswordStrengthService);
  private readonly clipboard = inject(Clipboard);
  private readonly destroyRef = inject(DestroyRef);

  readonly control = input.required<FormControl<string>>();
  readonly label = input('auth.fields.password');
  readonly userInputs = input<string[]>([]);

  protected readonly id = `ck-password-${nextId++}`;
  protected readonly visible = signal(false);
  protected readonly score = signal<number | null>(null);
  protected readonly copied = signal(false);
  protected readonly generated = signal(false);
  protected readonly minLength = PASSWORD_MIN;

  protected readonly level = computed(() => {
    const s = this.score();
    if (s === null) return null;
    return (['veryWeak', 'veryWeak', 'weak', 'good', 'strong'] as const)[s];
  });

  ngOnInit(): void {
    this.control()
      .valueChanges.pipe(
        startWith(this.control().value),
        debounceTime(150),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(async (value) => {
        if (!value) {
          this.score.set(null);
          return;
        }
        const result = await this.strength.evaluate(value, this.userInputs());
        this.score.set(result.score);
      });
  }

  protected toggleVisibility(): void {
    this.visible.update((v) => !v);
  }

  protected generate(): void {
    const control = this.control();
    control.setValue(generatePassword());
    control.markAsDirty();
    control.markAsTouched();
    // Pokazujemy wygenerowane hasło, żeby user mógł je zapisać
    this.visible.set(true);
    this.generated.set(true);
    this.copied.set(false);
  }

  protected copy(): void {
    if (this.clipboard.copy(this.control().value)) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    }
  }
}
