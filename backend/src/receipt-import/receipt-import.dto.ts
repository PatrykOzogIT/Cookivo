import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CURRENCIES, PriceListDto } from '../prices/prices.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ReceiptAnalyzeDto {
  /** Język uwag od modelu */
  @IsOptional()
  @IsIn(['pl', 'en'])
  lang?: 'pl' | 'en';
}

/** Pozycja po sprawdzeniu przez użytkownika: N opakowań × wielkość opakowania, cena regularna */
export class ReceiptLineDto {
  /** Numer pozycji ze szkicu (do zapamiętania powiązania tekst → składnik) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  key?: number;

  @IsUUID()
  ingredientId!: string;

  @IsBoolean()
  toPantry!: boolean;

  @IsBoolean()
  toPrices!: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1000)
  packages!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100000)
  packageAmount!: number;

  /** g, kg, ml, l albo kod jednostki kuchennej składnika (np. PIECE) */
  @IsString()
  @Length(1, 32)
  packageUnitCode!: string;

  /** Cena regularna opakowania, np. 4.29 - wymagana, gdy pozycja idzie do cennika */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  price?: number | null;
}

export class ReceiptCommitDto {
  @IsBoolean()
  toPantry!: boolean;

  @IsBoolean()
  toPrices!: boolean;

  /** Istniejący cennik albo `newList` (zakładany w tej samej transakcji) */
  @IsOptional()
  @IsUUID()
  listId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PriceListDto)
  newList?: PriceListDto;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 80)
  store?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  purchasedOn?: string;

  @IsIn(CURRENCIES)
  currency!: (typeof CURRENCIES)[number];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}
