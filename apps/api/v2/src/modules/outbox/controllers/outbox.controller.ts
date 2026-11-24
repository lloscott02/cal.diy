import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { HmacGuard } from "@/modules/jwt/guards/hmac.guard";
import { OutboxRepository } from "../outbox.repository";

/**
 * OutboxController
 *
 * Provides event catch-up endpoint for Ground Zero to recover missed events.
 * Protected by HMAC signature verification.
 */
@ApiTags("Outbox")
@Controller("v2/outbox")
@UseGuards(HmacGuard)
export class OutboxController {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  /**
   * GET /v2/outbox/events
   *
   * Returns events since a given event ID for catch-up queries.
   * Ground Zero uses this to recover from any gaps without asking for resends.
   */
  @Get("events")
  @ApiOperation({ summary: "List outbox events for catch-up" })
  @ApiQuery({
    name: "since",
    required: false,
    description: "Event ID to start from (exclusive). Omit to get from beginning.",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Maximum number of events to return (default: 100, max: 200)",
  })
  @ApiResponse({
    status: 200,
    description: "Returns events since the given ID",
    schema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              event_id: { type: "string" },
              type: { type: "string" },
              api_version: { type: "string" },
              occurred_at: { type: "string", format: "date-time" },
              entity_version: { type: "integer", nullable: true },
              status: { type: "string" },
              data: { type: "object" },
            },
          },
        },
        has_more: { type: "boolean" },
      },
    },
  })
  async getEvents(@Query("since") since?: string, @Query("limit") limit?: string) {
    const maxLimit = Math.min(parseInt(limit || "100", 10) || 100, 200);
    const events = await this.outboxRepository.findEventsSince(since, maxLimit);

    return {
      events: events.map((event) => ({
        event_id: event.eventId,
        type: event.type,
        api_version: event.apiVersion,
        occurred_at: event.occurredAt.toISOString(),
        ...(event.entityVersion !== null && { entity_version: event.entityVersion }),
        status: event.status,
        data: event.payload,
      })),
      has_more: events.length === maxLimit,
    };
  }
}
