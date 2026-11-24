import { Injectable } from "@nestjs/common";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

/**
 * CalZero: Availability Edit Guard
 *
 * Prevents editing trainer availability if it would strand existing bookings.
 * A booking is "stranded" if it has ≥1 enrolled athlete and falls outside
 * the trainer's new availability.
 *
 * This ensures trainers can't accidentally orphan sessions by changing their hours.
 */
@Injectable()
export class AvailabilityEditGuardService {
  constructor(private readonly prismaRead: PrismaReadService) {}

  /**
   * Check if proposed availability changes would strand any bookings
   *
   * @param trainerId - The trainer whose availability is being edited
   * @param proposedChanges - The new availability (working hours or TimeBlock)
   * @returns List of stranded sessions (empty array = safe to proceed)
   */
  async checkForStrandedSessions(input: {
    trainerId: number;
    changeType: "working_hours" | "time_block";
    // For working hours: new weekly schedule
    workingHours?: Array<{
      days: number[];
      startTime: string; // HH:mm format
      endTime: string;
    }>;
    // For TimeBlock: new block to add
    timeBlock?: {
      startTime: Date;
      endTime: Date;
    };
  }): Promise<StrandedSession[]> {
    const { trainerId, changeType, workingHours, timeBlock } = input;

    // Get all future bookings for this trainer with ≥1 athlete
    const futureBookingsWithAthletes = await this.getFutureBookingsWithAthletes(trainerId);

    if (futureBookingsWithAthletes.length === 0) {
      // No bookings, no strandings possible
      return [];
    }

    const strandedSessions: StrandedSession[] = [];

    if (changeType === "working_hours" && workingHours) {
      // Check each booking against new working hours
      for (const booking of futureBookingsWithAthletes) {
        const isWithinNewHours = this.isBookingWithinWorkingHours(booking, workingHours);
        if (!isWithinNewHours) {
          strandedSessions.push({
            bookingId: booking.id,
            startTime: booking.startTime,
            endTime: booking.endTime,
            type: this.getBookingType(booking),
            athleteCount: booking._count.attendees + booking._count.seatsReferences,
          });
        }
      }
    } else if (changeType === "time_block" && timeBlock) {
      // Check if TimeBlock overlaps any booking
      for (const booking of futureBookingsWithAthletes) {
        const overlaps = this.doTimesOverlap(
          booking.startTime,
          booking.endTime,
          timeBlock.startTime,
          timeBlock.endTime
        );
        if (overlaps) {
          strandedSessions.push({
            bookingId: booking.id,
            startTime: booking.startTime,
            endTime: booking.endTime,
            type: this.getBookingType(booking),
            athleteCount: booking._count.attendees + booking._count.seatsReferences,
          });
        }
      }
    }

    return strandedSessions;
  }

  /**
   * Get all future bookings for a trainer that have at least one athlete enrolled
   */
  private async getFutureBookingsWithAthletes(trainerId: number) {
    const now = new Date();

    return this.prismaRead.prisma.booking.findMany({
      where: {
        userId: trainerId,
        startTime: { gte: now },
        status: { not: "CANCELLED" },
        OR: [
          // Has attendees (Privates)
          { attendees: { some: {} } },
          // Has seats (Groups)
          { seatsReferences: { some: {} } },
        ],
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        eventTypeId: true,
        _count: {
          select: {
            attendees: true,
            seatsReferences: true,
          },
        },
        eventType: {
          select: {
            title: true,
            seatsPerTimeSlot: true,
          },
        },
      },
    });
  }

  /**
   * Check if a booking falls within proposed working hours
   */
  private isBookingWithinWorkingHours(
    booking: any,
    workingHours: Array<{ days: number[]; startTime: string; endTime: string }>
  ): boolean {
    const bookingStart = dayjs(booking.startTime);
    const bookingDay = bookingStart.day(); // 0=Sunday, 6=Saturday

    // Find working hours for this day of week
    const hoursForDay = workingHours.find((wh) => wh.days.includes(bookingDay));

    if (!hoursForDay) {
      // No working hours on this day
      return false;
    }

    // Parse working hours (HH:mm format)
    const [startHour, startMin] = hoursForDay.startTime.split(":").map(Number);
    const [endHour, endMin] = hoursForDay.endTime.split(":").map(Number);

    const workingStart = bookingStart.hour(startHour).minute(startMin).second(0);
    const workingEnd = bookingStart.hour(endHour).minute(endMin).second(0);

    const bookingEnd = dayjs(booking.endTime);

    // Booking must be entirely within working hours
    return bookingStart.isSameOrAfter(workingStart) && bookingEnd.isSameOrBefore(workingEnd);
  }

  /**
   * Check if two time ranges overlap
   */
  private doTimesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    const s1 = start1.getTime();
    const e1 = end1.getTime();
    const s2 = start2.getTime();
    const e2 = end2.getTime();

    // Overlap if: start1 < end2 AND start2 < end1
    return s1 < e2 && s2 < e1;
  }

  /**
   * Determine booking type (Group or Private)
   */
  private getBookingType(booking: any): "group" | "private" {
    if (booking.eventType?.seatsPerTimeSlot && booking.eventType.seatsPerTimeSlot > 1) {
      return "group";
    }
    return "private";
  }
}

export interface StrandedSession {
  bookingId: number;
  startTime: Date;
  endTime: Date;
  type: "group" | "private";
  athleteCount: number;
}
