import { Module } from "@nestjs/common";
import { EnrollmentsController } from "./controllers/enrollments.controller";
import { CancelService } from "./services/cancel.service";
import { RescheduleService } from "./services/reschedule.service";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { HoldsModule } from "@/modules/holds/holds.module";

@Module({
  imports: [PrismaModule, JwtModule, OutboxModule, HoldsModule],
  controllers: [EnrollmentsController],
  providers: [CancelService, RescheduleService],
  exports: [CancelService, RescheduleService],
})
export class EnrollmentsModule {}
