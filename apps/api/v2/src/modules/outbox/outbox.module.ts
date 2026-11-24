import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { OutboxRepository } from "@/modules/outbox/outbox.repository";
import { OutboxController } from "@/modules/outbox/controllers/outbox.controller";
import { AuditClientService } from "@/modules/outbox/services/audit-client.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import { OutboxWorkerService } from "@/modules/outbox/services/outbox-worker.service";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { JwtModule } from "@/modules/jwt/jwt.module";

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), JwtModule],
  controllers: [OutboxController],
  providers: [OutboxRepository, OutboxService, OutboxWorkerService, AuditClientService],
  exports: [OutboxRepository, OutboxService, AuditClientService],
})
export class OutboxModule {}
