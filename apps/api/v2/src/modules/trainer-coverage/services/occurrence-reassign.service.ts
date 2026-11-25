import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import type { ReassignmentDto, ReassignResultDto } from "../dto/coverage.dto";

/**
 * OccurrenceReassignService
 *
 * Reassigns occurrences to substitute trainers
 * Handles conflict checking and event emission
 */
@Injectable()
export class OccurrenceReassignService {
  private readonly logger = new Logger(OccurrenceReassignService.name);

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Reassign multiple occurrences to substitute trainers
   *
   * @param requests - Array of reassignment requests
   * @param actorId - ID of user performing the reassignment
   * @returns Results with successes and failures
   */
  async reassignOccurrences(
    requests: ReassignmentDto[],
    actorId: number
  ): Promise<{ successes: ReassignResultDto[]; failures: ReassignResultDto[] }> {
    const successes: ReassignResultDto[] = [];
    const failures: ReassignResultDto[] = [];

    for (const request of requests) {
      try {
        await this.reassignSingleOccurrence(
          request.occurrenceId,
          request.toTrainerId,
          actorId
        );

        successes.push({
          occurrenceId: request.occurrenceId,
          toTrainerId: request.toTrainerId,
        });

        this.logger.log(
          `Successfully reassigned ${request.occurrenceId} to trainer ${request.toTrainerId}`
        );
      } catch (error) {
        failures.push({
          occurrenceId: request.occurrenceId,
          toTrainerId: request.toTrainerId,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        this.logger.error(
          `Failed to reassign ${request.occurrenceId} to trainer ${request.toTrainerId}`,
          error
        );
      }
    }

    this.logger.log(
      `Reassignment complete: ${successes.length} succeeded, ${failures.length} failed`
    );

    return { successes, failures };
  }

  /**
   * Reassign a single occurrence to a substitute trainer
   */
  private async reassignSingleOccurrence(
    occurrenceId: string,
    toTrainerId: number,
    actorId: number
  ): Promise<void> {
    // Step 1: Load occurrence and verify needsCoverage
    const occurrence = await this.prismaRead.prisma.booking.findUnique({
      where: { uid: occurrenceId },
      select: {
        id: true,
        uid: true,
        userId: true,
        startTime: true,
        endTime: true,
        needsCoverage: true,
        seriesId: true,
        eventTypeId: true,
      },
    });

    if (!occurrence) {
      throw new Error(`Occurrence ${occurrenceId} not found`);
    }

    if (!occurrence.needsCoverage) {
      throw new Error(`Occurrence ${occurrenceId} does not need coverage`);
    }

    // Step 2: Check for conflicts with the new trainer
    const hasConflict = await this.checkForConflicts(
      toTrainerId,
      occurrence.startTime,
      occurrence.endTime
    );

    if (hasConflict) {
      throw new Error(
        `Trainer ${toTrainerId} has a conflict at ${occurrence.startTime.toISOString()}`
      );
    }

    // Step 3: Update the booking
    const originalTrainerId = occurrence.userId;

    await this.prismaWrite.prisma.booking.update({
      where: { id: occurrence.id },
      data: {
        userId: toTrainerId,
        needsCoverage: false,
        reassignById: actorId,
        reassignReason: "coverage_ooo",
      },
    });

    // Step 4: Emit SESSION_TRAINER_CHANGED event
    await this.outboxService.createEvent("SESSION_TRAINER_CHANGED", {
      occurrenceId: occurrence.uid,
      fromTrainerId: originalTrainerId,
      toTrainerId,
      reason: "coverage_ooo",
      seriesId: occurrence.seriesId,
      eventTypeId: occurrence.eventTypeId,
      startTime: occurrence.startTime.toISOString(),
      endTime: occurrence.endTime.toISOString(),
      reassignedBy: actorId,
    });
  }

  /**
   * Check if a trainer has any conflicts at the specified time
   * Checks: bookings, OOO
   */
  private async checkForConflicts(
    trainerId: number,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    // Check for overlapping bookings (ACCEPTED status)
    const bookingConflict = await this.prismaRead.prisma.booking.findFirst({
      where: {
        userId: trainerId,
        status: "ACCEPTED",
        OR: [
          {
            AND: [{ startTime: { gte: startTime } }, { startTime: { lt: endTime } }],
          },
          {
            AND: [{ endTime: { gt: startTime } }, { endTime: { lte: endTime } }],
          },
          {
            AND: [{ startTime: { lte: startTime } }, { endTime: { gte: endTime } }],
          },
        ],
      },
      select: { id: true },
    });

    if (bookingConflict) {
      return true;
    }

    // Check for OOO entries
    const oooConflict = await this.prismaRead.prisma.outOfOfficeEntry.findFirst({
      where: {
        userId: trainerId,
        OR: [
          {
            AND: [{ start: { lte: endTime } }, { end: { gte: startTime } }],
          },
        ],
      },
      select: { id: true },
    });

    if (oooConflict) {
      return true;
    }

    return false;
  }
}
