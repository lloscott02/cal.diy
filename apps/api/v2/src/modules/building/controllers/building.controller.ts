import { Controller, Get, Query, UseGuards, Request } from "@nestjs/common";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { BuildingViewService } from "../services/building-view.service";
import { LoadBucketsService } from "../services/load-buckets.service";
import { BuildingQueryDto, BuildingViewResponseDto, LoadBucketsQueryDto, LoadBucketsResponseDto } from "../dto";

/**
 * CalZero Building Controller
 *
 * Provides building-wide activity views:
 * - GET /building - All sessions with role-based filtering
 * - GET /building/load - Time buckets with attendance counts
 */
@Controller("v2/building")
export class BuildingController {
  constructor(
    private readonly buildingViewService: BuildingViewService,
    private readonly loadBucketsService: LoadBucketsService
  ) {}

  /**
   * Get building view with role-based filtering
   *
   * GET /v2/building?from&to
   */
  @Get()
  @UseGuards(OpsJwtGuard)
  async getBuildingView(
    @Query() query: BuildingQueryDto,
    @Request() req: any
  ): Promise<BuildingViewResponseDto> {
    const isAdmin = req.user.isAdmin || false;
    const isTrainer = req.user.isTrainer || false;
    const requestingTrainerOpsId = isTrainer ? req.user.sub : undefined;

    const items = await this.buildingViewService.getBuildingView({
      fromDate: new Date(query.from),
      toDate: new Date(query.to),
      requestingTrainerOpsId,
      isAdmin,
    });

    return { items };
  }

  /**
   * Get facility load in time buckets
   *
   * GET /v2/building/load?from&to&bucketMinutes
   */
  @Get("load")
  @UseGuards(OpsJwtGuard)
  async getLoadBuckets(
    @Query() query: LoadBucketsQueryDto,
    @Request() req: any
  ): Promise<LoadBucketsResponseDto> {
    const buckets = await this.loadBucketsService.loadBuckets({
      fromDate: new Date(query.from),
      toDate: new Date(query.to),
      bucketMinutes: query.bucketMinutes || 30,
    });

    return { buckets };
  }
}
