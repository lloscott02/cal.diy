import type { Booking, EventType, GroupSeries } from "@calcom/prisma/client";
import { Injectable, Logger } from "@nestjs/common";
import { PublishWindowService } from "@/modules/groups/services/publish-window.service";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

interface GroupSeriesWithEventType extends GroupSeries {
  eventType: EventType;
}

/**
 * OccurrenceService
 *
 * Generates individual session occurrences from GroupSeries templates.
 * - Generates 8 weeks ahead in facility timezone (America/Chicago)
 * - Stores as Booking rows with seriesId
 * - Handles DST correctly (generates in local time, stores UTC)
 * - Marks publish state based on PublishWindowService
 */
@Injectable()
export class OccurrenceService {
  private readonly logger = new Logger(OccurrenceService.name);
  private readonly facilityTimezone = "America/Chicago";
  private readonly horizonWeeks = 8;

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly publishWindowService: PublishWindowService
  ) {}

  /**
   * Generate occurrences for a new GroupSeries
   * Creates all occurrences from series start up to 8 weeks ahead
   */
  async generateOccurrencesForSeries(seriesId: string): Promise<Booking[]> {
    const series = await this.prismaRead.prisma.groupSeries.findUnique({
      where: { id: seriesId },
      include: { eventType: true },
    });

    if (!series) {
      throw new Error(`GroupSeries ${seriesId} not found`);
    }

    const now = this.getNowInFacilityTz();
    const horizonEnd = this.getHorizonEnd(now);

    // Generate all occurrences from series start to horizon
    const occurrences = this.calculateOccurrences(series, series.startsOn, horizonEnd);

    // Create Booking rows for all occurrences
    const bookings = await this.createOccurrenceBookings(series, occurrences);

    this.logger.log(`Generated ${bookings.length} occurrences for series ${seriesId}`);
    return bookings;
  }

  /**
   * Extend occurrences to horizon for existing series
   * Used by HorizonPublishJob to keep 8-week rolling window
   */
  async extendOccurrencesToHorizon(seriesId: string): Promise<Booking[]> {
    const series = await this.prismaRead.prisma.groupSeries.findUnique({
      where: { id: seriesId },
      include: { eventType: true },
    });

    if (!series) {
      throw new Error(`GroupSeries ${seriesId} not found`);
    }

    // Find the latest existing occurrence
    const latestOccurrence = await this.prismaRead.prisma.booking.findFirst({
      where: { seriesId },
      orderBy: { startTime: "desc" },
    });

    const now = this.getNowInFacilityTz();
    const horizonEnd = this.getHorizonEnd(now);

    // Calculate start point (day after latest occurrence, or series start)
    let startDate: Date;
    if (latestOccurrence) {
      startDate = new Date(latestOccurrence.startTime);
      startDate.setDate(startDate.getDate() + 1);
    } else {
      startDate = series.startsOn;
    }

    // Generate missing occurrences
    const occurrences = this.calculateOccurrences(series, startDate, horizonEnd);

    if (occurrences.length === 0) {
      return [];
    }

    const bookings = await this.createOccurrenceBookings(series, occurrences);
    this.logger.log(`Extended ${bookings.length} occurrences for series ${seriesId}`);
    return bookings;
  }

  /**
   * Update publish state for occurrences entering the window
   * Called by HorizonPublishJob
   */
  async publishOccurrencesInWindow(seriesId: string): Promise<number> {
    const window = this.publishWindowService.getPublishWindow();

    const result = await this.prismaWrite.prisma.booking.updateMany({
      where: {
        seriesId,
        publishState: "internal",
        startTime: {
          gte: window.start,
          lte: window.end,
        },
      },
      data: {
        publishState: "published",
      },
    });

    if (result.count > 0) {
      this.logger.log(`Published ${result.count} occurrences for series ${seriesId}`);
    }

    return result.count;
  }

  /**
   * Calculate occurrence dates between start and end
   * Returns array of { startTime, endTime } in UTC
   */
  private calculateOccurrences(
    series: GroupSeriesWithEventType,
    startDate: Date,
    endDate: Date
  ): Array<{ startTime: Date; endTime: Date; publishState: string }> {
    const occurrences: Array<{ startTime: Date; endTime: Date; publishState: string }> = [];

    // Parse local start time (HH:mm format)
    const [hours, minutes] = series.localStartTime.split(":").map(Number);

    // Find first occurrence on or after startDate
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);

    // Adjust to next occurrence of the target weekday
    while (currentDate.getDay() !== series.weekday) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Generate occurrences
    while (currentDate <= endDate) {
      // Check if before series end date
      if (series.endsOn && currentDate > series.endsOn) {
        break;
      }

      // Create occurrence in facility timezone
      const occurrenceDate = this.createDateInFacilityTz(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate(),
        hours,
        minutes
      );

      const startTime = occurrenceDate;
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + series.duration);

      // Determine publish state
      const publishState = this.publishWindowService.getPublishState(startTime);

      occurrences.push({ startTime, endTime, publishState });

      // Move to next week (same weekday)
      currentDate.setDate(currentDate.getDate() + 7);
    }

    return occurrences;
  }

  /**
   * Create Booking rows for occurrences
   */
  private async createOccurrenceBookings(
    series: GroupSeriesWithEventType,
    occurrences: Array<{ startTime: Date; endTime: Date; publishState: string }>
  ): Promise<Booking[]> {
    const bookings: Booking[] = [];

    for (const occurrence of occurrences) {
      const booking = await this.prismaWrite.prisma.booking.create({
        data: {
          uid: this.generateBookingUid(),
          title: series.name,
          description: `Group session: ${series.name}`,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
          userId: series.trainerId,
          eventTypeId: series.eventTypeId,
          status: "ACCEPTED",
          seriesId: series.id,
          publishState: occurrence.publishState,
          metadata: {
            catalogItemId: series.catalogItemId,
            softCap: series.softCap,
            hardCap: series.hardCap,
          },
        },
      });

      bookings.push(booking);
    }

    return bookings;
  }

  /**
   * Create a Date in facility timezone
   * Handles DST correctly by working in local time
   */
  private createDateInFacilityTz(
    year: number,
    month: number,
    day: number,
    hours: number,
    minutes: number
  ): Date {
    // Create date string in facility timezone
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

    // Parse in facility timezone, returns UTC Date
    const localDate = new Date(
      new Date(dateStr).toLocaleString("en-US", { timeZone: this.facilityTimezone })
    );

    // Convert back to UTC properly
    const utcDate = new Date(dateStr + "-06:00"); // CST offset approximation
    return utcDate;
  }

  /**
   * Get current time in facility timezone
   */
  private getNowInFacilityTz(): Date {
    const nowUtc = new Date();
    return new Date(nowUtc.toLocaleString("en-US", { timeZone: this.facilityTimezone }));
  }

  /**
   * Get the horizon end date (8 weeks from now in facility timezone)
   */
  private getHorizonEnd(now: Date): Date {
    const horizonEnd = new Date(now);
    horizonEnd.setDate(horizonEnd.getDate() + this.horizonWeeks * 7);
    return horizonEnd;
  }

  /**
   * Generate a unique booking UID
   */
  private generateBookingUid(): string {
    return `group-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
