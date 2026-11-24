import { Injectable, Logger } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { LoadBucketDto } from "../dto";

/**
 * LoadBucketsService
 *
 * Groups occurrences into time buckets and counts overlapping sessions:
 * - bookedMembers: enrollments with enrollmentType="membership"
 * - bookedDropIns: enrollments with enrollmentType="drop_in"
 * - walkIns: unscheduled attendees (tracked in Phase 11)
 * - total: sum of all attendees
 */
@Injectable()
export class LoadBucketsService {
  private readonly logger = new Logger(LoadBucketsService.name);

  constructor(private readonly prismaRead: PrismaReadService) {}

  /**
   * Load facility usage in time buckets
   */
  async loadBuckets(params: {
    fromDate: Date;
    toDate: Date;
    bucketMinutes: number;
  }): Promise<LoadBucketDto[]> {
    const { fromDate, toDate, bucketMinutes } = params;

    // Query all bookings in date range
    const bookings = await this.prismaRead.prisma.booking.findMany({
      where: {
        startTime: {
          gte: fromDate,
          lt: toDate,
        },
        status: {
          not: "CANCELLED",
        },
      },
      include: {
        seatsReferences: {
          select: {
            enrollmentType: true,
          },
        },
        attendees: {
          select: {
            id: true,
          },
        },
      },
    });

    // Generate buckets
    const buckets: Map<string, LoadBucketDto> = new Map();
    const bucketMs = bucketMinutes * 60 * 1000;
    
    let currentBucketStart = new Date(fromDate);
    while (currentBucketStart < toDate) {
      const bucketEnd = new Date(currentBucketStart.getTime() + bucketMs);
      const bucketKey = currentBucketStart.toISOString();
      
      buckets.set(bucketKey, {
        bucketStart: currentBucketStart.toISOString(),
        bucketEnd: bucketEnd.toISOString(),
        bookedMembers: 0,
        bookedDropIns: 0,
        walkIns: 0,
        total: 0,
      });
      
      currentBucketStart = bucketEnd;
    }

    // For each booking, count attendees in overlapping buckets
    for (const booking of bookings) {
      const bookingStart = booking.startTime.getTime();
      const bookingEnd = booking.endTime.getTime();

      // Find buckets this booking overlaps with
      for (const [bucketKey, bucket] of buckets.entries()) {
        const bucketStartTime = new Date(bucket.bucketStart).getTime();
        const bucketEndTime = new Date(bucket.bucketEnd).getTime();

        // Check if booking overlaps with bucket
        const overlaps = bookingStart < bucketEndTime && bookingEnd > bucketStartTime;

        if (overlaps) {
          // Count attendees by type
          const isGroup = !!booking.seriesId;
          
          if (isGroup) {
            // GROUP: count by enrollmentType
            for (const seat of booking.seatsReferences) {
              if (seat.enrollmentType === "membership") {
                bucket.bookedMembers++;
                bucket.total++;
              } else if (seat.enrollmentType === "drop_in") {
                bucket.bookedDropIns++;
                bucket.total++;
              }
            }
          } else {
            // PRIVATE: count all attendees as drop-ins
            const attendeeCount = booking.attendees.length;
            bucket.bookedDropIns += attendeeCount;
            bucket.total += attendeeCount;
          }
        }
      }
    }

    const bucketArray = Array.from(buckets.values());
    
    this.logger.log(
      "Generated " + bucketArray.length + " time buckets with " + bucketMinutes + " minute intervals"
    );

    return bucketArray;
  }
}
