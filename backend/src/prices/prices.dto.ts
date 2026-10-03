import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export const CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'CZK'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PriceListDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];
}

export class UpdatePriceListDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  /** true = ten cennik liczy koszty */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Cena "jak na półce": opakowanie (ilość + jednostka) i jego cena */
export class PriceEntryDto {
  @IsUUID()
  ingredientId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100000)
  packageAmount!: number;

  /** g, kg, ml, l albo kod jednostki kuchennej składnika (np. PIECE) */
  @IsString()
  @Length(1, 32)
  packageUnitCode!: string;

  /** Cena opakowania, np. 4.29 */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  price!: number;
}

export class RecipeCostQueryDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(100)
  servings!: number;
}
