import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['all', 'blocked', 'admins'])
  filter?: 'all' | 'blocked' | 'admins';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class BlockDto {
  /** Liczba dni blokady; brak / null = na stałe */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number | null;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class RoleDto {
  @IsIn(['USER', 'ADMIN'])
  role!: 'USER' | 'ADMIN';
}
