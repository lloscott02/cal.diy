import { Module } from "@nestjs/common";
import { BuildingController } from "./controllers/building.controller";
import { BuildingViewService } from "./services/building-view.service";
import { LoadBucketsService } from "./services/load-buckets.service";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [BuildingController],
  providers: [BuildingViewService, LoadBucketsService],
  exports: [BuildingViewService, LoadBucketsService],
})
export class BuildingModule {}
