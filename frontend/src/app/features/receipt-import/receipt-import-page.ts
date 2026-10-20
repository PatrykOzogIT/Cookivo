import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { PhotoPicker } from '../../shared/photo-picker';
import { IngredientRequestsApi } from '../admin/ingredient-requests.api';
import { HouseholdApi } from '../household/household.api';
import { IngredientsApi } from '../ingredients/ingredients.api';
import type { Ingredient } from '../ingredients/ingredients.models';
import { IngredientPickerComponent } from '../pantry/ingredient-picker';
import { PriceListForm } from '../prices/price-list-form';
import { CURRENCIES, formatMoney, PricesApi, type Currency, type PriceList } from '../prices/prices.api';
import { compressImage } from '../recipes/image-compress';
import { unitOptionsWithBulk } from '../recipes/recipe-units';
import { ReceiptImportApi, type ReceiptIngredient, type ReceiptStatus } from './receipt-import.api';
import { ReceiptImportStore } from './receipt-import.store';
import {
  fromDraft,
  lineProblems,
  lineTotalCents,
  summarize,
  toCommitLine,
  type EditLine,
} from './receipt-lines';

/**
 * Import paragonu ze zdjęć - jeden dla lodówki i cenników (`?from=pantry|prices` to tylko powrót).
 * Kroki: zdjęcia i cele → odczyt (AI) → sprawdzenie pozycji i cennika → zatwierdzenie.
 */
@Component({
  selector: 'app-receipt-import-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    TranslocoDirective,
    LocalizedPipe,
    PhotoPicker,
    PriceListForm,
    IngredientPickerComponent,
  ],
  templateUrl: './receipt-import-page.html',
  styleUrls: ['../pantry/pantry-page.scss', './receipt-import-page.scss'],
})
export class ReceiptImportPage implements OnInit {
  private readonly api = inject(ReceiptImportApi);
  private readonly requestsApi = inject(IngredientRequestsApi);
  private readonly injector = inject(Injector);
  private readonly pricesApi = inject(PricesApi);
  private readonly transloco = inject(TranslocoService);
  private readonly dictionaries = toSignal(inject(IngredientsApi).dictionaries$);
  protected readonly lang = inject(LanguageService).current;
  protected readonly household = inject(HouseholdApi).current;
  protected readonly s = inject(ReceiptImportStore);

  /** Skąd przyszliśmy (powrót): lodówka albo cenniki */
  readonly from = input<string>();

