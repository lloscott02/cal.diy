import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { GroupsController } from "./controllers/groups.controller";
import { HorizonPublishJobService } from "./services/horizon-publish-job.service";
import { OccurrenceService } from "./services/occurrence.service";
import { PublishWindowService } from "./services/publish-window.service";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { OooModule } from "@/modules/ooo/ooo.module";

@Module({
  imports: [PrismaModule, JwtModule, OutboxModule, OooModule, ScheduleModule.forRoot()],
  controllers: [GroupsController],
  providers: [OccurrenceService, PublishWindowService, HorizonPublishJobService],
  exports: [OccurrenceService, PublishWindowService],
})
export class GroupsModule {}
