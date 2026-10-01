import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export class PantryItemDto {
  @IsUUID()
  ingredientId!: string;

  /** Ilość opcjonalna - bez niej pozycja znaczy po prostu "mam" */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  amount?: number | null;

  /** 'g', 'ml' albo kod jednostki kuchennej składnika */
  @IsOptional()
  @IsString()
  @Length(1, 32)
  unitCode?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'DATE_INVALID' })
  expiresOn?: string | null;
}

export class PantryUpdateDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  amount?: number | null;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  unitCode?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'DATE_INVALID' })
  expiresOn?: string | null;
}
