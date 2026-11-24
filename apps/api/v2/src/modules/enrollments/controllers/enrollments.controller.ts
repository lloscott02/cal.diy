import { Controller, Post, Body, Param, UseGuards, Request, HttpException, HttpStatus } from "@nestjs/common";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { CancelService } from "../services/cancel.service";
import { RescheduleService } from "../services/reschedule.service";
import { CancelEnrollmentDto, RescheduleEnrollmentDto, CancelResponseDto, RescheduleResponseDto } from "../dto";

/**
 * CalZero Enrollments Controller
 *
 * Manages enrollment lifecycle (cancel, reschedule):
 * - POST /enrollments/:id/cancel - Cancel with policy enforcement
 * - POST /enrollments/:id/reschedule - Atomic swap to new slot
 */
@Controller("v2/enrollments")
export class EnrollmentsController {
  constructor(
    private readonly cancelService: CancelService,
    private readonly rescheduleService: RescheduleService
  ) {}

  /**
   * Cancel an enrollment
   *
   * POST /v2/enrollments/:id/cancel
   */
  @Post(":id/cancel")
  @UseGuards(OpsJwtGuard)
  async cancelEnrollment(
    @Param("id") enrollmentId: string,
    @Body() body: CancelEnrollmentDto,
    @Request() req: any
  ): Promise<CancelResponseDto> {
    const athleteId = req.user.sub;
    const isAdminOrTrainer = req.user.isAdmin || req.user.isTrainer;

    const result = await this.cancelService.cancelEnrollment({
      enrollmentId,
      athleteId,
      trainerCaused: body.trainerCaused,
      isAdminOrTrainer,
      cancellationReason: body.cancellationReason,
    });

    return result;
  }

  /**
   * Reschedule an enrollment
   *
   * POST /v2/enrollments/:id/reschedule
   */
  @Post(":id/reschedule")
  @UseGuards(OpsJwtGuard)
  async rescheduleEnrollment(
    @Param("id") enrollmentId: string,
    @Body() body: RescheduleEnrollmentDto,
    @Request() req: any
  ): Promise<RescheduleResponseDto> {
    const athleteId = req.user.sub;
    const isAdminOrTrainer = req.user.isAdmin || req.user.isTrainer;

    // Validate that either newOccurrenceId (for GROUP) or newStartTime (for PRIVATE) is provided
    if (!body.newOccurrenceId && !body.newStartTime) {
      throw new HttpException(
        "Either newOccurrenceId (for GROUP) or newStartTime (for PRIVATE) must be provided",
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.rescheduleService.rescheduleEnrollment({
      enrollmentId,
      athleteId,
      newOccurrenceId: body.newOccurrenceId,
      newStartTime: body.newStartTime ? new Date(body.newStartTime) : undefined,
      adminOverride: body.adminOverride,
      isAdminOrTrainer,
    });

    return {
      kind: result.kind,
      oldStartTime: result.oldStartTime.toISOString(),
      newStartTime: result.newStartTime.toISOString(),
      policyOutcome: result.policyOutcome,
    };
  }
}
