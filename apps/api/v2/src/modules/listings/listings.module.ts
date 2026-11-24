import { Module } from "@nestjs/common";
import { ListingsController } from "./controllers/listings.controller";
import { ListingsService } from "./services/listings.service";
import { PrivateOpeningsService } from "./services/private-openings.service";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { GroupsModule } from "@/modules/groups/groups.module";

@Module({
  imports: [PrismaModule, JwtModule, GroupsModule],
  controllers: [ListingsController],
  providers: [ListingsService, PrivateOpeningsService],
  exports: [ListingsService, PrivateOpeningsService],
})
export class ListingsModule {}
