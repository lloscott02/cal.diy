import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { CoverageEligibilityService } from "../services/coverage-eligibility.service";
import { OccurrenceReassignService } from "../services/occurrence-reassign.service";
import { OpsJwtGuard } from "@/modules/jwt/guards/ops-jwt.guard";
import type { OpsJwtPayload } from "@/modules/jwt/jwt.service";
import {
  GetEligibilityDto,
  GetEligibilityResponseDto,
  ReassignOccurrencesDto,
  ReassignResponseDto,
} from "../dto/coverage.dto";

interface RequestWithUser extends Request {
  user: OpsJwtPayload;
}

@ApiTags("Coverage")
@Controller("coverage")
@UseGuards(OpsJwtGuard)
@ApiBearerAuth()
export class CoverageController {
  constructor(
    private readonly eligibilityService: CoverageEligibilityService,
    private readonly reassignService: OccurrenceReassignService
  ) {}

  @Post("eligibility")
  @ApiOperation({ summary: "Find eligible trainers to cover specific occurrences" })
  @ApiResponse({
    status: 200,
    description: "Returns eligible trainers for each occurrence",
    type: GetEligibilityResponseDto,
  })
  async getEligibility(
    @Body() body: GetEligibilityDto
  ): Promise<GetEligibilityResponseDto> {
    const data = await this.eligibilityService.findEligibleTrainers(body.occurrenceIds);

    return { data };
  }

  @Post("reassign")
  @ApiOperation({ summary: "Reassign occurrences to substitute trainers" })
  @ApiResponse({
    status: 200,
    description: "Returns successes and failures for each reassignment",
    type: ReassignResponseDto,
  })
  async reassignOccurrences(
    @Body() body: ReassignOccurrencesDto,
    @Request() req: RequestWithUser
  ): Promise<ReassignResponseDto> {
    const { trainerId } = req.user;

    if (!trainerId) {
      throw new Error("User is not a trainer");
    }

    const actorId = parseInt(trainerId);

    return this.reassignService.reassignOccurrences(body.assignments, actorId);
  }
}