  protected readonly currencies = CURRENCIES;
  protected readonly status = signal<ReceiptStatus | null>(null);
  protected readonly lists = signal<PriceList[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errorWarnings = signal<string[]>([]);
  /** Pozycja, przy której jest otwarta wyszukiwarka składnika */
  protected readonly picking = signal<number | null>(null);
  /** Pozycja z otwartym formularzem "Zgłoś brakujący produkt" */
  protected readonly reporting = signal<number | null>(null);
  protected requestName = '';
  /** Formularz nowego cennika anulowany - proponujemy zapis tylko do lodówki */
  protected readonly newListCancelled = signal(false);
  protected newListName = '';
  protected newListCurrency: Currency = 'PLN';

  protected readonly backLink = computed(() => (this.from() === 'prices' ? '/prices' : '/pantry'));
  protected readonly noTarget = computed(() => !this.s.toPantry() && !this.s.toPrices());

  protected readonly selectedList = computed(() => {
    const id = this.s.listChoice();
    return id && id !== 'NEW' ? (this.lists().find((l) => l.id === id) ?? null) : null;
  });
  /** Waluta cennika docelowego (nowego albo istniejącego) */
  protected readonly listCurrency = computed<Currency | null>(() =>
    this.s.listChoice() === 'NEW'
      ? (this.s.newList()?.currency ?? null)
      : (this.selectedList()?.currency ?? null),
  );
  /** Ceny trafią do cennika: cel zaznaczony, cennik wybrany/zapamiętany i w walucie paragonu */
  protected readonly pricesReady = computed(
    () => this.s.toPrices() && this.listCurrency() !== null && this.listCurrency() === this.s.currency(),
  );
  protected readonly currencyMismatch = computed(
    () => this.s.toPrices() && this.listCurrency() !== null && this.listCurrency() !== this.s.currency(),
  );
  protected readonly needsNewListForm = computed(
    () => this.s.toPrices() && this.s.listChoice() === 'NEW' && !this.s.newList(),
  );

  protected readonly summary = computed(() =>
    summarize(this.s.lines(), this.s.toPantry(), this.pricesReady()),
  );
  protected readonly problems = computed(
    () => new Map(this.s.lines().map((l) => [l.key, lineProblems(l, this.s.toPantry(), this.pricesReady())])),
  );
  protected readonly canCommit = computed(() => {
    const anyTarget = this.summary().pantry + this.summary().prices > 0;
    const complete = [...this.problems().values()].every((p) => !p.length);
    return anyTarget && complete && !this.needsNewListForm() && !this.busy();
  });

  async ngOnInit(): Promise<void> {
    try {
      const [status, lists] = await Promise.all([this.api.status(), this.pricesApi.lists()]);
      this.status.set(status);
      this.lists.set(lists);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }

  // --- Krok 1: odczyt -------------------------------------------------------------

  protected async analyze(): Promise<void> {
    if (!this.s.photos().length || this.noTarget()) return;
    await this.run(async () => {
      // Mniejsze zdjęcia: szybsza wysyłka i taniej przy odczycie (paragon potrzebuje ostrości)
      const blobs = await Promise.all(this.s.photos().map((p) => compressImage(p.file, 2000, 0.85)));
      const draft = await this.api.analyze(blobs, this.lang());
      const lists = await this.pricesApi.lists();
      this.lists.set(lists);
      this.s.draft.set(draft);
      this.s.lines.set(draft.lines.map((l) => fromDraft(l, this.lang())));
      this.s.store.set(draft.store ?? '');
      this.s.purchasedOn.set(draft.purchasedOn ?? '');
      // Podpowiedź serwera (cennik sklepu albo domyślny); gdyby zniknęła - domyślny
      const suggested =
        lists.find((l) => l.id === draft.suggestedListId) ?? lists.find((l) => l.isDefault) ?? null;
      this.s.currency.set(draft.currency ?? suggested?.currency ?? 'PLN');
      this.s.householdId.set(this.household()?.id ?? null);
      this.s.listChoice.set(suggested?.id ?? 'NEW');
      this.newListName = draft.store ?? this.transloco.translate('receiptImport.defaultListName');
      this.newListCurrency = this.s.currency();
    }).finally(
      () =>
        void this.api.status().then(
          (st) => this.status.set(st),
          () => undefined,
        ),
    );
  }

  // --- Krok 2: pozycje -------------------------------------------------------------

  protected patch(line: EditLine, patch: Partial<EditLine>): void {
    this.s.patchLine(line.key, patch);
  }

  protected chooseIngredient(line: EditLine, ingredient: ReceiptIngredient | Ingredient): void {
    const item: ReceiptIngredient = {
      id: ingredient.id,
      namePl: ingredient.namePl,
      nameEn: ingredient.nameEn,
      density: ingredient.density,
      units: ingredient.units,
      category: { icon: ingredient.category.icon },
    };
    const options = this.unitsFor(item).map((u) => u.code);
    this.s.patchLine(line.key, {
      ingredient: item,
      status: 'MATCHED',
      matchSource: null,
      // Jednostka opakowania niepasująca do nowego składnika - do wyboru od nowa
      packageUnitCode:
        line.packageUnitCode && options.includes(line.packageUnitCode)
          ? line.packageUnitCode
          : options.includes('PIECE')
            ? 'PIECE'
            : null,
    });
    this.picking.set(null);
  }

  /** Wstępnie wybrany składnik (od innych / AI / podobna nazwa) - potwierdzony */
  protected confirmMatch(line: EditLine): void {
    this.s.patchLine(line.key, { status: 'MATCHED' });
  }

  protected openRequest(line: EditLine): void {
    this.requestName = line.name ? line.name.charAt(0).toUpperCase() + line.name.slice(1) : '';
    this.reporting.set(line.key);
    afterNextRender(() => document.getElementById('request-name')?.focus(), { injector: this.injector });
  }

  /** "Zgłoś brakujący produkt": pełna nazwa od użytkownika, tekst i sklep serwer bierze z odczytu */
  protected async sendRequest(line: EditLine): Promise<void> {
    const draft = this.s.draft();
    const name = this.requestName.trim();
    if (!draft || name.length < 2) return;
    await this.run(async () => {
      await this.requestsApi.create({ name, importId: draft.importId, key: line.key });
      this.s.patchLine(line.key, { requested: true });
      this.reporting.set(null);
    });
  }

  protected unitsFor(ingredient: ReceiptIngredient | null) {
    if (!ingredient) return [];
    return unitOptionsWithBulk(
      {
        kind: 'ingredient',
        id: ingredient.id,
        name: ingredient,
        density: ingredient.density,
        units: ingredient.units,
      },
      this.dictionaries()?.units ?? [],
    );
  }

  protected unitLabel(ingredient: ReceiptIngredient | null, code: string): string {
    const u = this.unitsFor(ingredient).find((x) => x.code === code);
    if (!u || ['g', 'kg', 'ml', 'l'].includes(code)) return code;
    if (u.key) return this.transloco.translate(u.key);
    return this.lang() === 'en' && u.name?.nameEn ? u.name.nameEn : (u.name?.namePl ?? code);
  }

  protected lineTotal(line: EditLine): string {
    const cents = lineTotalCents(line);
    return cents === null ? '' : this.money(cents);
  }

  protected money(cents: number): string {
    return formatMoney(cents, this.s.currency(), this.lang());
  }

  // --- Cennik --------------------------------------------------------------------

  protected chooseList(choice: string): void {
    this.s.listChoice.set(choice);
    this.newListCancelled.set(false);
  }

  protected rememberNewList(data: { name: string; currency: Currency }): void {
    this.s.newList.set(data);
    this.newListCancelled.set(false);
  }

  protected editNewList(): void {
    const n = this.s.newList();
    if (n) {
      this.newListName = n.name;
      this.newListCurrency = n.currency;
    }
    this.s.newList.set(null);
  }

  protected cancelNewList(): void {
    this.newListCancelled.set(true);
    // Wracamy do istniejącego cennika, jeśli jest; inaczej użytkownik decyduje (np. tylko lodówka)
    const fallback = this.lists().find((l) => l.isDefault) ?? this.lists()[0];
    if (fallback) this.s.listChoice.set(fallback.id);
  }

  protected pantryOnly(): void {
    this.s.toPrices.set(false);
    this.newListCancelled.set(false);
  }

  // --- Zatwierdzenie -----------------------------------------------------------------

  protected async commit(): Promise<void> {
    const draft = this.s.draft();
    if (!draft || !this.canCommit()) return;
    const pantry = this.s.toPantry();
    const prices = this.pricesReady();
    const lines = this.s
      .lines()
      .filter((l) => (pantry && l.toPantry) || (prices && l.toPrices))
      .map((l) => toCommitLine(l, pantry, prices));
    await this.run(async () => {
      const result = await this.api.commit(draft.importId, {
        toPantry: pantry,
        toPrices: prices,
        ...(prices && this.s.listChoice() === 'NEW' ? { newList: this.s.newList()! } : {}),
        ...(prices && this.s.listChoice() !== 'NEW' ? { listId: this.s.listChoice()! } : {}),
        store: this.s.store().trim() || undefined,
        purchasedOn: this.s.purchasedOn() || undefined,
        currency: this.s.currency(),
        lines,
      });
      this.s.result.set(result);
    });
  }

  protected restart(): void {
    this.s.reset();
    this.error.set(null);
    this.errorWarnings.set([]);
    this.newListCancelled.set(false);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.errorWarnings.set([]);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
      const body = (err as { error?: { warnings?: string[] } }).error;
      this.errorWarnings.set(body?.warnings ?? []);
    } finally {
      this.busy.set(false);
    }
  }
}
