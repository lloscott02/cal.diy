import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AvailabilityEditGuardService } from "../services/availability-edit-guard.service";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

/**
 * CalZero Schedules Controller
 *
 * Manages trainer availability: working hours, date overrides, and TimeBlocks.
 * All endpoints require Ops-issued JWT authentication.
 */
@Controller("v2/schedules")
export class SchedulesController {
  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly availabilityGuard: AvailabilityEditGuardService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Get trainer's schedule
   *
   * GET /v2/schedules/:trainerId
   */
  @Get(":trainerId")
  @UseGuards(OpsJwtGuard)
  async getSchedule(@Param("trainerId") trainerId: string) {
    const trainerIdNum = parseInt(trainerId);

    // Find trainer by opsUserId
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { opsUserId: trainerId },
      select: {
        id: true,
        schedules: {
          include: {
            availability: true,
          },
        },
        timeBlocks: {
          where: {
            endTime: { gte: new Date() }, // Only future blocks
          },
          orderBy: { startTime: "asc" },
        },
      },
    });

    if (!trainer) {
      throw new HttpException("Trainer not found", HttpStatus.NOT_FOUND);
    }

    // Get default schedule (enforce one schedule per trainer)
    const schedule = trainer.schedules[0];

    return {
      status: "success",
      data: {
        trainerId: trainer.id,
        workingHours: schedule?.availability.filter((a) => !a.date) || [],
        dateOverrides: schedule?.availability.filter((a) => a.date) || [],
        timeBlocks: trainer.timeBlocks,
      },
    };
  }

  /**
   * Update trainer's working hours
   *
   * PUT /v2/schedules/:trainerId
   */
  @Put(":trainerId")
  @UseGuards(OpsJwtGuard)
  async updateSchedule(
    @Param("trainerId") trainerId: string,
    @Body() body: UpdateScheduleDto,
    @Request() req: any
  ) {
    // Find trainer
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { opsUserId: trainerId },
      select: { id: true, schedules: true },
    });

    if (!trainer) {
      throw new HttpException("Trainer not found", HttpStatus.NOT_FOUND);
    }

    // Strand check: would this change orphan any bookings?
    const stranded = await this.availabilityGuard.checkForStrandedSessions({
      trainerId: trainer.id,
      changeType: "working_hours",
      workingHours: body.workingHours,
    });

    if (stranded.length > 0) {
      // Block the edit - return list of conflicting sessions
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "Cannot update schedule: would strand existing sessions",
          strandedSessions: stranded,
        },
        HttpStatus.CONFLICT
      );
    }

    // Find or create schedule
    let schedule = trainer.schedules[0];
    if (!schedule) {
      schedule = await this.prismaWrite.prisma.schedule.create({
        data: {
          userId: trainer.id,
          name: "Default",
          timeZone: "America/Chicago",
        },
      });
    }

    // Delete existing working hours (non-override availability)
    await this.prismaWrite.prisma.availability.deleteMany({
      where: {
        scheduleId: schedule.id,
        date: null, // Only delete recurring hours, keep overrides
      },
    });

    // Create new working hours
    await this.prismaWrite.prisma.availability.createMany({
      data: body.workingHours.map((wh) => ({
        scheduleId: schedule.id,
        days: wh.days,
        startTime: this.parseTime(wh.startTime),
        endTime: this.parseTime(wh.endTime),
      })),
    });

    // Emit SCHEDULE_UPDATED event for Ops
    await this.outboxService.createEvent("SCHEDULE_UPDATED", {
      trainerId: trainer.id,
      opsUserId: trainerId,
      scheduleId: schedule.id,
      workingHours: body.workingHours,
      updatedAt: new Date().toISOString(),
    });

    return {
      status: "success",
      message: "Schedule updated successfully",
    };
  }

  /**
   * Create a TimeBlock (personal time off)
   *
   * POST /v2/schedules/:trainerId/time-blocks
   */
  @Post(":trainerId/time-blocks")
  @UseGuards(OpsJwtGuard)
  async createTimeBlock(@Param("trainerId") trainerId: string, @Body() body: CreateTimeBlockDto) {
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { opsUserId: trainerId },
      select: { id: true },
    });

    if (!trainer) {
      throw new HttpException("Trainer not found", HttpStatus.NOT_FOUND);
    }

    // Strand check: would this block overlap any bookings?
    const stranded = await this.availabilityGuard.checkForStrandedSessions({
      trainerId: trainer.id,
      changeType: "time_block",
      timeBlock: {
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
      },
    });

    if (stranded.length > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: "Cannot create time block: overlaps existing sessions",
          strandedSessions: stranded,
        },
        HttpStatus.CONFLICT
      );
    }

    const timeBlock = await this.prismaWrite.prisma.timeBlock.create({
      data: {
        userId: trainer.id,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        note: body.note,
      },
    });

    // Emit TIME_BLOCK_CREATED event for Ops
    await this.outboxService.createEvent("TIME_BLOCK_CREATED", {
      timeBlockId: timeBlock.id,
      trainerId: trainer.id,
      opsUserId: trainerId,
      startTime: timeBlock.startTime.toISOString(),
      endTime: timeBlock.endTime.toISOString(),
      note: timeBlock.note,
      createdAt: timeBlock.createdAt.toISOString(),
    });

    return {
      status: "success",
      data: timeBlock,
    };
  }

  /**
   * Delete a TimeBlock
   *
   * DELETE /v2/schedules/time-blocks/:id
   */
  @Delete("time-blocks/:id")
  @UseGuards(OpsJwtGuard)
  async deleteTimeBlock(@Param("id") id: string) {
    // Get timeBlock before deleting for event emission
    const timeBlock = await this.prismaRead.prisma.timeBlock.findUnique({
      where: { id: parseInt(id) },
      include: {
        user: {
          select: { id: true, opsUserId: true },
        },
      },
    });

    if (!timeBlock) {
      throw new HttpException("Time block not found", HttpStatus.NOT_FOUND);
    }

    await this.prismaWrite.prisma.timeBlock.delete({
      where: { id: parseInt(id) },
    });

    // Emit TIME_BLOCK_DELETED event for Ops
    await this.outboxService.createEvent("TIME_BLOCK_DELETED", {
      timeBlockId: timeBlock.id,
      trainerId: timeBlock.user.id,
      opsUserId: timeBlock.user.opsUserId,
      startTime: timeBlock.startTime.toISOString(),
      endTime: timeBlock.endTime.toISOString(),
      deletedAt: new Date().toISOString(),
    });

    return {
      status: "success",
      message: "Time block deleted",
    };
  }

  /**
   * Check if trainer has availability configured
   *
   * GET /v2/schedules/:trainerId/status
   */
  @Get(":trainerId/status")
  @UseGuards(OpsJwtGuard)
  async getAvailabilityStatus(@Param("trainerId") trainerId: string) {
    const trainer = await this.prismaRead.prisma.user.findUnique({
      where: { opsUserId: trainerId },
      select: {
        id: true,
        schedules: {
          include: {
            availability: {
              where: { date: null }, // Only count recurring hours
            },
          },
        },
      },
    });

    if (!trainer) {
      throw new HttpException("Trainer not found", HttpStatus.NOT_FOUND);
    }

    const hasAvailability = trainer.schedules.some((s) => s.availability.length > 0);

    return {
      status: "success",
      data: {
        hasAvailability,
        requiresSetup: !hasAvailability,
      },
    };
  }

  /**
   * Parse time string (HH:mm) to Date object for Prisma @db.Time
   */
  private parseTime(timeStr: string): Date {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setUTCHours(hours, minutes, 0, 0);
    return date;
  }
}

interface UpdateScheduleDto {
  workingHours: Array<{
    days: number[]; // [1,2,3,4,5] = Mon-Fri
    startTime: string; // "09:00"
    endTime: string; // "17:00"
  }>;
}

interface CreateTimeBlockDto {
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  note?: string;
}
