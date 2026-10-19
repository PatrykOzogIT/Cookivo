import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import { MAX_PHOTO_BYTES } from '../photos/photos.service.js';
import { ReceiptAnalyzeDto, ReceiptCommitDto } from './receipt-import.dto.js';
import { MAX_RECEIPT_PHOTOS, ReceiptImportService } from './receipt-import.service.js';

/** Zbyt duży plik lub za dużo plików → nasze kody błędów zamiast komunikatów multera */
@Catch(PayloadTooLargeException)
class ReceiptTooLargeFilter implements ExceptionFilter {
  catch(_: PayloadTooLargeException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({ statusCode: 413, code: 'PHOTO_TOO_LARGE' });
  }
}

@Controller('receipt-import')
export class ReceiptImportController {
  constructor(private readonly imports: ReceiptImportService) {}

  /** Czy funkcja jest włączona i ile odczytów zostało dziś */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.imports.status(user.id);
  }

  /** Odczyt paragonu → szkic do sprawdzenia (nic nie zapisuje w lodówce ani cenniku) */
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseFilters(ReceiptTooLargeFilter)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_RECEIPT_PHOTOS, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_RECEIPT_PHOTOS },
    }),
  )
  analyze(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: ReceiptAnalyzeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.analyze(
      user,
      (files ?? []).map((f) => f.buffer),
      dto.lang ?? 'pl',
    );
  }

  /** Zatwierdzenie sprawdzonego szkicu - ponowne wywołanie zwraca ten sam wynik */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiptCommitDto,
  ) {
    return this.imports.commit(user, id, dto);
  }
}
