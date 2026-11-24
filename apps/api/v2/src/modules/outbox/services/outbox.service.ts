import type { OutboxEvent, Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { OutboxRepository } from "@/modules/outbox/outbox.repository";

@Injectable()
export class OutboxService {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  /**
   * Create an outbox event for reliable async delivery to Ops
   *
   * @param type - Event type (e.g., "SCHEDULE_UPDATED", "ENROLLMENT_CONFIRMED")
   * @param payload - Event data to send to Ops
   * @param transaction - Optional Prisma transaction to ensure atomicity
   * @param entityVersion - Optional entity version at time of event (for Ground Zero optimistic locking)
   * @returns The created outbox event
   */
  async createEvent(
    type: string,
    payload: Record<string, unknown>,
    transaction?: Prisma.TransactionClient,
    entityVersion?: number
  ): Promise<OutboxEvent> {
    return this.outboxRepository.createEvent(type, payload, transaction, entityVersion);
  }

  /**
   * Get pending events ready for delivery
   */
  async getPendingEvents(limit = 100): Promise<OutboxEvent[]> {
    return this.outboxRepository.findPendingEvents(limit);
  }

  /**
   * Mark an event as successfully delivered
   */
  async markDelivered(eventId: string): Promise<void> {
    await this.outboxRepository.markDelivered(eventId);
  }

  /**
   * Mark an event as failed and calculate next retry time
   * Uses exponential backoff: 1min, 2min, 4min, 8min, 16min, 32min, 1hr, 2hr, 4hr, 8hr, 16hr, 24hr, 48hr
   * Max retry window: 72 hours
   */
  async markFailed(eventId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const nextAttemptAt = this.calculateNextAttempt(attempts);

    await this.outboxRepository.markFailed(eventId, attempts, nextAttemptAt);
  }

  /**
   * Calculate next retry time using exponential backoff
   * Returns null if max retry window (72 hours) exceeded
   */
  private calculateNextAttempt(attempts: number): Date | null {
    const MAX_RETRY_HOURS = 72;
    const baseDelayMinutes = 1;

    // Exponential backoff: 1, 2, 4, 8, 16, 32, 60, 120, 240, 480, 960, 1440, 2880
    const delayMinutes = Math.min(baseDelayMinutes * 2 ** (attempts - 1), MAX_RETRY_HOURS * 60);

    // Check if we've exceeded the 72-hour window
    const totalDelayHours = delayMinutes / 60;
    if (totalDelayHours > MAX_RETRY_HOURS) {
      return null; // Give up
    }

    const nextAttempt = new Date();
    nextAttempt.setMinutes(nextAttempt.getMinutes() + delayMinutes);
    return nextAttempt;
  }
}
