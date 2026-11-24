-- AlterTable: Add CalZero group session fields to Booking
ALTER TABLE "Booking" ADD COLUMN "seriesId" TEXT,
ADD COLUMN "publishState" TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN "holidayBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "needsCoverage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "overriddenFields" JSONB;

-- CreateTable: GroupSeries for recurring group classes
CREATE TABLE "group_series" (
    "id" TEXT NOT NULL,
    "trainerId" INTEGER NOT NULL,
    "eventTypeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "localStartTime" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "softCap" INTEGER NOT NULL,
    "hardCap" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "catalogItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SeriesEnrollment for membership tracking
CREATE TABLE "series_enrollments" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_seriesId_idx" ON "Booking"("seriesId");

-- CreateIndex
CREATE INDEX "Booking_publishState_startTime_idx" ON "Booking"("publishState", "startTime");

-- CreateIndex
CREATE INDEX "group_series_trainerId_idx" ON "group_series"("trainerId");

-- CreateIndex
CREATE INDEX "group_series_startsOn_endsOn_idx" ON "group_series"("startsOn", "endsOn");

-- CreateIndex
CREATE INDEX "series_enrollments_athleteId_idx" ON "series_enrollments"("athleteId");

-- CreateIndex
CREATE INDEX "series_enrollments_seriesId_idx" ON "series_enrollments"("seriesId");

-- CreateIndex
CREATE INDEX "series_enrollments_startsOn_endsOn_idx" ON "series_enrollments"("startsOn", "endsOn");

-- AddForeignKey
ALTER TABLE "group_series" ADD CONSTRAINT "group_series_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_series" ADD CONSTRAINT "group_series_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
