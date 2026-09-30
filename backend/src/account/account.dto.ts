import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX } from '../auth/password-policy.service.js';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class UpdateSettingsDto {
  @IsIn(['pl', 'en'])
  locale!: 'pl' | 'en';
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX * 4)
  currentPassword!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX * 4)
  newPassword!: string;
}

export class ChangeEmailDto {
  @Transform(lower)
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  newEmail!: string;

  @IsString()
  @Length(1, PASSWORD_MAX * 4)
  password!: string;
}

export class DeleteAccountDto {
  @IsString()
  @Length(1, PASSWORD_MAX * 4)
  password!: string;
}
