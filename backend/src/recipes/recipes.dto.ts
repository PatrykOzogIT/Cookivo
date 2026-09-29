import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && !value.trim() ? undefined : typeof value === 'string' ? value.trim() : value;
const toList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const MAX_GALLERY_PHOTOS = 10;

export class ListRecipesQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Przepis ma którykolwiek z podanych typów posiłku */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mealTypes?: string[];

  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(14)
  @IsString({ each: true })
  excludeAllergens?: string[];

  /** Maksymalnie kcal na porcję */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  maxKcal?: number;

  /** Maksymalny łączny czas (przygotowanie + gotowanie) w minutach */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  maxMinutes?: number;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  canBeIngredient?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsIn(['newest', 'kcal', 'time', 'name'])
  sort: 'newest' | 'kcal' | 'time' | 'name' = 'newest';

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

export class RecipeLineDto {
  /** Składnik z bazy - albo `subRecipeId`, nigdy oba */
  @IsOptional()
  @IsUUID()
  ingredientId?: string;

  /** Inny przepis użyty jako składnik (musi mieć canBeIngredient) */
  @IsOptional()
  @IsUUID()
  subRecipeId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100000)
  amount!: number;

  /** 'g', 'ml', 'SERVING' (porcja podprzepisu) albo kod jednostki kuchennej */
  @IsString()
  @MaxLength(32)
  unitCode!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(80)
  groupName?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class RecipeStepDto {
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  text!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  timerMinutes?: number | null;

  @IsOptional()
  @IsUUID()
  photoId?: string | null;
}

export class SaveRecipeDto {
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  title!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  servings!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  prepMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4320)
  cookMinutes?: number | null;

  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: (typeof DIFFICULTIES)[number] | null;

  @IsIn(['PRIVATE', 'PUBLIC'])
  visibility!: 'PRIVATE' | 'PUBLIC';

  @IsBoolean()
  canBeIngredient = false;

  /** Opcjonalna waga gotowej potrawy - dokładniejsze wartości na 100 g */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(100000)
  cookedGrams?: number | null;

  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  mealTypes: string[] = [];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  ingredients!: RecipeLineDto[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipeStepDto)
  steps: RecipeStepDto[] = [];

  /** Galeria w kolejności (pierwsze = okładka) */
  @IsArray()
  @ArrayMaxSize(MAX_GALLERY_PHOTOS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds: string[] = [];
}

export class HideRecipeDto {
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}
