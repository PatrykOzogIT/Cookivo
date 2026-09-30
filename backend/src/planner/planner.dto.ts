import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Stałe posiłki dnia w kolejności wyświetlania */
export const STANDARD_SLOTS = [
  'BREAKFAST',
  'SECOND_BREAKFAST',
  'DINNER',
  'AFTERNOON_SNACK',
  'SUPPER',
  'SNACK',
] as const;
export type StandardSlot = (typeof STANDARD_SLOTS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RangeQueryDto {
  @Matches(DATE, { message: 'DATE_INVALID' })
  from!: string;

  @Matches(DATE, { message: 'DATE_INVALID' })
  to!: string;
}

/** Porcje: ćwiartki porcji wystarczą (np. dziecko je pół) */
function Servings() {
  return (target: object, key: string) => {
    Type(() => Number)(target, key);
    IsNumber({ maxDecimalPlaces: 2 })(target, key);
    Min(0.25)(target, key);
    Max(50)(target, key);
  };
}

export class AddMealDto {
  @Matches(DATE, { message: 'DATE_INVALID' })
  date!: string;

  /** Kod stałego posiłku albo id własnego */
  @IsString()
  @Length(1, 40)
  slot!: string;

  /** Nowe gotowanie z przepisu... */
  @IsOptional()
  @IsUUID()
  recipeId?: string;

  /** ...albo porcje z już ugotowanej partii */
  @IsOptional()
  @IsUUID()
  cookId?: string;

  /** Ile porcji zjadamy w tym posiłku */
  @Servings()
  servings!: number;

  /** Ile porcji ugotować (>= servings; nadwyżka to zapas na kolejne dni) */
  @IsOptional()
  @Servings()
  cookServings?: number;
}

export class UpdateMealDto {
  @IsOptional()
  @Matches(DATE, { message: 'DATE_INVALID' })
  date?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  slot?: string;

  @IsOptional()
  @Servings()
  servings?: number;
}

export class MealEatersDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(/^[ud]:[0-9a-f-]{36}$/i, { each: true })
  absent!: string[];
}

export class CookWeightDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(10)
  @Max(50000)
  cookedGrams!: number | null;
}

export class UpdateCookDto {
  @Servings()
  servings!: number;
}

export class CopyDto {
  @Matches(DATE, { message: 'DATE_INVALID' })
  from!: string;

  @Matches(DATE, { message: 'DATE_INVALID' })
  to!: string;

  /** Kopiujemy dzień albo tydzień */
  @Type(() => Number)
  @IsIn([1, 7])
  days!: 1 | 7;
}

export class PlannerSettingsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(STANDARD_SLOTS.length)
  @IsIn(STANDARD_SLOTS, { each: true })
  hiddenSlots!: StandardSlot[];

  @IsOptional()
  @IsBoolean()
  exactPortions?: boolean;
}

export class CustomSlotDto {
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name!: string;
}
