import type { OutboxEvent, Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

@Injectable()
export class OutboxRepository {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async createEvent(
    type: string,
    payload: Record<string, unknown>,
    transaction?: Prisma.TransactionClient,
    entityVersion?: number
  ): Promise<OutboxEvent> {
    const db = transaction || this.dbWrite.prisma;

    return db.outboxEvent.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        nextAttemptAt: new Date(), // Ready for immediate delivery
        apiVersion: "1",
        entityVersion,
      },
    });
  }

  async findPendingEvents(limit = 100): Promise<OutboxEvent[]> {
    const now = new Date();

    return this.dbRead.prisma.outboxEvent.findMany({
      where: {
        status: "pending",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: {
        occurredAt: "asc",
      },
      take: limit,
    });
  }

  async markDelivered(eventId: string): Promise<OutboxEvent> {
    return this.dbWrite.prisma.outboxEvent.update({
      where: { eventId },
      data: {
        status: "delivered",
        deliveredAt: new Date(),
      },
    });
  }

  async markFailed(eventId: string, attempts: number, nextAttemptAt: Date | null): Promise<OutboxEvent> {
    return this.dbWrite.prisma.outboxEvent.update({
      where: { eventId },
      data: {
        attempts,
        nextAttemptAt,
        status: nextAttemptAt === null ? "failed" : "pending",
      },
    });
  }

  async findById(eventId: string): Promise<OutboxEvent | null> {
    return this.dbRead.prisma.outboxEvent.findUnique({
      where: { eventId },
    });
  }

  /**
   * Find events since a given event ID for catch-up queries
   * Used by Ground Zero to recover missed events
   */
  async findEventsSince(sinceEventId?: string, limit = 100): Promise<OutboxEvent[]> {
    let whereClause: Prisma.OutboxEventWhereInput = {};

    if (sinceEventId) {
      const sinceEvent = await this.dbRead.prisma.outboxEvent.findUnique({
        where: { eventId: sinceEventId },
        select: { occurredAt: true },
      });

      if (sinceEvent) {
        whereClause = {
          occurredAt: { gt: sinceEvent.occurredAt },
        };
      }
    }

    return this.dbRead.prisma.outboxEvent.findMany({
      where: whereClause,
      orderBy: { occurredAt: "asc" },
      take: limit,
    });
  }
}
