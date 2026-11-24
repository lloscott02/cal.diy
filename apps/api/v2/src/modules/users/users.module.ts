import { EventTypesModule_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/event-types.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { TokensModule } from "@/modules/tokens/tokens.module";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { UsersService } from "@/modules/users/services/users.service";
import { UsersRepository } from "@/modules/users/users.repository";
import { TrainersController } from "@/modules/users/controllers/trainers.controller";
import { Module } from "@nestjs/common";

@Module({
  imports: [PrismaModule, EventTypesModule_2024_06_14, TokensModule, JwtModule],
  providers: [UsersRepository, UsersService],
  controllers: [TrainersController],
  exports: [UsersRepository, UsersService],
})
export class UsersModule {}
