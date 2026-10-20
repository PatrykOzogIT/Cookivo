import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Prośba o składnik: pełna nazwa od użytkownika, opcjonalnie pozycja z odczytu paragonu */
export class CreateIngredientRequestDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsUUID()
  importId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  key?: number;
}

export class ResolveIngredientRequestDto {
  @IsUUID()
  ingredientId!: string;
}

export class IngredientRequestsQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'DONE', 'REJECTED'])
  status?: 'OPEN' | 'DONE' | 'REJECTED';
}
