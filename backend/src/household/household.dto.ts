import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || undefined : value;

export class HouseholdNameDto {
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;
}

export class CreateInviteDto {
  @IsOptional()
  @Transform(lower)
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email?: string;
}

export class InviteTokenDto {
  @IsString()
  @Length(10, 200)
  token!: string;
}

export class DependentDto {
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  birthYear!: number;

  @IsIn(['MALE', 'FEMALE'])
  sex!: 'MALE' | 'FEMALE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(5000)
  customKcal?: number | null;
}

export class ShareAllergiesDto {
  @IsBoolean()
  share!: boolean;
}
