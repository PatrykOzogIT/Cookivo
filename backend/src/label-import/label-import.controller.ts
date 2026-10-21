import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import { MAX_PHOTO_BYTES } from '../photos/photos.service.js';
import { LabelImportService, MAX_LABEL_PHOTOS } from './label-import.service.js';

class LabelAnalyzeDto {
  @IsOptional()
  @IsIn(['pl', 'en'])
  lang?: 'pl' | 'en';

  /** Nazwa wpisana już w formularzu (pomaga przy nieczytelnym froncie opakowania) */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  name?: string;
}

/** Zbyt duży plik lub za dużo plików → nasze kody błędów zamiast komunikatów multera */
@Catch(PayloadTooLargeException)
class LabelTooLargeFilter implements ExceptionFilter {
  catch(_: PayloadTooLargeException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({ statusCode: 413, code: 'PHOTO_TOO_LARGE' });
  }
}

@Controller('label-import')
export class LabelImportController {
  constructor(private readonly labels: LabelImportService) {}

  /** Czy funkcja jest włączona i ile odczytów zostało dziś */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.labels.status(user.id);
  }

  /** Zdjęcia etykiety → szkic formularza składnika */
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseFilters(LabelTooLargeFilter)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_LABEL_PHOTOS, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_LABEL_PHOTOS },
    }),
  )
  analyze(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: LabelAnalyzeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.labels.analyze(
      user,
      (files ?? []).map((f) => f.buffer),
      dto.lang ?? 'pl',
      dto.name,
    );
  }
}
