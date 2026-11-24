import { randomUUID } from "node:crypto";
import { createWebhookSignature } from "@calcom/platform-libraries";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { getEnv } from "@/env";

export type AuditEventType =
  | "SCHEDULE_UPDATED"
  | "TIME_BLOCK_CREATED"
  | "TIME_BLOCK_DELETED"
  | "TRAINER_SYNCED"
  | "TRAINER_OFFBOARDED";

export interface AuditEventPayload {
  auditId: string;
  type: AuditEventType;
  actorId: string; // Ops user ID who performed the action
  actorType: "ops_user" | "trainer" | "system";
  trainerId?: string; // CalZero user ID (if applicable)
  timestamp: string;
  data: Record<string, unknown>;
}

@Injectable()
export class AuditClientService {
  private readonly logger = new Logger(AuditClientService.name);
  private readonly opsAuditUrl: string;
  private readonly opsWebhookSecret: string;

  constructor() {
    const opsWebhookUrl = getEnv("OPS_WEBHOOK_URL");
    // Derive audit URL from webhook URL (same base, different path)
    this.opsAuditUrl = opsWebhookUrl.replace(/\/webhook\/?$/, "/audit");
    this.opsWebhookSecret = getEnv("OPS_WEBHOOK_SECRET");
  }

  /**
   * Send an audit event to Ops synchronously
   * Throws ServiceUnavailableException if the audit fails
   *
   * @param type - Event type
   * @param actorId - Ops user ID who performed the action
   * @param actorType - Type of actor (ops_user, trainer, system)
   * @param data - Event data
   * @param trainerId - Optional CalZero user ID
   * @returns The audit ID
   */
  async logAudit(
    type: AuditEventType,
    actorId: string,
    actorType: "ops_user" | "trainer" | "system",
    data: Record<string, unknown>,
    trainerId?: string
  ): Promise<string> {
    const auditId = randomUUID();
    const timestamp = new Date().toISOString();

    const payload: AuditEventPayload = {
      auditId,
      type,
      actorId,
      actorType,
      trainerId,
      timestamp,
      data,
    };

    try {
      const body = JSON.stringify(payload);
      const signature = createWebhookSignature({
        secret: this.opsWebhookSecret,
        body,
      });

      const response = await fetch(this.opsAuditUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CalZero-Signature-256": signature,
          "X-CalZero-Timestamp": timestamp,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`Audit failed: HTTP ${response.status} ${response.statusText}`);
      }

      this.logger.log(`Audit logged: ${type} (${auditId}) by ${actorType}:${actorId}`);
      return auditId;
    } catch (error) {
      this.logger.error(`Failed to log audit event ${type} (${auditId})`, error);
      throw new ServiceUnavailableException("Audit logging failed - action aborted");
    }
  }

  /**
   * Log an audit event without failing if it errors (best-effort)
   * Use this for non-critical audits where we don't want to block the action
   */
  async logAuditBestEffort(
    type: AuditEventType,
    actorId: string,
    actorType: "ops_user" | "trainer" | "system",
    data: Record<string, unknown>,
    trainerId?: string
  ): Promise<void> {
    try {
      await this.logAudit(type, actorId, actorType, data, trainerId);
    } catch (error) {
      this.logger.warn(`Best-effort audit failed for ${type}`, error);
      // Don't throw - this is best-effort
    }
  }
}
