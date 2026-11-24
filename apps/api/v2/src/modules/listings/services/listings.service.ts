import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrivateOpeningsService } from "./private-openings.service";
import { ListingItemDto, GroupListingDto, PrivateListingDto } from "../dto";

/**
 * Merges Groups and Private openings into a unified listings view
 */
@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly privateOpeningsService: PrivateOpeningsService
  ) {}

  /**
   * Get unified listings (Groups + Privates)
   */
  async getListings(params: {
    fromDate: Date;
    toDate: Date;
    durationMinutes: number;
    trainerIds?: number[];
    isClientRole: boolean;
  }): Promise<ListingItemDto[]> {
    const { fromDate, toDate, durationMinutes, trainerIds, isClientRole } = params;

    // Get Group occurrences and Private openings in parallel
    const [groupListings, privateListings] = await Promise.all([
      this.getGroupListings(fromDate, toDate, trainerIds, isClientRole),
      this.getPrivateListings(fromDate, toDate, durationMinutes, trainerIds, isClientRole),
    ]);

    // Merge and sort by start time
    const allListings: ListingItemDto[] = [...groupListings, ...privateListings];
    allListings.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    return allListings;
  }

  /**
   * Get Group occurrences with available seats
   */
  private async getGroupListings(
    fromDate: Date,
    toDate: Date,
    trainerIds?: number[],
    isClientRole?: boolean
  ): Promise<GroupListingDto[]> {
    // Build where clause
    const where: any = {
      startTime: { gte: fromDate },
      endTime: { lte: toDate },
      seriesId: { not: null }, // Only Group occurrences
    };

    // Filter by trainers if specified
    if (trainerIds && trainerIds.length > 0) {
      where.userId = { in: trainerIds };
    }

    // Client role: only show published
    // Admin/Trainer role: show both published and internal (for manual booking)
    if (isClientRole) {
      where.publishState = "published";
    }

    // Get Group occurrences with series and event type info
    const occurrences = await this.prismaRead.prisma.booking.findMany({
      where,
      include: {
        groupSeries: {
          include: {
            eventType: true,
          },
        },
        _count: {
          select: {
            seatsReferences: true, // Count booked seats
          },
        },
        user: {
          select: {
            id: true,
            opsUserId: true,
          },
        },
      },
      orderBy: { startTime: "asc" },
    });

    // Map to GroupListingDto
    const listings: GroupListingDto[] = [];

    for (const occ of occurrences) {
      if (!occ.groupSeries) continue;

      const series = occ.groupSeries;
      const eventType = series.eventType;

      // Calculate available seats
      const bookedSeats = occ._count.seatsReferences;
      const availableSeats = series.hardCap - bookedSeats;

      // Only include if there are available seats
      if (availableSeats > 0) {
        listings.push({
          kind: "GROUP",
          occurrenceId: occ.id.toString(),
          seriesId: series.id,
          catalogItemId: series.catalogItemId,
          trainerId: occ.user.id.toString(),
          trainerOpsId: occ.user.opsUserId || "",
          startsAt: occ.startTime.toISOString(),
          endsAt: occ.endTime.toISOString(),
          availableSeats,
          softCap: series.softCap,
          hardCap: series.hardCap,
        });
      }
    }

    return listings;
  }

  /**
   * Get Private openings for trainers
   */
  private async getPrivateListings(
    fromDate: Date,
    toDate: Date,
    durationMinutes: number,
    trainerIds?: number[],
    isClientRole?: boolean
  ): Promise<PrivateListingDto[]> {
    // Get trainers to query
    let trainersToQuery: { id: number; opsUserId: string | null }[];

    if (trainerIds && trainerIds.length > 0) {
      trainersToQuery = await this.prismaRead.prisma.user.findMany({
        where: {
          id: { in: trainerIds },
          status: "active",
        },
        select: {
          id: true,
          opsUserId: true,
        },
      });
    } else {
      // Get all active trainers
      trainersToQuery = await this.prismaRead.prisma.user.findMany({
        where: {
          status: "active",
          // Only users with schedules
          schedules: {
            some: {},
          },
        },
        select: {
          id: true,
          opsUserId: true,
        },
      });
    }

    // Get private openings for each trainer in parallel
    const trainerOpeningsPromises = trainersToQuery.map((trainer) =>
      this.privateOpeningsService
        .getPrivateOpenings({
          trainerId: trainer.id,
          fromDate,
          toDate,
          durationMinutes,
          publishWindowOnly: isClientRole,
        })
        .then((slots) => ({ trainer, slots }))
    );

    const trainerOpenings = await Promise.all(trainerOpeningsPromises);

    // Flatten and map to PrivateListingDto
    const listings: PrivateListingDto[] = [];

    for (const { trainer, slots } of trainerOpenings) {
      for (const slot of slots) {
        // Create opening key for idempotent holds: "trainerId_startTime_duration"
        const openingKey = `${trainer.id}_${slot.start.toISOString()}_${durationMinutes}`;

        listings.push({
          kind: "PRIVATE",
          openingKey,
          trainerId: trainer.id.toString(),
          trainerOpsId: trainer.opsUserId || "",
          startsAt: slot.start.toISOString(),
          endsAt: slot.end.toISOString(),
          durationMinutes,
        });
      }
    }

    return listings;
  }
}
