import { Controller, Post, Delete, Body, Param, UseGuards, HttpException, HttpStatus } from "@nestjs/common";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { HoldService } from "../services/hold.service";
import { ConfirmService } from "../services/confirm.service";
import { ReleaseService } from "../services/release.service";
import { CreateHoldDto, ConfirmHoldDto, HoldResponseDto, ConfirmResponseDto } from "../dto";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";

/**
 * CalZero Holds Controller
 *
 * Manages session hold and enrollment flow:
 * - POST /holds - Create temporary slot reservation (10 min TTL)
 * - POST /holds/:id/confirm - Convert hold to enrollment
 * - DELETE /holds/:id - Release hold
 */
@Controller("v2/holds")
export class HoldsController {
  constructor(
    private readonly holdService: HoldService,
    private readonly confirmService: ConfirmService,
    private readonly releaseService: ReleaseService,
    private readonly prismaRead: PrismaReadService
  ) {}

  /**
   * Create a hold (GROUP or PRIVATE)
   *
   * POST /v2/holds
   */
  @Post()
  @UseGuards(OpsJwtGuard)
  async createHold(@Body() body: CreateHoldDto): Promise<HoldResponseDto> {
    if (body.kind === "GROUP") {
      // Validate GROUP hold params
      if (!body.occurrenceId) {
        throw new HttpException("occurrenceId required for GROUP holds", HttpStatus.BAD_REQUEST);
      }

      const result = await this.holdService.createGroupHold({
        occurrenceId: body.occurrenceId,
        athleteId: body.athleteId,
      });

      return {
        status: "success",
        data: {
          holdId: result.holdId,
          kind: "GROUP",
          athleteId: body.athleteId,
          startsAt: result.startTime.toISOString(),
          endsAt: result.endTime.toISOString(),
          expiresAt: result.expiresAt.toISOString(),
          occurrenceId: body.occurrenceId,
        },
      };
    } else {
      // PRIVATE hold
      if (!body.trainerId || !body.startTime || !body.durationMinutes) {
        throw new HttpException(
          "trainerId, startTime, and durationMinutes required for PRIVATE holds",
          HttpStatus.BAD_REQUEST
        );
      }

      // Convert opsUserId to internal trainer ID
      const trainer = await this.prismaRead.prisma.user.findUnique({
        where: { opsUserId: body.trainerId },
        select: { id: true },
      });

      if (!trainer) {
        throw new HttpException("Trainer not found", HttpStatus.NOT_FOUND);
      }

      const result = await this.holdService.createPrivateHold({
        trainerId: trainer.id,
        startTime: new Date(body.startTime),
        durationMinutes: body.durationMinutes,
        athleteId: body.athleteId,
      });

      return {
        status: "success",
        data: {
          holdId: result.holdId,
          kind: "PRIVATE",
          athleteId: body.athleteId,
          startsAt: result.startTime.toISOString(),
          endsAt: result.endTime.toISOString(),
          expiresAt: result.expiresAt.toISOString(),
        },
      };
    }
  }

  /**
   * Confirm a hold and create enrollment
   *
   * POST /v2/holds/:id/confirm
   */
  @Post(":id/confirm")
  @UseGuards(OpsJwtGuard)
  async confirmHold(
    @Param("id") holdId: string,
    @Body() body: ConfirmHoldDto
  ): Promise<ConfirmResponseDto> {
    const result = await this.confirmService.confirmHold({
      holdId,
      athleteId: body.athleteId,
      enrollmentType: body.enrollmentType,
      athleteLabel: body.athleteLabel,
    });

    // Get hold details for response
    const hold = await this.holdService.getHold(holdId);

    return {
      status: "success",
      data: {
        enrollmentId: result.enrollmentId,
        kind: result.kind,
        athleteId: body.athleteId,
        startsAt: hold.slotUtcStartDate.toISOString(),
        endsAt: hold.slotUtcEndDate.toISOString(),
        bookingId: result.bookingId,
        seatId: result.seatId,
      },
    };
  }

  /**
   * Release a hold
   *
   * DELETE /v2/holds/:id
   */
  @Delete(":id")
  @UseGuards(OpsJwtGuard)
  async releaseHold(@Param("id") holdId: string): Promise<{ status: string; message: string }> {
    await this.releaseService.releaseHold({
      holdId,
      reason: "manual",
    });

    return {
      status: "success",
      message: "Hold released",
    };
  }
}
