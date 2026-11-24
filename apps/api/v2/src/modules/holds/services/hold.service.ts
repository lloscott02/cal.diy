import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { randomUUID } from "crypto";

/**
 * HoldService
 *
 * Creates temporary slot reservations (holds) for clients
 * - 10 minute TTL
 * - Counts against capacity
 * - Prevents double-booking
 */
@Injectable()
export class HoldService {
  private readonly logger = new Logger(HoldService.name);
  private readonly holdTTLMinutes = 10;

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService
  ) {}

  /**
   * Create a hold for a GROUP occurrence
   */
  async createGroupHold(params: {
    occurrenceId: string;
    athleteId: string;
  }): Promise<{ holdId: string; expiresAt: Date; startTime: Date; endTime: Date }> {
    const { occurrenceId, athleteId } = params;

    // Get the occurrence (Booking with seriesId)
    const occurrence = await this.prismaRead.prisma.booking.findUnique({
      where: { id: parseInt(occurrenceId) },
      include: {
        groupSeries: {
          include: {
            eventType: true,
          },
        },
        _count: {
          select: {
            seatsReferences: true, // Count confirmed seats
          },
        },
      },
    });

    if (!occurrence || !occurrence.groupSeries) {
      throw new HttpException("Group occurrence not found", HttpStatus.NOT_FOUND);
    }

    // Check if occurrence is in the past
    if (occurrence.startTime < new Date()) {
      throw new HttpException("Cannot hold past occurrences", HttpStatus.BAD_REQUEST);
    }

    // Check capacity: hardCap - confirmed seats - active holds
    const series = occurrence.groupSeries;
    const confirmedSeats = occurrence._count.seatsReferences;

    // Count active holds for this occurrence
    const activeHolds = await this.prismaRead.prisma.selectedSlots.count({
      where: {
        userId: occurrence.userId!,
        slotUtcStartDate: occurrence.startTime,
        slotUtcEndDate: occurrence.endTime,
        releaseAt: { gte: new Date() }, // Still active
      },
    });

    const availableCapacity = series.hardCap - confirmedSeats - activeHolds;

    if (availableCapacity <= 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "No capacity available",
          availableSeats: 0,
          hardCap: series.hardCap,
        },
        HttpStatus.CONFLICT
      );
    }

    // Create hold (SelectedSlots row)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.holdTTLMinutes);

    const uid = randomUUID();

    const hold = await this.prismaWrite.prisma.selectedSlots.create({
      data: {
        eventTypeId: occurrence.eventTypeId!,
        userId: occurrence.userId!,
        slotUtcStartDate: occurrence.startTime,
        slotUtcEndDate: occurrence.endTime,
        uid,
        releaseAt: expiresAt,
        isSeat: true,
        athleteId,
      },
    });

    this.logger.log(
      `Created GROUP hold ${hold.id} for athlete ${athleteId} on occurrence ${occurrenceId}`
    );

    return {
      holdId: hold.id.toString(),
      expiresAt,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
    };
  }

  /**
   * Create a hold for a PRIVATE opening
   */
  async createPrivateHold(params: {
    trainerId: number;
    startTime: Date;
    durationMinutes: number;
    athleteId: string;
  }): Promise<{ holdId: string; expiresAt: Date; startTime: Date; endTime: Date }> {
    const { trainerId, startTime, durationMinutes, athleteId } = params;

    // Calculate end time
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + durationMinutes);

    // Check if slot is in the past
    if (startTime < new Date()) {
      throw new HttpException("Cannot hold past time slots", HttpStatus.BAD_REQUEST);
    }

    // Check if trainer exists and is active
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { id: trainerId },
      select: { id: true, status: true },
    });

    if (!trainer || trainer.status !== "active") {
      throw new HttpException("Trainer not found or inactive", HttpStatus.NOT_FOUND);
    }

    // Check if slot is still available (no bookings, no active holds)
    // 1. Check for existing bookings
    const existingBooking = await this.prismaRead.prisma.booking.findFirst({
      where: {
        userId: trainerId,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
        status: { in: ["ACCEPTED", "PENDING"] },
      },
    });

    if (existingBooking) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "Time slot no longer available",
          reason: "booking_exists",
        },
        HttpStatus.CONFLICT
      );
    }

    // 2. Check for active holds
    const existingHold = await this.prismaRead.prisma.selectedSlots.findFirst({
      where: {
        userId: trainerId,
        slotUtcStartDate: { lt: endTime },
        slotUtcEndDate: { gt: startTime },
        releaseAt: { gte: new Date() }, // Still active
      },
    });

    if (existingHold) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "Time slot no longer available",
          reason: "hold_exists",
        },
        HttpStatus.CONFLICT
      );
    }

    // 3. Check for TimeBlocks
    const timeBlock = await this.prismaRead.prisma.timeBlock.findFirst({
      where: {
        userId: trainerId,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });

    if (timeBlock) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "Time slot blocked by trainer",
          reason: "time_block",
        },
        HttpStatus.CONFLICT
      );
    }

    // Create hold
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.holdTTLMinutes);

    const uid = randomUUID();

    // Get a dummy eventTypeId (we'll need to create a default one or use a constant)
    // For now, using 0 as placeholder - in production, should have a default EventType for private sessions
    const hold = await this.prismaWrite.prisma.selectedSlots.create({
      data: {
        eventTypeId: 0, // TODO: Use default private session EventType
        userId: trainerId,
        slotUtcStartDate: startTime,
        slotUtcEndDate: endTime,
        uid,
        releaseAt: expiresAt,
        isSeat: false,
        athleteId,
      },
    });

    this.logger.log(
      `Created PRIVATE hold ${hold.id} for athlete ${athleteId} with trainer ${trainerId}`
    );

    return {
      holdId: hold.id.toString(),
      expiresAt,
      startTime,
      endTime,
    };
  }

  /**
   * Get hold by ID
   */
  async getHold(holdId: string) {
    const hold = await this.prismaRead.prisma.selectedSlots.findUnique({
      where: { id: parseInt(holdId) },
    });

    if (!hold) {
      throw new HttpException("Hold not found", HttpStatus.NOT_FOUND);
    }

    // Check if expired
    if (hold.releaseAt < new Date()) {
      throw new HttpException("Hold has expired", HttpStatus.GONE);
    }

    return hold;
  }
}
