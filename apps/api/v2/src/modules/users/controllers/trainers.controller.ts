import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { OpsJwtGuard } from "@/modules/jwt/guards";
import { UsersRepository } from "../users.repository";

/**
 * CalZero Trainer Sync Controller
 *
 * Handles syncing trainer data from Ops (Ground Zero) to CalZero.
 * All endpoints require Ops-issued JWT authentication.
 */
@Controller("v2/trainers")
export class TrainersController {
  constructor(private readonly usersRepository: UsersRepository) {}

  /**
   * Sync a trainer from Ops
   *
   * Creates or updates a User record in CalZero to mirror the trainer in Ops.
   * This endpoint is called by Ops whenever a trainer is created or updated.
   *
   * POST /v2/trainers/sync
   * Authorization: Bearer <ops-jwt>
   *
   * @param body - Trainer data from Ops
   * @returns The mirrored User record
   */
  @Post("sync")
  @UseGuards(OpsJwtGuard)
  async syncTrainer(@Body() body: SyncTrainerDto) {
    const { opsUserId, email, timezone, status } = body;

    // Upsert: create if doesn't exist, update if exists
    const trainer = await this.usersRepository.upsertTrainerMirror({
      opsUserId,
      email,
      timeZone: timezone || "America/Chicago", // Default facility timezone
      status: status || "active",
    });

    return {
      status: "success",
      data: {
        id: trainer.id,
        opsUserId: trainer.opsUserId,
        email: trainer.email,
        timezone: trainer.timeZone,
        status: trainer.status,
        calendarStatus: trainer.calendarStatus,
      },
    };
  }
}

/**
 * DTO for syncing trainer data
 */
interface SyncTrainerDto {
  opsUserId: string;     // Ops trainer ID (required)
  email: string;         // Trainer email (required)
  timezone?: string;     // Trainer timezone (optional, defaults to America/Chicago)
  status?: string;       // Trainer status (optional, defaults to "active")
}
