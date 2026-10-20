import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { STANDARD_SLOTS } from '../planner/planner.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AskDto {
  /** Prośba z pola tekstowego (np. "ułóż mi śniadania na tydzień") */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  text?: string;

  /** Albo szybka akcja (bez rozpoznawania prośby) */
  @IsOptional()
  @IsIn(['PLAN', 'PANTRY', 'SHOPPING'])
  action?: 'PLAN' | 'PANTRY' | 'SHOPPING';

  @IsOptional()
  @IsIn(['pl', 'en'])
  lang?: 'pl' | 'en';
}

export class VariantDto {
  @IsUUID()
  recipeId!: string;

  @IsIn(['VEGAN', 'GLUTEN_FREE', 'LACTOSE_FREE', 'LIGHTER', 'FASTER', 'FROM_PANTRY'])
  kind!: 'VEGAN' | 'GLUTEN_FREE' | 'LACTOSE_FREE' | 'LIGHTER' | 'FASTER' | 'FROM_PANTRY';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  wish?: string;

  @IsOptional()
  @IsIn(['pl', 'en'])
  lang?: 'pl' | 'en';
}

export class PlanMealDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'DATE_INVALID' })
  date!: string;

  @IsIn(STANDARD_SLOTS)
  slot!: string;

  @IsUUID()
  recipeId!: string;

  @IsBoolean()
  leftover!: boolean;
}

export class ApplyPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(42)
  @ValidateNested({ each: true })
  @Type(() => PlanMealDto)
  meals!: PlanMealDto[];
}

export class ShoppingItemDto {
  @IsUUID()
  ingredientId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(100000)
  grams!: number;
}

export class ApplyShoppingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShoppingItemDto)
  items!: ShoppingItemDto[];
}
