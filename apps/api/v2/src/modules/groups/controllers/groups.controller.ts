import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { OccurrenceService } from "@/modules/groups/services/occurrence.service";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

/**
 * CalZero Groups Controller
 *
 * Manages recurring group class series.
 * All endpoints require Ops-issued JWT authentication.
 */
@Controller("v2/groups")
export class GroupsController {
  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly occurrenceService: OccurrenceService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Create a new group series
   *
   * POST /v2/groups
   */
  @Post()
  @UseGuards(OpsJwtGuard)
  async createGroup(@Body() body: CreateGroupDto) {
    // Find trainer by opsUserId
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { opsUserId: body.trainerId },
      select: { id: true },
    });

    if (!trainer) {
      throw new HttpException("Trainer not found", HttpStatus.NOT_FOUND);
    }

    // Find or create EventType for this group
    // CalZero uses EventType.seatsPerTimeSlot for capacity
    let eventType = await this.prismaRead.prisma.eventType.findFirst({
      where: {
        userId: trainer.id,
        slug: `group-${body.catalogItemId}`,
      },
    });

    if (!eventType) {
      eventType = await this.prismaWrite.prisma.eventType.create({
        data: {
          title: body.name,
          slug: `group-${body.catalogItemId}`,
          length: body.duration,
          userId: trainer.id,
          seatsPerTimeSlot: body.hardCap, // Use hardCap for capacity
          hidden: true, // Hidden from public booking page
        },
      });
    }

    // Create GroupSeries
    const series = await this.prismaWrite.prisma.groupSeries.create({
      data: {
        trainerId: trainer.id,
        eventTypeId: eventType.id,
        name: body.name,
        weekday: body.weekday,
        localStartTime: body.localStartTime,
        duration: body.duration,
        softCap: body.softCap,
        hardCap: body.hardCap,
        startsOn: new Date(body.startsOn),
        endsOn: body.endsOn ? new Date(body.endsOn) : null,
        catalogItemId: body.catalogItemId,
      },
    });

    // Generate occurrences (8 weeks ahead)
    await this.occurrenceService.generateOccurrencesForSeries(series.id);

    // Emit GROUP_CREATED event
    await this.outboxService.createEvent("GROUP_CREATED", {
      seriesId: series.id,
      trainerId: trainer.id,
      opsUserId: body.trainerId,
      name: series.name,
      weekday: series.weekday,
      localStartTime: series.localStartTime,
      duration: series.duration,
      softCap: series.softCap,
      hardCap: series.hardCap,
      startsOn: series.startsOn.toISOString(),
      endsOn: series.endsOn?.toISOString(),
      catalogItemId: series.catalogItemId,
      createdAt: series.createdAt.toISOString(),
    });

    return {
      status: "success",
      data: {
        seriesId: series.id,
        ...series,
      },
    };
  }

  /**
   * Get group series details
   *
   * GET /v2/groups/:id
   */
  @Get(":id")
  @UseGuards(OpsJwtGuard)
  async getGroup(@Param("id") id: string) {
    const series = await this.prismaRead.prisma.groupSeries.findUnique({
      where: { id },
      include: {
        trainer: {
          select: {
            id: true,
            opsUserId: true,
            name: true,
            email: true,
          },
        },
        eventType: {
          select: {
            id: true,
            title: true,
            seatsPerTimeSlot: true,
          },
        },
      },
    });

    if (!series) {
      throw new HttpException("Group series not found", HttpStatus.NOT_FOUND);
    }

    // Get occurrence count
    const occurrenceCount = await this.prismaRead.prisma.booking.count({
      where: { seriesId: id },
    });

    return {
      status: "success",
      data: {
        ...series,
        occurrenceCount,
      },
    };
  }

  /**
   * Edit group series from a date forward
   *
   * POST /v2/groups/:id/edit
   */
  @Post(":id/edit")
  @UseGuards(OpsJwtGuard)
  async editGroup(@Param("id") id: string, @Body() body: EditGroupDto) {
    const series = await this.prismaRead.prisma.groupSeries.findUnique({
      where: { id },
    });

    if (!series) {
      throw new HttpException("Group series not found", HttpStatus.NOT_FOUND);
    }

    // Update series template
    const updated = await this.prismaWrite.prisma.groupSeries.update({
      where: { id },
      data: {
        name: body.name ?? series.name,
        localStartTime: body.localStartTime ?? series.localStartTime,
        duration: body.duration ?? series.duration,
        softCap: body.softCap ?? series.softCap,
        hardCap: body.hardCap ?? series.hardCap,
      },
    });

    // Update future occurrences from effectiveDate forward
    const effectiveDate = new Date(body.effectiveDate);

    await this.prismaWrite.prisma.booking.updateMany({
      where: {
        seriesId: id,
        startTime: { gte: effectiveDate },
      },
      data: {
        title: body.name ?? series.name,
        // Note: Can't update startTime/endTime here - would need to recreate
        overriddenFields: {
          softCap: body.softCap,
          hardCap: body.hardCap,
        },
      },
    });

    // Emit GROUP_UPDATED event
    await this.outboxService.createEvent("GROUP_UPDATED", {
      seriesId: id,
      effectiveDate: effectiveDate.toISOString(),
      changes: {
        name: body.name,
        localStartTime: body.localStartTime,
        duration: body.duration,
        softCap: body.softCap,
        hardCap: body.hardCap,
      },
      updatedAt: new Date().toISOString(),
    });

    return {
      status: "success",
      data: updated,
    };
  }

  /**
   * End a group series
   *
   * POST /v2/groups/:id/end
   */
  @Post(":id/end")
  @UseGuards(OpsJwtGuard)
  async endGroup(@Param("id") id: string, @Body() body: EndGroupDto) {
    const series = await this.prismaRead.prisma.groupSeries.findUnique({
      where: { id },
    });

    if (!series) {
      throw new HttpException("Group series not found", HttpStatus.NOT_FOUND);
    }

    const endDate = new Date(body.endDate);

    // Update series end date
    await this.prismaWrite.prisma.groupSeries.update({
      where: { id },
      data: { endsOn: endDate },
    });

    // Cancel future occurrences after end date
    await this.prismaWrite.prisma.booking.updateMany({
      where: {
        seriesId: id,
        startTime: { gt: endDate },
      },
      data: {
        publishState: "cancelled",
        status: "CANCELLED",
      },
    });

    // Emit SERIES_ENDED event
    await this.outboxService.createEvent("SERIES_ENDED", {
      seriesId: id,
      endDate: endDate.toISOString(),
      endedAt: new Date().toISOString(),
    });

    return {
      status: "success",
      message: "Group series ended successfully",
    };
  }

  /**
   * Enroll athlete as member of a series
   *
   * POST /v2/series/:id/enroll
   */
  @Post("/series/:id/enroll")
  @UseGuards(OpsJwtGuard)
  async enrollInSeries(@Param("id") seriesId: string, @Body() body: EnrollSeriesDto) {
    const series = await this.prismaRead.prisma.groupSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      throw new HttpException("Group series not found", HttpStatus.NOT_FOUND);
    }

    const startsOn = new Date(body.startsOn);
    const endsOn = body.endsOn ? new Date(body.endsOn) : null;

    // Create SeriesEnrollment record
    const enrollment = await this.prismaWrite.prisma.seriesEnrollment.create({
      data: {
        seriesId,
        athleteId: body.athleteId,
        startsOn,
        endsOn,
      },
    });

    // Emit SERIES_ENROLLMENT_CREATED event
    await this.outboxService.createEvent("SERIES_ENROLLMENT_CREATED", {
      enrollmentId: enrollment.id,
      seriesId,
      athleteId: body.athleteId,
      startsOn: startsOn.toISOString(),
      endsOn: endsOn?.toISOString(),
      createdAt: new Date().toISOString(),
    });

    return {
      status: "success",
      data: {
        enrollmentId: enrollment.id,
        seriesId,
        athleteId: body.athleteId,
        startsOn: enrollment.startsOn.toISOString(),
        endsOn: enrollment.endsOn?.toISOString(),
      },
    };
  }
}

interface CreateGroupDto {
  trainerId: string; // Ops user ID
  name: string;
  weekday: number; // 0=Sunday, 6=Saturday
  localStartTime: string; // "06:00" format
  duration: number; // minutes
  softCap: number;
  hardCap: number;
  startsOn: string; // ISO date
  endsOn?: string; // ISO date
  catalogItemId: string;
}

interface EditGroupDto {
  effectiveDate: string; // ISO date - changes apply from this date forward
  name?: string;
  localStartTime?: string;
  duration?: number;
  softCap?: number;
  hardCap?: number;
}

interface EndGroupDto {
  endDate: string; // ISO date
}

interface EnrollSeriesDto {
  athleteId: string; // Ops athlete ID
  startsOn: string; // ISO date - enrollment starts
  endsOn?: string; // ISO date - enrollment ends (optional)
}
