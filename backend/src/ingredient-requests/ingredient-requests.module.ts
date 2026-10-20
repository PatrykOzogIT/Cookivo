import { Module } from '@nestjs/common';
import { ReceiptImportModule } from '../receipt-import/receipt-import.module.js';
import { IngredientRequestsController } from './ingredient-requests.controller.js';
import { IngredientRequestsService } from './ingredient-requests.service.js';

/** Prośby o dodanie składnika do bazy (MailService z globalnego MailModule) */
@Module({
  imports: [ReceiptImportModule],
  controllers: [IngredientRequestsController],
  providers: [IngredientRequestsService],
})
export class IngredientRequestsModule {}
