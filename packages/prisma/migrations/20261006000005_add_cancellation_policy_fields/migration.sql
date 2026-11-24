-- AlterTable: Add cancellation policy fields to Booking

-- Add timingTag (on_time | late)
ALTER TABLE "Booking" ADD COLUMN "timingTag" TEXT;

-- Add trainerCaused flag (defaults to false)
ALTER TABLE "Booking" ADD COLUMN "trainerCaused" BOOLEAN NOT NULL DEFAULT false;

-- Add policyOutcome (full_refund | credit | no_refund)
ALTER TABLE "Booking" ADD COLUMN "policyOutcome" TEXT;
