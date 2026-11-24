import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { BuildingViewItemDto } from "../dto";

/**
 * BuildingViewService
 *
 * Provides building-wide activity view with role-based filtering:
 * - Trainer viewing others: time + trainer + headcount only
 * - Trainer viewing own: full roster IDs
 * - Admin: everything with full detail
 */
@Injectable()
export class BuildingViewService {
  private readonly logger = new Logger(BuildingViewService.name);

  constructor(private readonly prismaRead: PrismaReadService) {}

  /**
   * Get building view for date range with role-based filtering
   */
  async getBuildingView(params: {
    fromDate: Date;
    toDate: Date;
    requestingTrainerOpsId?: string; // The trainer making the request (if trainer)
    isAdmin: boolean;
  }): Promise<BuildingViewItemDto[]> {
    const { fromDate, toDate, requestingTrainerOpsId, isAdmin } = params;

    // Query all bookings in date range that are confirmed (not cancelled)
    const bookings = await this.prismaRead.prisma.booking.findMany({
      where: {
        startTime: {
          gte: fromDate,
          lt: toDate,
        },
        status: {
          not: "CANCELLED",
        },
      },
      include: {
        user: {
          select: {
            id: true,
            opsUserId: true,
          },
        },
        attendees: {
          select: {
            athleteId: true,
          },
        },
        seatsReferences: {
          select: {
            athleteId: true,
            enrollmentType: true,
          },
        },
        groupSeries: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        startTime: "asc",
      },
    });

    // Transform bookings to DTOs with role-based filtering
    const items: BuildingViewItemDto[] = bookings.map((booking) => {
      const isGroup = !!booking.seriesId;
      const isOwnSession = booking.user?.opsUserId === requestingTrainerOpsId;
      const shouldShowFullDetail = isAdmin || isOwnSession;

      // Get roster athlete IDs (excluding nulls)
      const rosterAthleteIds = isGroup
        ? booking.seatsReferences
            .map((seat) => seat.athleteId)
            .filter((id): id is string => id !== null)
        : booking.attendees
            .map((attendee) => attendee.athleteId)
            .filter((id): id is string => id !== null);

      const headcount = rosterAthleteIds.length;

      const baseItem: BuildingViewItemDto = {
        kind: isGroup ? "GROUP" : "PRIVATE",
        occurrenceId: booking.id.toString(),
        trainerId: booking.userId?.toString() || "",
        trainerOpsId: booking.user?.opsUserId || "",
        startsAt: booking.startTime.toISOString(),
        endsAt: booking.endTime.toISOString(),
      };

      // Add conditional fields based on permissions
      if (shouldShowFullDetail) {
        // Full detail: include roster
        return {
          ...baseItem,
          rosterAthleteIds,
          athleteLabel: booking.athleteLabel || undefined,
          seriesId: booking.seriesId || undefined,
          seriesName: booking.groupSeries?.name || undefined,
        };
      } else {
        // Limited view: only headcount
        return {
          ...baseItem,
          headcount,
        };
      }
    });

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();
    this.logger.log(
      "Retrieved " + items.length + " sessions for building view (" + fromIso + " to " + toIso + ")"
    );

    return items;
  }
}
