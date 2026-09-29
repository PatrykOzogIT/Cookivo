import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';

@Module({
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
