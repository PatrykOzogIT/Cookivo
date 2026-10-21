import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import { RequireVerifiedEmail } from '../common/verified-email.guard.js';
import {
  ApplyPlanDto,
  ApplyShoppingDto,
  AskDto,
  ParseListDto,
  SubstituteDto,
  VariantDto,
} from './assistant.dto.js';
import { AssistantService } from './assistant.service.js';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Czy asystent działa i ile zadań zostało dziś */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.assistant.status(user.id);
  }

  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  ask(@CurrentUser() user: AuthUser, @Body() dto: AskDto) {
    return this.assistant.ask(user, dto);
  }

  /** "Zrób z tego wersję…" - szkic do formularza przepisu */
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('variant')
  @HttpCode(HttpStatus.OK)
  variant(@CurrentUser() user: AuthUser, @Body() dto: VariantDto) {
    return this.assistant.variant(user, dto);
  }

  /** Podyktowana / wklejona lista → pozycje do dodania (drobne zadanie) */
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('shopping/parse')
  @HttpCode(HttpStatus.OK)
  parseList(@CurrentUser() user: AuthUser, @Body() dto: ParseListDto) {
    return this.assistant.parseList(user, dto.text);
  }

  /** "Nie mam składnika" w trybie gotowania (drobne zadanie) */
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('substitute')
  @HttpCode(HttpStatus.OK)
  substitute(@CurrentUser() user: AuthUser, @Body() dto: SubstituteDto) {
    return this.assistant.substitute(user, dto);
  }

  /** Zatwierdzony plan → planer */
  @Post('plan/apply')
  @HttpCode(HttpStatus.OK)
  applyPlan(@CurrentUser() user: AuthUser, @Body() dto: ApplyPlanDto) {
    return this.assistant.applyPlan(user, dto);
  }

  /** Zatwierdzone pozycje → lista zakupów */
  @Post('shopping/apply')
  @HttpCode(HttpStatus.OK)
  applyShopping(@CurrentUser() user: AuthUser, @Body() dto: ApplyShoppingDto) {
    return this.assistant.applyShopping(user, dto);
  }
}
