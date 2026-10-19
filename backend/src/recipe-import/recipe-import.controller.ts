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
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import { MAX_PHOTO_BYTES } from '../photos/photos.service.js';
import { MAX_IMPORT_PHOTOS, RecipeImportService } from './recipe-import.service.js';

class ImportDto {
  /** Język uwag od modelu (tytuł i kroki zostają w języku oryginału) */
  @IsOptional()
  @IsIn(['pl', 'en'])
  lang?: 'pl' | 'en';
}

/** Zbyt duży plik lub za dużo plików → nasze kody błędów zamiast komunikatów multera */
@Catch(PayloadTooLargeException)
class ImportTooLargeFilter implements ExceptionFilter {
  catch(_: PayloadTooLargeException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({ statusCode: 413, code: 'PHOTO_TOO_LARGE' });
  }
}

@Controller('recipe-import')
export class RecipeImportController {
  constructor(private readonly imports: RecipeImportService) {}

  /** Czy funkcja jest włączona i ile importów zostało dziś */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.imports.status(user.id);
  }

  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseFilters(ImportTooLargeFilter)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_IMPORT_PHOTOS, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_IMPORT_PHOTOS },
    }),
  )
  import(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: ImportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.import(
      user,
      (files ?? []).map((f) => f.buffer),
      dto.lang ?? 'pl',
    );
  }
}
