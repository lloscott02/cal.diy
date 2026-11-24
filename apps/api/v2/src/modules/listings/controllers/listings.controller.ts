import { Controller, Get, Query, UseGuards, Request } from "@nestjs/common";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { ListingsService } from "../services/listings.service";
import { ListingsQueryDto, ListingsResponseDto } from "../dto";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";

/**
 * CalZero Listings Controller
 *
 * Provides unified view of available sessions:
 * - GROUP occurrences with available seats
 * - PRIVATE openings derived from trainer availability
 */
@Controller("v2/listings")
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly prismaRead: PrismaReadService
  ) {}

  /**
   * Get available sessions (Groups + Private openings)
   *
   * GET /v2/listings?from=2024-01-15&to=2024-01-21&durationMinutes=60&trainerIds[]=123&trainerIds[]=456
   */
  @Get()
  @UseGuards(OpsJwtGuard)
  async getListings(@Query() query: ListingsQueryDto, @Request() req: any): Promise<ListingsResponseDto> {
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);
    const durationMinutes = query.durationMinutes || 60;

    // Determine role from JWT (for publish window filtering)
    const isClientRole = !req.user.isAdmin && !req.user.isTrainer;

    // Convert opsUserIds to internal trainer IDs if provided
    let trainerIds: number[] | undefined;
    if (query.trainerIds && query.trainerIds.length > 0) {
      const trainers = await this.prismaRead.prisma.user.findMany({
        where: { opsUserId: { in: query.trainerIds } },
        select: { id: true },
      });
      trainerIds = trainers.map((t) => t.id);
    }

    const items = await this.listingsService.getListings({
      fromDate,
      toDate,
      durationMinutes,
      trainerIds,
      isClientRole,
    });

    return {
      status: "success",
      data: {
        items,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
    };
  }
}
