import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { UserOOOService } from "@/modules/ooo/services/ooo.service";
import { OooOccurrenceService } from "@/modules/ooo/services/ooo-occurrence.service";
import { OpsJwtGuard } from "@/modules/jwt/guards/ops-jwt.guard";
import type { OpsJwtPayload } from "@/modules/jwt/jwt.service";
import type { CreateOutOfOfficeEntryDto, GetOutOfOfficeEntryFiltersDTO } from "@/modules/ooo/inputs/ooo.input";

interface RequestWithUser extends Request {
  user: OpsJwtPayload;
}

@ApiTags("OOO")
@Controller("ooo")
@UseGuards(OpsJwtGuard)
@ApiBearerAuth()
export class OooController {
  constructor(
    private readonly oooService: UserOOOService,
    private readonly oooOccurrenceService: OooOccurrenceService
  ) {}

  @Post()
  @ApiOperation({ summary: "Create OOO entry for a trainer" })
  @ApiResponse({ status: 201, description: "OOO entry created successfully" })
  async createOOO(
    @Body() body: CreateOutOfOfficeEntryDto,
    @Request() req: RequestWithUser
  ) {
    const { trainerId, isAdmin } = req.user;

    if (!trainerId) {
      throw new ForbiddenException("User is not a trainer");
    }

    const targetUserId = parseInt(trainerId); // Convert string to number

    // Create the OOO entry
    const ooo = await this.oooService.createUserOOO(targetUserId, body);

    // Flag affected occurrences
    const affectedIds = await this.oooOccurrenceService.flagAffectedOccurrences(
      targetUserId,
      body.start,
      body.end
    );

    return {
      ...ooo,
      affectedOccurrences: affectedIds.length,
    };
  }

  @Get(":trainerId")
  @ApiOperation({ summary: "List OOO entries for a trainer" })
  @ApiResponse({ status: 200, description: "Returns paginated OOO entries" })
  async listOOO(
    @Param("trainerId", ParseIntPipe) trainerId: number,
    @Query() query: GetOutOfOfficeEntryFiltersDTO,
    @Request() req: RequestWithUser
  ) {
    const { trainerId: userTrainerId, isAdmin } = req.user;

    // Only admins can view other users' OOO, otherwise must be self
    if (!isAdmin && trainerId !== parseInt(userTrainerId || "0")) {
      throw new ForbiddenException("You can only view your own OOO entries");
    }

    const skip = query.skip || 0;
    const take = query.take || 20;
    const sort = {
      sortStart: query.sortStart,
      sortEnd: query.sortEnd,
    };

    return this.oooService.getUserOOOPaginated(trainerId, skip, take, sort);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an OOO entry" })
  @ApiResponse({ status: 200, description: "OOO entry deleted successfully" })
  async deleteOOO(
    @Param("id", ParseIntPipe) oooId: number,
    @Request() req: RequestWithUser
  ) {
    const { isAdmin } = req.user;

    // Get the OOO entry first to know the date range
    const oooEntry = await this.oooService.getUserOOOById(oooId);
    if (!oooEntry) {
      throw new Error("OOO entry not found");
    }

    // Delete the OOO entry
    const result = await this.oooService.deleteUserOOO(oooId);

    // Clear coverage flags from affected occurrences
    const clearedCount = await this.oooOccurrenceService.clearCoverageFlags(
      oooEntry.userId,
      oooEntry.start,
      oooEntry.end
    );

    return {
      ...result,
      clearedOccurrences: clearedCount,
    };
  }
}
