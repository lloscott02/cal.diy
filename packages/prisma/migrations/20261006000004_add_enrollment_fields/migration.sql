-- AlterTable: Add enrollment fields to support hold and booking flow

-- Add athleteId to SelectedSlots (track who holds the slot)
ALTER TABLE "SelectedSlots" ADD COLUMN "athleteId" TEXT;

-- Add athleteLabel to Booking (for Private sessions)
ALTER TABLE "Booking" ADD COLUMN "athleteLabel" TEXT;

-- Add athleteId and enrollmentType to BookingSeat
ALTER TABLE "BookingSeat" ADD COLUMN "athleteId" TEXT;
ALTER TABLE "BookingSeat" ADD COLUMN "enrollmentType" TEXT;

-- Add athleteId to Attendee
ALTER TABLE "Attendee" ADD COLUMN "athleteId" TEXT;

-- Create indexes for athleteId fields
CREATE INDEX "SelectedSlots_athleteId_idx" ON "SelectedSlots"("athleteId");
CREATE INDEX "BookingSeat_athleteId_idx" ON "BookingSeat"("athleteId");
CREATE INDEX "Attendee_athleteId_idx" ON "Attendee"("athleteId");
