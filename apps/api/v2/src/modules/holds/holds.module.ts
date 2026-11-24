import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HoldsController } from "./controllers/holds.controller";
import { HoldService } from "./services/hold.service";
import { ConfirmService } from "./services/confirm.service";
import { ReleaseService } from "./services/release.service";
import { HoldExpiryJobService } from "./services/hold-expiry-job.service";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";

@Module({
  imports: [PrismaModule, JwtModule, OutboxModule, ScheduleModule.forRoot()],
  controllers: [HoldsController],
  providers: [HoldService, ConfirmService, ReleaseService, HoldExpiryJobService],
  exports: [HoldService, ConfirmService, ReleaseService],
})
export class HoldsModule {}
