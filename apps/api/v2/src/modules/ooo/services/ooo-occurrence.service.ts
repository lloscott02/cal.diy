import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";

/**
 * OooOccurrenceService
 *
 * Flags group occurrences when a trainer is OOO
 * Emits COVERAGE_NEEDED events for published occurrences
 */
@Injectable()
export class OooOccurrenceService {
  private readonly logger = new Logger(OooOccurrenceService.name);

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Flag occurrences affected by OOO entry
   *
   * @param trainerId - ID of the trainer going OOO
   * @param startDate - OOO start date
   * @param endDate - OOO end date
   * @returns Array of affected occurrence IDs
   */
  async flagAffectedOccurrences(
    trainerId: number,
    startDate: Date,
    endDate: Date
  ): Promise<string[]> {
    this.logger.log(
      `Flagging occurrences for trainer ${trainerId} from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );

    // Step 1: Query all occurrences for trainer in date range
    const occurrences = await this.prismaRead.prisma.booking.findMany({
      where: {
        userId: trainerId,
        startTime: { gte: startDate },
        endTime: { lte: endDate },
        seriesId: { not: null }, // Groups only
        status: "ACCEPTED",
      },
      include: {
        _count: {
          select: {
            seatsReferences: true, // Count enrolled athletes
          },
        },
      },
    });

    this.logger.log(`Found ${occurrences.length} potential occurrences to flag`);

    // Step 2: Filter to occurrences with enrollments
    const occurrencesWithEnrollments = occurrences.filter((occ) => occ._count.seatsReferences > 0);

    this.logger.log(
      `${occurrencesWithEnrollments.length} occurrences have enrollments and need coverage`
    );

    const affectedIds: string[] = [];

    // Step 3: Flag each occurrence and emit events for published ones
    for (const occurrence of occurrencesWithEnrollments) {
      try {
        // Update needsCoverage flag
        await this.prismaWrite.prisma.booking.update({
          where: { id: occurrence.id },
          data: { needsCoverage: true },
        });

        affectedIds.push(occurrence.uid);

        // Emit event only if published
        if (occurrence.publishState === "published") {
          await this.outboxService.createEvent("COVERAGE_NEEDED", {
            occurrenceId: occurrence.uid,
            trainerId,
            startTime: occurrence.startTime.toISOString(),
            endTime: occurrence.endTime.toISOString(),
            seriesId: occurrence.seriesId,
            enrollmentCount: occurrence._count.seatsReferences,
          });

          this.logger.log(`Emitted COVERAGE_NEEDED for published occurrence ${occurrence.uid}`);
        } else {
          this.logger.log(
            `Flagged internal occurrence ${occurrence.uid} - will emit when published`
          );
        }
      } catch (error) {
        this.logger.error(`Error flagging occurrence ${occurrence.uid}`, error);
        // Continue processing other occurrences
      }
    }

    this.logger.log(`Flagged ${affectedIds.length} occurrences for coverage`);

    return affectedIds;
  }

  /**
   * Clear coverage flags from occurrences when OOO is deleted
   *
   * @param trainerId - ID of the trainer
   * @param startDate - OOO start date
   * @param endDate - OOO end date
   * @returns Number of occurrences cleared
   */
  async clearCoverageFlags(
    trainerId: number,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    this.logger.log(
      `Clearing coverage flags for trainer ${trainerId} from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );

    const result = await this.prismaWrite.prisma.booking.updateMany({
      where: {
        userId: trainerId,
        startTime: { gte: startDate },
        endTime: { lte: endDate },
        seriesId: { not: null },
        needsCoverage: true,
        reassignById: null, // Only clear if not yet reassigned
      },
      data: {
        needsCoverage: false,
      },
    });

    this.logger.log(`Cleared ${result.count} occurrence coverage flags`);

    return result.count;
  }

  /**
   * Emit COVERAGE_NEEDED events for newly published occurrences
   * Called by HorizonPublishJob after publishing occurrences
   *
   * @param seriesId - Group series ID
   * @returns Number of events emitted
   */
  async emitCoverageEventsForPublished(seriesId: string): Promise<number> {
    // Find all newly published occurrences with needsCoverage=true
    const occurrences = await this.prismaRead.prisma.booking.findMany({
      where: {
        seriesId,
        publishState: "published",
        needsCoverage: true,
      },
      include: {
        _count: {
          select: {
            seatsReferences: true,
          },
        },
      },
    });

    let eventsEmitted = 0;

    for (const occurrence of occurrences) {
      try {
        await this.outboxService.createEvent("COVERAGE_NEEDED", {
          occurrenceId: occurrence.uid,
          trainerId: occurrence.userId,
          startTime: occurrence.startTime.toISOString(),
          endTime: occurrence.endTime.toISOString(),
          seriesId: occurrence.seriesId,
          enrollmentCount: occurrence._count.seatsReferences,
        });

        eventsEmitted++;
      } catch (error) {
        this.logger.error(`Error emitting COVERAGE_NEEDED for ${occurrence.uid}`, error);
      }
    }

    if (eventsEmitted > 0) {
      this.logger.log(`Emitted ${eventsEmitted} COVERAGE_NEEDED events for series ${seriesId}`);
    }

    return eventsEmitted;
  }
}
