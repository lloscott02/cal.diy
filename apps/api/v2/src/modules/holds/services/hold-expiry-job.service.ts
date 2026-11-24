import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ReleaseService } from "./release.service";

/**
 * HoldExpiryJobService
 *
 * Scheduled job that runs every minute to:
 * - Find expired holds (releaseAt <= now)
 * - Delete them
 * - Emit HOLD_RELEASED events
 */
@Injectable()
export class HoldExpiryJobService {
  private readonly logger = new Logger(HoldExpiryJobService.name);

  constructor(private readonly releaseService: ReleaseService) {}

  /**
   * Run every minute to clean up expired holds
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredHolds() {
    try {
      const releasedCount = await this.releaseService.releaseExpiredHolds();

      if (releasedCount > 0) {
        this.logger.log(`Hold expiry job released ${releasedCount} expired holds`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Hold expiry job failed: ${err.message}`, err.stack);
    }
  }
}
