import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import { MAX_PHOTO_BYTES, PhotosService } from './photos.service.js';

/** Zbyt duży plik → nasz kod błędu zamiast domyślnego komunikatu multera. */
@Catch(PayloadTooLargeException)
class PhotoTooLargeFilter implements ExceptionFilter {
  catch(_: PayloadTooLargeException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({ statusCode: 413, code: 'PHOTO_TOO_LARGE' });
  }
}

@Controller('photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @RequireVerifiedEmail()
  @Post()
  @UseFilters(PhotoTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException({ code: 'PHOTO_INVALID' });
    return this.photos.upload(file.buffer, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.photos.remove(id, user);
  }
}
