import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PublishWindowService } from "@/modules/groups/services/publish-window.service";

export interface PrivateSlot {
  start: Date;
  end: Date;
}

interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Derives available Private session slots from trainer availability
 */
@Injectable()
export class PrivateOpeningsService {
  private readonly logger = new Logger(PrivateOpeningsService.name);
  private readonly facilityTimezone = "America/Chicago";

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly publishWindowService: PublishWindowService
  ) {}

  /**
   * Calculate private openings for a trainer in a date range
   *
   * Algorithm:
   * 1. Get trainer availability (working hours)
   * 2. Subtract TimeBlocks
   * 3. Subtract all trainer's Bookings (Groups + Privates)
   * 4. Subtract active holds by others
   * 5. Cut on :00 and :30 grid
   * 6. Filter to publish window
   */
  async getPrivateOpenings(params: {
    trainerId: number;
    fromDate: Date;
    toDate: Date;
    durationMinutes: number;
    publishWindowOnly?: boolean;
  }): Promise<PrivateSlot[]> {
    const { trainerId, fromDate, toDate, durationMinutes, publishWindowOnly = false } = params;

    // Step 1: Get trainer's working hours for the date range
    const workingHours = await this.getWorkingHours(trainerId, fromDate, toDate);

    // Step 2: Get busy times (TimeBlocks, Bookings, Holds)
    const busyTimes = await this.getBusyTimes(trainerId, fromDate, toDate);

    // Step 3: Subtract busy times from working hours
    const availableRanges = this.subtractBusyTimes(workingHours, busyTimes);

    // Step 4: Cut into slots on :00 and :30 grid
    const slots = this.cutIntoSlots(availableRanges, durationMinutes);

    // Step 5: Filter to publish window if needed
    const filteredSlots = publishWindowOnly
      ? slots.filter((slot) => this.publishWindowService.isInWindow(slot.start))
      : slots;

    return filteredSlots;
  }

  /**
   * Get trainer's working hours for a date range
   */
  private async getWorkingHours(
    trainerId: number,
    fromDate: Date,
    toDate: Date
  ): Promise<TimeRange[]> {
    // Get trainer's default schedule with availability
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { id: trainerId },
      include: {
        schedules: {
          include: {
            availability: {
              where: { date: null }, // Only recurring working hours, not date overrides
            },
          },
        },
      },
    });

    if (!trainer || !trainer.schedules[0]) {
      return [];
    }

    const schedule = trainer.schedules[0];
    const timeZone = schedule.timeZone || this.facilityTimezone;

    // Expand working hours across each day in the range
    const ranges: TimeRange[] = [];
    const currentDate = new Date(fromDate);

    while (currentDate <= toDate) {
      const dayOfWeek = currentDate.getDay(); // 0=Sunday, 6=Saturday

      // Find availability for this day of week
      const dayAvailability = schedule.availability.filter((a) => a.days.includes(dayOfWeek));

      for (const avail of dayAvailability) {
        // Parse time from availability (stored as Date with time components)
        const startHour = avail.startTime.getUTCHours();
        const startMinute = avail.startTime.getUTCMinutes();
        const endHour = avail.endTime.getUTCHours();
        const endMinute = avail.endTime.getUTCMinutes();

        // Create date-time in facility timezone
        const startDateTime = new Date(currentDate);
        startDateTime.setHours(startHour, startMinute, 0, 0);

        const endDateTime = new Date(currentDate);
        endDateTime.setHours(endHour, endMinute, 0, 0);

        // Only include if within the requested range
        if (endDateTime > fromDate && startDateTime < toDate) {
          ranges.push({
            start: startDateTime > fromDate ? startDateTime : fromDate,
            end: endDateTime < toDate ? endDateTime : toDate,
          });
        }
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return ranges;
  }

  /**
   * Get all busy times for a trainer (TimeBlocks, Bookings, Holds)
   */
  private async getBusyTimes(trainerId: number, fromDate: Date, toDate: Date): Promise<TimeRange[]> {
    const busyTimes: TimeRange[] = [];

    // Get TimeBlocks
    const timeBlocks = await this.prismaRead.prisma.timeBlock.findMany({
      where: {
        userId: trainerId,
        endTime: { gte: fromDate },
        startTime: { lte: toDate },
      },
    });

    busyTimes.push(...timeBlocks.map((tb) => ({ start: tb.startTime, end: tb.endTime })));

    // Get Bookings (both Groups and Privates)
    const bookings = await this.prismaRead.prisma.booking.findMany({
      where: {
        userId: trainerId,
        endTime: { gte: fromDate },
        startTime: { lte: toDate },
        status: { in: ["ACCEPTED", "PENDING"] }, // Include confirmed and pending bookings
      },
    });

    busyTimes.push(...bookings.map((b) => ({ start: b.startTime, end: b.endTime })));

    // Get active holds (SelectedSlots)
    const holds = await this.prismaRead.prisma.selectedSlots.findMany({
      where: {
        userId: trainerId,
        releaseAt: { gte: new Date() }, // Only active holds
      },
    });

    busyTimes.push(
      ...holds.map((h) => ({
        start: new Date(h.slotUtcStartDate),
        end: new Date(h.slotUtcEndDate),
      }))
    );

    return busyTimes;
  }

  /**
   * Subtract busy times from available ranges
   */
  private subtractBusyTimes(available: TimeRange[], busy: TimeRange[]): TimeRange[] {
    let result = [...available];

    for (const busyTime of busy) {
      const newResult: TimeRange[] = [];

      for (const range of result) {
        // No overlap
        if (busyTime.end <= range.start || busyTime.start >= range.end) {
          newResult.push(range);
          continue;
        }

        // Busy time completely covers range
        if (busyTime.start <= range.start && busyTime.end >= range.end) {
          // Range is completely blocked, don't add it
          continue;
        }

        // Busy time splits range
        if (busyTime.start > range.start && busyTime.end < range.end) {
          newResult.push({ start: range.start, end: busyTime.start });
          newResult.push({ start: busyTime.end, end: range.end });
          continue;
        }

        // Busy time overlaps start
        if (busyTime.start <= range.start && busyTime.end < range.end) {
          newResult.push({ start: busyTime.end, end: range.end });
          continue;
        }

        // Busy time overlaps end
        if (busyTime.start > range.start && busyTime.end >= range.end) {
          newResult.push({ start: range.start, end: busyTime.start });
          continue;
        }
      }

      result = newResult;
    }

    return result;
  }

  /**
   * Cut available ranges into slots on :00 and :30 grid
   */
  private cutIntoSlots(ranges: TimeRange[], durationMinutes: number): PrivateSlot[] {
    const slots: PrivateSlot[] = [];

    for (const range of ranges) {
      // Round start up to next :00 or :30
      const slotStart = this.roundUpToGrid(range.start);

      // Generate slots within this range
      let currentStart = new Date(slotStart);

      while (currentStart < range.end) {
        const slotEnd = new Date(currentStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

        // Only add if slot fits entirely within the available range
        if (slotEnd <= range.end) {
          slots.push({
            start: new Date(currentStart),
            end: slotEnd,
          });
        }

        // Move to next grid position (30 minutes)
        currentStart.setMinutes(currentStart.getMinutes() + 30);
      }
    }

    return slots;
  }

  /**
   * Round a time up to the next :00 or :30 boundary
   */
  private roundUpToGrid(date: Date): Date {
    const result = new Date(date);
    const minutes = result.getMinutes();

    if (minutes === 0 || minutes === 30) {
      return result;
    }

    if (minutes < 30) {
      result.setMinutes(30, 0, 0);
    } else {
      result.setHours(result.getHours() + 1, 0, 0, 0);
    }

    return result;
  }
}
