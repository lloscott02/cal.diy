import { PlatformEndpointsModule } from "@/platform/platform-endpoints-module";
import { AtomsModule } from "@/modules/atoms/atoms.module";
import { OAuth2Module } from "@/modules/auth/oauth2/oauth2.module";
import { CalUnifiedCalendarsModule } from "@/modules/cal-unified-calendars/cal-unified-calendars.module";
import { ConferencingModule } from "@/modules/conferencing/conferencing.module";
import { DestinationCalendarsModule } from "@/modules/destination-calendars/destination-calendars.module";
import { OAuthClientModule } from "@/modules/oauth-clients/oauth-client.module";
import { StripeModule } from "@/modules/stripe/stripe.module";
import { TimezoneModule } from "@/modules/timezones/timezones.module";
import { VerifiedResourcesModule } from "@/modules/verified-resources/verified-resources.module";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { UsersModule } from "./users/users.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { SchedulesModule } from "./schedules/schedules.module";
import { OutboxModule } from "./outbox/outbox.module";
import { GroupsModule } from "./groups/groups.module";
import { ListingsModule } from "./listings/listings.module";
import { HoldsModule } from "./holds/holds.module";
import { EnrollmentsModule } from "./enrollments/enrollments.module";
import { BuildingModule } from "./building/building.module";
import { OooModule } from "./ooo/ooo.module";
import { CoverageModule } from "./trainer-coverage/coverage.module";

@Module({
  imports: [
    OAuth2Module,
    OAuthClientModule,
    PlatformEndpointsModule,
    TimezoneModule,
    UsersModule,
    WebhooksModule,
    SchedulesModule, // CalZero: Schedule management
    OutboxModule, // CalZero: Reliable event delivery to Ops
    GroupsModule, // CalZero: Group session management
    ListingsModule, // CalZero: Unified listings (Groups + Private openings)
    HoldsModule, // CalZero: Hold and enrollment flow
    EnrollmentsModule, // CalZero: Cancel and reschedule
    BuildingModule, // CalZero: Building view and facility load
    OooModule, // CalZero: Out of office management
    CoverageModule, // CalZero: Coverage and reassignment
    DestinationCalendarsModule,
    AtomsModule,
    StripeModule,
    ConferencingModule,
    CalUnifiedCalendarsModule,
    VerifiedResourcesModule,
  ],
})
export class EndpointsModule implements NestModule {
   
  configure(_consumer: MiddlewareConsumer) {
    // TODO: apply ratelimits
  }
}
