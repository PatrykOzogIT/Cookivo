import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

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

export class ShareAllergiesDto {
  @IsBoolean()
  share!: boolean;
}
