import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** "GLUTEN,MILK" albo ?a=GLUTEN&a=MILK → ['GLUTEN', 'MILK'] */
const toList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class ListIngredientsQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;

  /** Pomiń składniki zawierające te alergeny */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(14)
  @IsString({ each: true })
  excludeAllergens?: string[];

  /** Tylko składniki dodane przez zalogowanego użytkownika (wszystkie statusy) */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  /** Dopasuj do zalogowanego: bez jego alergenów i składników "nie proponuj" */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  forMe?: boolean;

  /** Tylko dla admina: np. PENDING - kolejka do akceptacji */
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  /** Język sortowania alfabetycznego */
  @IsOptional()
  @IsIn(['pl', 'en'])
  lang: 'pl' | 'en' = 'pl';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class IngredientUnitDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  grams!: number;
}

/** Wartości odżywcze na 100 g. Pola opcjonalne: brak = "brak danych". */
export class SaveIngredientDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  namePl!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsString()
  @MaxLength(32)
  categoryCode!: string;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(900)
  kcal!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  protein!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  fat!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  saturatedFat?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  carbs!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sugars?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  fiber?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  salt?: number | null;

  /** g/ml, tylko dla płynów */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.2)
  @Max(3)
  density?: number | null;

  @IsArray()
  @ArrayMaxSize(14)
  @ArrayUnique()
  @IsString({ each: true })
  allergens: string[] = [];

  @IsArray()
  @ArrayMaxSize(11)
  @ValidateNested({ each: true })
  @Type(() => IngredientUnitDto)
  units: IngredientUnitDto[] = [];
}

export class RejectIngredientDto {
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}
