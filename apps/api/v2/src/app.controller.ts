import { Controller, Get, VERSION_NEUTRAL, Version } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";

interface HealthResponse {
  status: "healthy" | "warning" | "degraded";
  timestamp: string;
  outbox: {
    pending_count: number;
    oldest_pending_age_seconds: number;
  };
}

@Controller()
export class AppController {
  constructor(private readonly prismaRead: PrismaReadService) {}

  @Get("health")
  @Version(VERSION_NEUTRAL)
  async getHealth(): Promise<HealthResponse> {
    // Check outbox lag
    const oldestPending = await this.prismaRead.prisma.outboxEvent.findFirst({
      where: { status: "pending" },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });

    const pendingCount = await this.prismaRead.prisma.outboxEvent.count({
      where: { status: "pending" },
    });

    const lagSeconds = oldestPending
      ? Math.floor((Date.now() - oldestPending.occurredAt.getTime()) / 1000)
      : 0;

    // Status: degraded if lag >15min, warning if >5min
    let status: "healthy" | "warning" | "degraded" = "healthy";
    if (lagSeconds > 900) {
      status = "degraded";
    } else if (lagSeconds > 300) {
      status = "warning";
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      outbox: {
        pending_count: pendingCount,
        oldest_pending_age_seconds: lagSeconds,
      },
    };
  }
}
