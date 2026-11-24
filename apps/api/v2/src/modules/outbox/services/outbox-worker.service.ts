import { createWebhookSignature } from "@calcom/platform-libraries";
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { getEnv } from "@/env";
import { OutboxRepository } from "@/modules/outbox/outbox.repository";

@Injectable()
export class OutboxWorkerService {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly opsWebhookUrl: string;
  private readonly opsWebhookSecret: string;
  private isProcessing = false;

  constructor(private readonly outboxRepository: OutboxRepository) {
    this.opsWebhookUrl = getEnv("OPS_WEBHOOK_URL");
    this.opsWebhookSecret = getEnv("OPS_WEBHOOK_SECRET");
  }

  /**
   * Run every 30 seconds to deliver pending outbox events
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processOutboxEvents() {
    // Prevent overlapping executions
    if (this.isProcessing) {
      this.logger.debug("Skipping outbox processing - previous job still running");
      return;
    }

    this.isProcessing = true;

    try {
      const pendingEvents = await this.outboxRepository.findPendingEvents(50);

      if (pendingEvents.length === 0) {
        this.logger.debug("No pending outbox events");
        return;
      }

      this.logger.log(`Processing ${pendingEvents.length} pending outbox events`);

      // Process events sequentially to avoid overwhelming the Ops endpoint
      for (const event of pendingEvents) {
        await this.deliverEvent(event);
      }
    } catch (error) {
      this.logger.error("Error processing outbox events", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Deliver a single event to Ops webhook
   */
  private async deliverEvent(event: {
    eventId: string;
    type: string;
    payload: unknown;
    attempts: number;
    occurredAt: Date;
    apiVersion: string;
    entityVersion: number | null;
  }) {
    try {
      const timestamp = new Date().toISOString();

      // Ground Zero webhook envelope format
      const webhookPayload = {
        event_id: event.eventId,
        type: event.type,
        api_version: event.apiVersion,
        occurred_at: event.occurredAt.toISOString(),
        ...(event.entityVersion !== null && { entity_version: event.entityVersion }),
        data: event.payload,
      };

      const body = JSON.stringify(webhookPayload);

      const signature = createWebhookSignature({
        secret: this.opsWebhookSecret,
        body,
      });

      const response = await fetch(this.opsWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CalZero-Signature-256": signature,
          "X-CalZero-Timestamp": timestamp,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Success - mark as delivered
      await this.outboxRepository.markDelivered(event.eventId);
      this.logger.log(`Delivered event ${event.eventId} (${event.type})`);
    } catch (error) {
      // Failure - mark as failed and schedule retry
      const attempts = event.attempts + 1;
      const nextAttemptAt = this.calculateNextAttempt(attempts);

      await this.outboxRepository.markFailed(event.eventId, attempts, nextAttemptAt);

      if (nextAttemptAt === null) {
        this.logger.error(`Event ${event.eventId} failed permanently after ${attempts} attempts`, error);
      } else {
        this.logger.warn(
          `Event ${event.eventId} delivery failed (attempt ${attempts}), will retry at ${nextAttemptAt.toISOString()}`,
          error
        );
      }
    }
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
