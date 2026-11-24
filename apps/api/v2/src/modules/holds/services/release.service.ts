import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { OutboxService } from "@/modules/outbox/services/outbox.service";

/**
 * ReleaseService
 *
 * Releases holds (manual or automatic expiry)
 * - Deletes SelectedSlots row
 * - Emits HOLD_RELEASED event
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService,
    private readonly outboxService: OutboxService
  ) {}

  /**
   * Release a hold
   */
  async releaseHold(params: {
    holdId: string;
    reason: "manual" | "expired" | "confirmed";
  }): Promise<void> {
    const { holdId, reason } = params;

    // Get hold before deleting for event emission
    const hold = await this.prismaRead.prisma.selectedSlots.findUnique({
      where: { id: parseInt(holdId) },
    });

    if (!hold) {
      // Already released or doesn't exist
      this.logger.warn(`Hold ${holdId} not found for release`);
      return;
    }

    // Delete the hold
    await this.prismaWrite.prisma.selectedSlots.delete({
      where: { id: parseInt(holdId) },
    });

    // Emit HOLD_RELEASED event
    await this.outboxService.createEvent("HOLD_RELEASED", {
      holdId,
      athleteId: hold.athleteId,
      trainerId: hold.userId,
      startsAt: hold.slotUtcStartDate.toISOString(),
      endsAt: hold.slotUtcEndDate.toISOString(),
      reason,
      releasedAt: new Date().toISOString(),
    });

    this.logger.log(`Released hold ${holdId} for athlete ${hold.athleteId} (reason: ${reason})`);
  }

  /**
   * Release expired holds (called by scheduled job)
   */
  async releaseExpiredHolds(): Promise<number> {
    // Find all expired holds
    const expiredHolds = await this.prismaRead.prisma.selectedSlots.findMany({
      where: {
        releaseAt: { lt: new Date() },
      },
    });

    // Release each one
    for (const hold of expiredHolds) {
      await this.releaseHold({
        holdId: hold.id.toString(),
        reason: "expired",
      });
    }

    if (expiredHolds.length > 0) {
      this.logger.log(`Released ${expiredHolds.length} expired holds`);
    }

    return expiredHolds.length;
  }
}
