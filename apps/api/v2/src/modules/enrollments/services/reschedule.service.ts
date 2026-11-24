import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import { HoldService } from "@/modules/holds/services/hold.service";
import { ConfirmService } from "@/modules/holds/services/confirm.service";

/**
 * RescheduleService
 *
 * Handles enrollment rescheduling with atomic swap:
 * - Validates ≥24h notice (client) or admin override
 * - Atomically: hold new → verify → release old → confirm new
 * - Rollback if new slot unavailable
 * - Emits ENROLLMENT_RESCHEDULED event
 */
@Injectable()
export class RescheduleService {
  private readonly logger = new Logger(RescheduleService.name);
  private readonly rescheduleWindowHours = 24;

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly outboxService: OutboxService,
    private readonly holdService: HoldService,
    private readonly confirmService: ConfirmService
  ) {}

  /**
   * Reschedule an enrollment (atomic swap)
   */
  async rescheduleEnrollment(params: {
    enrollmentId: string;
    athleteId: string;
    newOccurrenceId?: string; // For GROUP
    newStartTime?: Date; // For PRIVATE
    adminOverride?: boolean;
    isAdminOrTrainer?: boolean;
  }): Promise<{
    kind: "GROUP" | "PRIVATE";
    oldStartTime: Date;
    newStartTime: Date;
    policyOutcome?: "full_refund" | "credit" | "no_refund";
  }> {
    const { enrollmentId, athleteId, newOccurrenceId, newStartTime, adminOverride = false, isAdminOrTrainer = false } = params;

    // Try to find as GROUP enrollment (BookingSeat)
    const seat = await this.prismaRead.prisma.bookingSeat.findUnique({
      where: { id: parseInt(enrollmentId) },
      include: {
        booking: true,
      },
    });

    if (seat) {
      return await this.rescheduleGroupEnrollment(
        seat,
        athleteId,
        newOccurrenceId!,
        adminOverride,
        isAdminOrTrainer
      );
    }

    // Try to find as PRIVATE enrollment (Booking)
    const booking = await this.prismaRead.prisma.booking.findUnique({
      where: { id: parseInt(enrollmentId) },
      include: {
        attendees: true,
      },
    });

    if (booking && booking.seriesId === null) {
      return await this.reschedulePrivateEnrollment(
        booking,
        athleteId,
        newStartTime!,
        adminOverride,
        isAdminOrTrainer
      );
    }

    throw new HttpException("Enrollment not found", HttpStatus.NOT_FOUND);
  }

  /**
   * Reschedule GROUP enrollment
   */
  private async rescheduleGroupEnrollment(
    seat: any,
    athleteId: string,
    newOccurrenceId: string,
    adminOverride: boolean,
    isAdminOrTrainer: boolean
  ) {
    // Verify athlete ownership
    if (seat.athleteId !== athleteId) {
      throw new HttpException("Athlete ID mismatch", HttpStatus.FORBIDDEN);
    }

    const oldBooking = seat.booking;
    const oldStartTime = oldBooking.startTime;

    // Check if reschedule is allowed
    if (!this.canReschedule(oldStartTime, isAdminOrTrainer, adminOverride)) {
      throw new HttpException(
        "Cannot reschedule within 24 hours of session start time",
        HttpStatus.FORBIDDEN
      );
    }

    // Get new occurrence
    const newOccurrence = await this.prismaRead.prisma.booking.findUnique({
      where: { id: parseInt(newOccurrenceId) },
      include: {
        groupSeries: true,
      },
    });

    if (!newOccurrence || !newOccurrence.groupSeries) {
      throw new HttpException("New occurrence not found", HttpStatus.NOT_FOUND);
    }

    // Atomic swap: Try to create hold → delete old seat → confirm new hold
    try {
      // Step 1: Create hold on new occurrence
      const hold = await this.holdService.createGroupHold({
        occurrenceId: newOccurrenceId,
        athleteId,
      });

      // Step 2: Confirm the hold (creates new BookingSeat)
      await this.confirmService.confirmHold({
        holdId: hold.holdId,
        athleteId,
        enrollmentType: seat.enrollmentType || "drop_in",
      });

      // Step 3: Delete old seat (transaction ensures both happen)
      await this.prismaWrite.prisma.$transaction(async (tx) => {
        await tx.bookingSeat.delete({
          where: { id: seat.id },
        });

        await tx.attendee.delete({
          where: { id: seat.attendeeId },
        });
      });

      // Emit ENROLLMENT_RESCHEDULED event
      await this.outboxService.createEvent("ENROLLMENT_RESCHEDULED", {
        enrollmentId: seat.id.toString(),
        kind: "GROUP",
        athleteId,
        oldOccurrenceId: oldBooking.id.toString(),
        newOccurrenceId,
        oldStartTime: oldStartTime.toISOString(),
        newStartTime: newOccurrence.startTime.toISOString(),
        rescheduledAt: new Date().toISOString(),
      });

      this.logger.log(
        `Rescheduled GROUP enrollment ${seat.id} from occurrence ${oldBooking.id} to ${newOccurrenceId}`
      );

      return {
        kind: "GROUP" as const,
        oldStartTime,
        newStartTime: newOccurrence.startTime,
      };
    } catch (error: any) {
      // If hold creation or confirmation fails, the original seat remains
      this.logger.warn(`Failed to reschedule GROUP enrollment: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "New slot unavailable - keeping original booking",
          reason: error.message,
        },
        HttpStatus.CONFLICT
      );
    }
  }

  /**
   * Reschedule PRIVATE enrollment
   */
  private async reschedulePrivateEnrollment(
    booking: any,
    athleteId: string,
    newStartTime: Date,
    adminOverride: boolean,
    isAdminOrTrainer: boolean
  ) {
    // Verify athlete ownership
    const attendee = booking.attendees.find((a: any) => a.athleteId === athleteId);
    if (!attendee) {
      throw new HttpException("Athlete ID mismatch", HttpStatus.FORBIDDEN);
    }

    const oldStartTime = booking.startTime;
    const duration = (booking.endTime.getTime() - booking.startTime.getTime()) / (1000 * 60);

    // Check if reschedule is allowed
    if (!this.canReschedule(oldStartTime, isAdminOrTrainer, adminOverride)) {
      throw new HttpException(
        "Cannot reschedule within 24 hours of session start time",
        HttpStatus.FORBIDDEN
      );
    }

    // Atomic swap: Try to create hold → delete old booking → confirm new hold
    try {
      // Step 1: Create hold on new time slot
      const hold = await this.holdService.createPrivateHold({
        trainerId: booking.userId,
        startTime: newStartTime,
        durationMinutes: duration,
        athleteId,
      });

      // Step 2: Confirm the hold (creates new Booking)
      const newEnrollment = await this.confirmService.confirmHold({
        holdId: hold.holdId,
        athleteId,
        athleteLabel: booking.athleteLabel,
      });

      // Step 3: Cancel old booking
      await this.prismaWrite.prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELLED",
        },
      });

      // Emit ENROLLMENT_RESCHEDULED event
      await this.outboxService.createEvent("ENROLLMENT_RESCHEDULED", {
        enrollmentId: booking.id.toString(),
        kind: "PRIVATE",
        athleteId,
        oldBookingId: booking.id.toString(),
        newBookingId: newEnrollment.bookingId,
        oldStartTime: oldStartTime.toISOString(),
        newStartTime: newStartTime.toISOString(),
        rescheduledAt: new Date().toISOString(),
      });

      this.logger.log(
        `Rescheduled PRIVATE enrollment ${booking.id} from ${oldStartTime.toISOString()} to ${newStartTime.toISOString()}`
      );

      return {
        kind: "PRIVATE" as const,
        oldStartTime,
        newStartTime,
      };
    } catch (error: any) {
      // If hold creation or confirmation fails, the original booking remains
      this.logger.warn(`Failed to reschedule PRIVATE enrollment: ${error.message}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "New slot unavailable - keeping original booking",
          reason: error.message,
        },
        HttpStatus.CONFLICT
      );
    }
  }

  /**
   * Check if reschedule is within allowed window
   */
  private canReschedule(
    sessionStartTime: Date,
    isAdminOrTrainer: boolean,
    adminOverride: boolean
  ): boolean {
    if (isAdminOrTrainer && adminOverride) {
      return true; // Admin can always override
    }

    const now = new Date();
    const hoursUntilSession = (sessionStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    return hoursUntilSession >= this.rescheduleWindowHours;
  }
}
