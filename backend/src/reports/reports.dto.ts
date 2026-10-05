import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const REPORT_TARGETS = ['RECIPE', 'RATING', 'USER'] as const;
export const REPORT_REASONS = ['OFFENSIVE', 'SPAM', 'DANGEROUS', 'OTHER'] as const;
export type ReportTargetType = (typeof REPORT_TARGETS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** Zgłoszenie: przepis (recipeId), opinia (recipeId + userId autora opinii) albo użytkownik (userId) */
export class CreateReportDto {
  @IsIn(REPORT_TARGETS)
  targetType!: ReportTargetType;

  @IsOptional()
  @IsUUID()
  recipeId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsIn(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  details?: string;
}

export class QueueQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'ACCEPTED', 'REJECTED'])
  status: 'OPEN' | 'ACCEPTED' | 'REJECTED' = 'OPEN';
}

/** Decyzja admina dla wszystkich otwartych zgłoszeń danego celu */
export class ResolveDto {
  @IsIn(REPORT_TARGETS)
  targetType!: ReportTargetType;

  @IsOptional()
  @IsUUID()
  recipeId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  /** HIDE - ukryj (zgłoszenia przyjęte), RESTORE - przywróć / zostaw (zgłoszenia odrzucone) */
  @IsIn(['HIDE', 'RESTORE'])
  action!: 'HIDE' | 'RESTORE';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}
