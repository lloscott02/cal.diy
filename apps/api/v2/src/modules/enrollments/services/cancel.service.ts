import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";

/**
 * CancelService
 *
 * Handles enrollment cancellations with policy enforcement:
 * - Calculates timing: ≥24h = "on_time", <24h = "late"
 * - Computes policy outcome based on timing + trainerCaused
 * - Frees seat (GROUP) or marks cancelled (PRIVATE)
 * - Emits ENROLLMENT_CANCELLED event
 */
@Injectable()
export class CancelService {
  private readonly logger = new Logger(CancelService.name);
  private readonly cancelWindowHours = 24;

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Cancel an enrollment
   */
  async cancelEnrollment(params: {
    enrollmentId: string;
    athleteId: string;
    trainerCaused?: boolean;
    isAdminOrTrainer?: boolean;
    cancellationReason?: string;
  }): Promise<{
    kind: "GROUP" | "PRIVATE";
    timingTag: "on_time" | "late";
    trainerCaused: boolean;
    policyOutcome: "full_refund" | "credit" | "no_refund";
  }> {
    const { enrollmentId, athleteId, trainerCaused = false, isAdminOrTrainer = false, cancellationReason } = params;

    // Only trainer/admin can set trainerCaused flag
    if (trainerCaused && !isAdminOrTrainer) {
      throw new HttpException(
        "Only trainer or admin can set trainerCaused flag",
        HttpStatus.FORBIDDEN
      );
    }

    // Try to find as GROUP enrollment (BookingSeat)
    const seat = await this.prismaRead.prisma.bookingSeat.findUnique({
      where: { id: parseInt(enrollmentId) },
      include: {
        booking: true,
        attendee: true,
      },
    });

    if (seat) {
      return await this.cancelGroupEnrollment(seat, athleteId, trainerCaused, cancellationReason);
    }

    // Try to find as PRIVATE enrollment (Booking)
    const booking = await this.prismaRead.prisma.booking.findUnique({
      where: { id: parseInt(enrollmentId) },
      include: {
        attendees: true,
      },
    });

    if (booking && booking.seriesId === null) {
      // Must be a PRIVATE booking (no seriesId)
      return await this.cancelPrivateEnrollment(booking, athleteId, trainerCaused, cancellationReason);
    }

    throw new HttpException("Enrollment not found", HttpStatus.NOT_FOUND);
  }

  /**
   * Cancel GROUP enrollment
   */
  private async cancelGroupEnrollment(
    seat: any,
    athleteId: string,
    trainerCaused: boolean,
    cancellationReason?: string
  ) {
    // Verify athlete ownership
    if (seat.athleteId !== athleteId) {
      throw new HttpException("Athlete ID mismatch", HttpStatus.FORBIDDEN);
    }

    const booking = seat.booking;
    const sessionStartTime = booking.startTime;

    // Calculate timing and policy
    const timingTag = this.calculateTimingTag(sessionStartTime);
    const policyOutcome = this.calculatePolicyOutcome(timingTag, trainerCaused);

    // Delete BookingSeat and Attendee (frees the seat)
    await this.prismaWrite.prisma.$transaction(async (tx) => {
      await tx.bookingSeat.delete({
        where: { id: seat.id },
      });

      await tx.attendee.delete({
        where: { id: seat.attendeeId },
      });

      // Update booking with cancellation metadata
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          timingTag,
          trainerCaused,
          policyOutcome,
          cancellationReason: cancellationReason || null,
        },
      });
    });

    // Emit ENROLLMENT_CANCELLED event
    await this.outboxService.createEvent("ENROLLMENT_CANCELLED", {
      enrollmentId: seat.id.toString(),
      kind: "GROUP",
      athleteId,
      occurrenceId: booking.id.toString(),
      seriesId: booking.seriesId,
      timingTag,
      trainerCaused,
      policyOutcome,
      cancellationReason,
      cancelledAt: new Date().toISOString(),
    });

    this.logger.log(
      `Cancelled GROUP enrollment ${seat.id} for athlete ${athleteId} (${timingTag}, ${policyOutcome})`
    );

    return {
      kind: "GROUP" as const,
      timingTag,
      trainerCaused,
      policyOutcome,
    };
  }

  /**
   * Cancel PRIVATE enrollment
   */
  private async cancelPrivateEnrollment(
    booking: any,
    athleteId: string,
    trainerCaused: boolean,
    cancellationReason?: string
  ) {
    // Verify athlete ownership
    const attendee = booking.attendees.find((a: any) => a.athleteId === athleteId);
    if (!attendee) {
      throw new HttpException("Athlete ID mismatch", HttpStatus.FORBIDDEN);
    }

    const sessionStartTime = booking.startTime;

    // Calculate timing and policy
    const timingTag = this.calculateTimingTag(sessionStartTime);
    const policyOutcome = this.calculatePolicyOutcome(timingTag, trainerCaused);

    // Update booking to CANCELLED status
    await this.prismaWrite.prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        timingTag,
        trainerCaused,
        policyOutcome,
        cancellationReason: cancellationReason || null,
      },
    });

    // Emit ENROLLMENT_CANCELLED event
    await this.outboxService.createEvent("ENROLLMENT_CANCELLED", {
      enrollmentId: booking.id.toString(),
      kind: "PRIVATE",
      athleteId,
      bookingId: booking.id.toString(),
      timingTag,
      trainerCaused,
      policyOutcome,
      cancellationReason,
      cancelledAt: new Date().toISOString(),
    });

    this.logger.log(
      `Cancelled PRIVATE enrollment ${booking.id} for athlete ${athleteId} (${timingTag}, ${policyOutcome})`
    );

    return {
      kind: "PRIVATE" as const,
      timingTag,
      trainerCaused,
      policyOutcome,
    };
  }

  /**
   * Calculate timing tag based on cancellation time
   */
  private calculateTimingTag(sessionStartTime: Date): "on_time" | "late" {
    const now = new Date();
    const hoursUntilSession = (sessionStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    return hoursUntilSession >= this.cancelWindowHours ? "on_time" : "late";
  }

  /**
   * Calculate policy outcome based on timing and who caused cancellation
   */
  private calculatePolicyOutcome(
    timingTag: "on_time" | "late",
    trainerCaused: boolean
  ): "full_refund" | "credit" | "no_refund" {
    // Trainer caused = always full refund
    if (trainerCaused) {
      return "full_refund";
    }

    // Client caused: depends on timing
    if (timingTag === "on_time") {
      return "credit"; // ≥24h notice → credit
    } else {
      return "no_refund"; // <24h notice → no refund
    }
  }
}
