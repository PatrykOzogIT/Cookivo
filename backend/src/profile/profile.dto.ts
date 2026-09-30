import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const SEXES = ['FEMALE', 'MALE'] as const;
export const ACTIVITIES = ['SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE'] as const;
export const GOALS = ['CUT', 'CUT_MILD', 'MAINTAIN', 'BULK'] as const;
export const PREFERENCE_LEVELS = ['NEVER', 'SOMETIMES', 'LIKE', 'LOVE'] as const;
export const SEVERITIES = ['ALLERGY', 'INTOLERANCE'] as const;

export class SaveProfileDto {
  @IsIn(SEXES)
  sex!: (typeof SEXES)[number];

  /** YYYY-MM-DD */
  @IsISO8601({ strict: true })
  birthDate!: string;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(120)
  @Max(230)
  heightCm!: number;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(300)
  weightKg!: number;

  @IsIn(ACTIVITIES)
  activity!: (typeof ACTIVITIES)[number];

  @IsIn(GOALS)
  goal!: (typeof GOALS)[number];

  @IsOptional()
  @IsInt()
  @Min(800)
  @Max(6000)
  customKcal?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(500)
  customProtein?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(500)
  customFat?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(1000)
  customCarbs?: number | null;
}

export class HealthConsentDto {
  @IsBoolean()
  granted!: boolean;
}

export class UserAllergenDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsIn(SEVERITIES)
  severity!: (typeof SEVERITIES)[number];
}

export class SetAllergensDto {
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => UserAllergenDto)
  allergens!: UserAllergenDto[];
}

export class SetPreferenceDto {
  /** null = neutralnie (usuwa preferencję) */
  @IsOptional()
  @IsIn(PREFERENCE_LEVELS)
  level!: (typeof PREFERENCE_LEVELS)[number] | null;
}
