import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import { randomUUID } from "crypto";

/**
 * ConfirmService
 *
 * Confirms holds and creates enrollments
 * - Verifies hold validity
 * - Creates Booking (Private) or BookingSeat (Group)
 * - Creates Attendee
 * - Emits ENROLLMENT_CONFIRMED event
 */
@Injectable()
export class ConfirmService {
  private readonly logger = new Logger(ConfirmService.name);

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Confirm a hold and create enrollment
   */
  async confirmHold(params: {
    holdId: string;
    athleteId: string;
    enrollmentType?: "drop_in" | "membership";
    athleteLabel?: string;
  }): Promise<{ enrollmentId: string; bookingId?: string; seatId?: string; kind: "GROUP" | "PRIVATE" }> {
    const { holdId, athleteId, enrollmentType, athleteLabel } = params;

    // Get hold and verify
    const hold = await this.prismaRead.prisma.selectedSlots.findUnique({
      where: { id: parseInt(holdId) },
    });

    if (!hold) {
      throw new HttpException("Hold not found", HttpStatus.NOT_FOUND);
    }

    // Verify athleteId matches
    if (hold.athleteId !== athleteId) {
      throw new HttpException("Athlete ID mismatch", HttpStatus.FORBIDDEN);
    }

    // Check if hold expired
    if (hold.releaseAt < new Date()) {
      throw new HttpException("Hold has expired", HttpStatus.GONE);
    }

    // Determine if GROUP or PRIVATE based on isSeat flag
    if (hold.isSeat) {
      // GROUP enrollment
      return await this.confirmGroupHold(hold, athleteId, enrollmentType || "drop_in");
    } else {
      // PRIVATE enrollment
      return await this.confirmPrivateHold(hold, athleteId, athleteLabel);
    }
  }

  /**
   * Confirm GROUP hold - create BookingSeat
   */
  private async confirmGroupHold(
    hold: any,
    athleteId: string,
    enrollmentType: "drop_in" | "membership"
  ) {
    // Find the occurrence (Booking)
    const occurrence = await this.prismaRead.prisma.booking.findFirst({
      where: {
        userId: hold.userId,
        startTime: hold.slotUtcStartDate,
        endTime: hold.slotUtcEndDate,
        seriesId: { not: null }, // Must be a group occurrence
      },
      include: {
        groupSeries: true,
      },
    });

    if (!occurrence || !occurrence.groupSeries) {
      throw new HttpException("Group occurrence not found", HttpStatus.NOT_FOUND);
    }

    // Execute confirmation in transaction
    const result = await this.prismaWrite.prisma.$transaction(async (tx) => {
      // Create Attendee
      const attendee = await tx.attendee.create({
        data: {
          email: `athlete-${athleteId}@placeholder.com`, // Placeholder - should come from Ops
          name: `Athlete ${athleteId}`,
          timeZone: "America/Chicago",
          bookingId: occurrence.id,
          athleteId,
        },
      });

      // Create BookingSeat
      const seat = await tx.bookingSeat.create({
        data: {
          referenceUid: randomUUID(),
          bookingId: occurrence.id,
          attendeeId: attendee.id,
          athleteId,
          enrollmentType,
        },
      });

      // Delete the hold
      await tx.selectedSlots.delete({
        where: { id: hold.id },
      });

      return { attendee, seat };
    });

    // Check if soft cap reached
    const totalSeats = await this.prismaRead.prisma.bookingSeat.count({
      where: { bookingId: occurrence.id },
    });

    const series = occurrence.groupSeries;
    if (totalSeats >= series.softCap && totalSeats - 1 < series.softCap) {
      // Just crossed soft cap threshold
      await this.outboxService.createEvent("GROUP_SOFT_CAP_REACHED", {
        seriesId: series.id,
        occurrenceId: occurrence.id.toString(),
        softCap: series.softCap,
        hardCap: series.hardCap,
        currentSeats: totalSeats,
      });
    }

    // Emit ENROLLMENT_CONFIRMED event
    await this.outboxService.createEvent("ENROLLMENT_CONFIRMED", {
      holdId: hold.id.toString(),
      enrollmentId: result.seat.id.toString(),
      kind: "GROUP",
      athleteId,
      enrollmentType,
      occurrenceId: occurrence.id.toString(),
      seriesId: series.id,
      trainerId: occurrence.userId,
      startsAt: occurrence.startTime.toISOString(),
      endsAt: occurrence.endTime.toISOString(),
      confirmedAt: new Date().toISOString(),
    });

    this.logger.log(`Confirmed GROUP enrollment ${result.seat.id} for athlete ${athleteId}`);

    return {
      enrollmentId: result.seat.id.toString(),
      seatId: result.seat.id.toString(),
      bookingId: occurrence.id.toString(),
      kind: "GROUP" as const,
    };
  }

  /**
   * Confirm PRIVATE hold - create Booking
   */
  private async confirmPrivateHold(hold: any, athleteId: string, athleteLabel?: string) {
    // Execute confirmation in transaction
    const result = await this.prismaWrite.prisma.$transaction(async (tx) => {
      // Create Booking for Private session
      const booking = await tx.booking.create({
        data: {
          uid: randomUUID(),
          userId: hold.userId,
          title: `Private Session - ${athleteLabel || athleteId}`,
          startTime: hold.slotUtcStartDate,
          endTime: hold.slotUtcEndDate,
          status: "ACCEPTED",
          athleteLabel: athleteLabel || athleteId,
        },
      });

      // Create Attendee
      const attendee = await tx.attendee.create({
        data: {
          email: `athlete-${athleteId}@placeholder.com`, // Placeholder - should come from Ops
          name: athleteLabel || `Athlete ${athleteId}`,
          timeZone: "America/Chicago",
          bookingId: booking.id,
          athleteId,
        },
      });

      // Delete the hold
      await tx.selectedSlots.delete({
        where: { id: hold.id },
      });

      return { booking, attendee };
    });

    // Emit ENROLLMENT_CONFIRMED event
    await this.outboxService.createEvent("ENROLLMENT_CONFIRMED", {
      holdId: hold.id.toString(),
      enrollmentId: result.booking.id.toString(),
      kind: "PRIVATE",
      athleteId,
      athleteLabel: athleteLabel || athleteId,
      bookingId: result.booking.id.toString(),
      trainerId: hold.userId,
      startsAt: hold.slotUtcStartDate.toISOString(),
      endsAt: hold.slotUtcEndDate.toISOString(),
      confirmedAt: new Date().toISOString(),
    });

    this.logger.log(`Confirmed PRIVATE enrollment ${result.booking.id} for athlete ${athleteId}`);

    return {
      enrollmentId: result.booking.id.toString(),
      bookingId: result.booking.id.toString(),
      kind: "PRIVATE" as const,
    };
  }
}
