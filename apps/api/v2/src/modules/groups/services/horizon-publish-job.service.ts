import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { OccurrenceService } from "@/modules/groups/services/occurrence.service";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { OooOccurrenceService } from "@/modules/ooo/services/ooo-occurrence.service";

/**
 * HorizonPublishJob
 *
 * Nightly scheduled job that:
 * 1. Extends occurrences to +8 weeks for all active series
 * 2. Publishes rows entering the publish window
 * 3. Emits COVERAGE_NEEDED events for published occurrences with needsCoverage=true
 *
 * Runs at 00:01 facility time (America/Chicago)
 */
@Injectable()
export class HorizonPublishJobService {
  private readonly logger = new Logger(HorizonPublishJobService.name);
  private isProcessing = false;

  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly occurrenceService: OccurrenceService,
    private readonly oooOccurrenceService: OooOccurrenceService
  ) {}

  /**
   * Run nightly at 00:01 Central Time
   * Cron: 0 1 6 * * * (runs at 01:00 UTC when CST, 00:00 UTC when CDT)
   * Using 6 AM UTC to approximate 00:01 CST/CDT accounting for DST variations
   */
  @Cron("0 1 6 * * *")
  async processHorizon() {
    if (this.isProcessing) {
      this.logger.warn("Skipping horizon job - previous job still running");
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log("Starting horizon publish job");

      // Get all active group series (not ended or ends in future)
      const now = new Date();
      const activeSeries = await this.prismaRead.prisma.groupSeries.findMany({
        where: {
          OR: [{ endsOn: null }, { endsOn: { gte: now } }],
        },
      });

      this.logger.log(`Processing ${activeSeries.length} active group series`);

      let totalExtended = 0;
      let totalPublished = 0;
      let totalCoverageEvents = 0;

      for (const series of activeSeries) {
        try {
          // Extend occurrences to 8-week horizon
          const extended = await this.occurrenceService.extendOccurrencesToHorizon(series.id);
          totalExtended += extended.length;

          // Publish occurrences entering the window
          const published = await this.occurrenceService.publishOccurrencesInWindow(series.id);
          totalPublished += published;

          // Emit COVERAGE_NEEDED events for newly published occurrences
          const coverageEvents = await this.oooOccurrenceService.emitCoverageEventsForPublished(series.id);
          totalCoverageEvents += coverageEvents;
        } catch (error) {
          this.logger.error(`Error processing series ${series.id}`, error);
          // Continue processing other series
        }
      }

      this.logger.log(
        `Horizon job complete: Extended ${totalExtended} occurrences, Published ${totalPublished} occurrences, Emitted ${totalCoverageEvents} coverage events`
      );
    } catch (error) {
      this.logger.error("Horizon job failed", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Manual trigger for testing
   */
  async runManually(): Promise<void> {
    this.logger.log("Manual horizon job trigger");
    await this.processHorizon();
  }
}
