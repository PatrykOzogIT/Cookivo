import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX } from './password-policy.service.js';
import { USERNAME_MAX } from './username-policy.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const LOCALES = ['pl', 'en'] as const;

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @MaxLength(USERNAME_MAX)
  username!: string;

  @Transform(lower)
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX * 4)
  password!: string;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: (typeof LOCALES)[number];

  /** Akceptacja regulaminu i polityki prywatności (wymagane, RODO art. 6 ust. 1 lit. b) */
  @Equals(true, { message: 'TERMS_REQUIRED' })
  acceptTerms!: boolean;
}

export class LoginDto {
  /** Nazwa użytkownika lub e-mail */
  @Transform(trim)
  @IsString()
  @Length(1, 254)
  login!: string;

  @IsString()
  @Length(1, PASSWORD_MAX * 4)
  password!: string;
}

export class EmailDto {
  @Transform(lower)
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email!: string;
}

export class TokenDto {
  @IsString()
  @Length(20, 100)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MaxLength(PASSWORD_MAX * 4)
  password!: string;
}

export class UsernameQueryDto {
  @Transform(trim)
  @IsString()
  @MaxLength(USERNAME_MAX + 10)
  username!: string;
}
