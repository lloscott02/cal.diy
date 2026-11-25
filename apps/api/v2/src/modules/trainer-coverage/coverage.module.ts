import { Module } from "@nestjs/common";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { CoverageController } from "./controllers/coverage.controller";
import { CoverageEligibilityService } from "./services/coverage-eligibility.service";
import { OccurrenceReassignService } from "./services/occurrence-reassign.service";

/**
 * CoverageModule
 *
 * Coverage and trainer reassignment features for CalZero.
 */
@Module({
  imports: [PrismaModule, JwtModule, OutboxModule],
  controllers: [CoverageController],
  providers: [CoverageEligibilityService, OccurrenceReassignService],
  exports: [CoverageEligibilityService, OccurrenceReassignService],
})
export class CoverageModule {}
