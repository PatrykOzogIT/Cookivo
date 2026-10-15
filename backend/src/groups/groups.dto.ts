import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || undefined : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class SaveGroupDto {
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;
}

export class GroupInviteDto {
  @IsOptional()
  @Transform(lower)
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email?: string;
}

export class GroupTokenDto {
  @IsString()
  @Length(10, 200)
  token!: string;
}
