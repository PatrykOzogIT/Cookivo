import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { PantryItemDto, PantryUpdateDto } from './pantry.dto.js';
import { PantryService } from './pantry.service.js';

@Controller('pantry')
export class PantryController {
  constructor(private readonly pantry: PantryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.pantry.list(user.id);
  }

  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: PantryItemDto) {
    return this.pantry.upsert(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PantryUpdateDto,
  ) {
    return this.pantry.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.pantry.remove(user.id, id);
  }
}
