import { Module } from "@nestjs/common";
import { SchedulesController } from "./controllers/schedules.controller";
import { AvailabilityEditGuardService } from "./services/availability-edit-guard.service";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";

@Module({
  imports: [PrismaModule, JwtModule, OutboxModule],
  controllers: [SchedulesController],
  providers: [AvailabilityEditGuardService],
  exports: [AvailabilityEditGuardService],
})
export class SchedulesModule {}
