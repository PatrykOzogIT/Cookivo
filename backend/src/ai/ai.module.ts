import { Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service.js';
import { VisionService } from './vision.service.js';

/** Wspólny odczyt zdjęć przez AI (import przepisów i paragonów) i limity użycia */
@Module({
  providers: [VisionService, AiUsageService],
  exports: [VisionService, AiUsageService],
})
export class AiModule {}
