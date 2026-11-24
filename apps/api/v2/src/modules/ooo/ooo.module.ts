import { Module } from "@nestjs/common";
import { OooController } from "./controllers/ooo.controller";
import { UserOOOService } from "./services/ooo.service";
import { OooOccurrenceService } from "./services/ooo-occurrence.service";
import { UserOOORepository } from "./repositories/ooo.repository";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { UsersModule } from "@/modules/users/users.module";

@Module({
  imports: [PrismaModule, JwtModule, OutboxModule, UsersModule],
  controllers: [OooController],
  providers: [UserOOOService, OooOccurrenceService, UserOOORepository],
  exports: [UserOOOService, OooOccurrenceService],
})
export class OooModule {}
