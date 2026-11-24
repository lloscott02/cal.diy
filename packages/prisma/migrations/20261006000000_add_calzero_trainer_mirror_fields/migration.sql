-- AlterTable
ALTER TABLE "users" ADD COLUMN "opsUserId" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "calendarStatus" TEXT NOT NULL DEFAULT 'not_connected';

-- CreateIndex
CREATE UNIQUE INDEX "users_opsUserId_key" ON "users"("opsUserId");

-- CreateIndex
CREATE INDEX "users_opsUserId_idx" ON "users"("opsUserId");
