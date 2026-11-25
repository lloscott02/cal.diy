import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import type { OccurrenceEligibilityDto, TrainerAvailabilityDto } from "../dto/coverage.dto";

/**
 * CoverageEligibilityService
 *
 * Finds trainers available to cover specific occurrences
 * Checks for conflicts: bookings, holds, time blocks, OOO
 */
@Injectable()
export class CoverageEligibilityService {
  private readonly logger = new Logger(CoverageEligibilityService.name);

  constructor(private readonly prismaRead: PrismaReadService) {}

  /**
   * Find eligible trainers for multiple occurrences
   *
   * @param occurrenceIds - Array of occurrence UIDs
   * @returns Eligibility results for each occurrence
   */
  async findEligibleTrainers(
    occurrenceIds: string[]
  ): Promise<OccurrenceEligibilityDto[]> {
    const results: OccurrenceEligibilityDto[] = [];

    for (const occurrenceId of occurrenceIds) {
      try {
        const eligibility = await this.findEligibleTrainersForOccurrence(occurrenceId);
        results.push(eligibility);
      } catch (error) {
        this.logger.error(`Error finding eligibility for ${occurrenceId}`, error);
        results.push({
          occurrenceId,
          eligibleTrainers: [],
        });
      }
    }

    return results;
  }

  /**
   * Find eligible trainers for a single occurrence
   */
  private async findEligibleTrainersForOccurrence(
    occurrenceId: string
  ): Promise<OccurrenceEligibilityDto> {
    // Step 1: Load occurrence details
    const occurrence = await this.prismaRead.prisma.booking.findUnique({
      where: { uid: occurrenceId },
      select: {
        id: true,
        uid: true,
        startTime: true,
        endTime: true,
        userId: true,
        eventType: {
          select: {
            id: true,
            length: true,
          },
        },
      },
    });

    if (!occurrence) {
      this.logger.warn(`Occurrence ${occurrenceId} not found`);
      return {
        occurrenceId,
        eligibleTrainers: [],
      };
    }

    // Step 2: Get all active trainers (excluding original trainer)
    const allTrainers = await this.prismaRead.prisma.user.findMany({
      where: {
        role: "USER", // Assuming trainers have USER role
        locked: false,
        ...(occurrence.userId != null && { id: { not: occurrence.userId } }),
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    this.logger.log(
      `Checking ${allTrainers.length} trainers for availability at ${occurrence.startTime.toISOString()}`
    );

    // Step 3: Check each trainer for conflicts
    const eligibleTrainers: TrainerAvailabilityDto[] = [];

    for (const trainer of allTrainers) {
      const hasConflict = await this.checkForConflicts(
        trainer.id,
        occurrence.startTime,
        occurrence.endTime
      );

      if (!hasConflict) {
        eligibleTrainers.push({
          trainerId: trainer.id,
          name: trainer.name || "Unknown",
          email: trainer.email,
        });
      }
    }

    this.logger.log(
      `Found ${eligibleTrainers.length} eligible trainers for occurrence ${occurrenceId}`
    );

    return {
      occurrenceId,
      eligibleTrainers,
    };
  }

  /**
   * Check if a trainer has any conflicts at the specified time
   * Checks: bookings, holds, time blocks, OOO
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
          // Booking starts during the occurrence
          {
            AND: [
              { startTime: { gte: startTime } },
              { startTime: { lt: endTime } },
            ],
          },
          // Booking ends during the occurrence
          {
            AND: [
              { endTime: { gt: startTime } },
              { endTime: { lte: endTime } },
            ],
          },
          // Booking completely contains the occurrence
          {
            AND: [
              { startTime: { lte: startTime } },
              { endTime: { gte: endTime } },
            ],
          },
        ],
      },
      select: { id: true },
    });

    if (bookingConflict) {
      return true; // Has conflict
    }

    // Check for OOO entries
    const oooConflict = await this.prismaRead.prisma.outOfOfficeEntry.findFirst({
      where: {
        userId: trainerId,
        OR: [
          // OOO overlaps with the occurrence
          {
            AND: [
              { start: { lte: endTime } },
              { end: { gte: startTime } },
            ],
          },
        ],
      },
      select: { id: true },
    });

    if (oooConflict) {
      return true; // Has conflict
    }

    // TODO: Add checks for holds and time blocks if needed
    // For now, we'll assume no conflicts if no bookings or OOO

    return false; // No conflict
  }
}
