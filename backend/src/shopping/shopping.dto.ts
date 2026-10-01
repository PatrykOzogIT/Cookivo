import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class FromPlanDto {
  @Matches(DATE, { message: 'DATE_INVALID' })
  from!: string;

  @Matches(DATE, { message: 'DATE_INVALID' })
  to!: string;
}

export class FromRecipeDto {
  @IsUUID()
  recipeId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(100)
  servings!: number;
}

/** Pozycja dodana ręcznie: składnik z bazy (z ilością) albo własna nazwa (np. "papier do pieczenia") */
export class AddItemDto {
  @IsOptional()
  @IsUUID()
  ingredientId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  amount?: number;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  unitCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 80)
  note?: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsBoolean()
  checked?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 80)
  note?: string;
}

export class ClearDto {
  /** true = tylko odhaczone */
  @IsBoolean()
  checkedOnly!: boolean;
}
