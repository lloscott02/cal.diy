import { Injectable, ConflictException } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

/**
 * VersionCheckService - Optimistic locking for concurrent updates
 *
 * Ground Zero expects entity versioning to prevent lost updates in concurrent scenarios.
 * This service provides:
 * 1. checkVersion() - Verify entity hasn't changed since read
 * 2. incrementVersion() - Auto-increment version on successful update
 * 3. getVersion() - Read current version
 *
 * Supported entities: Booking, Schedule, OutOfOfficeEntry, SelectedSlots
 *
 * Usage in service methods:
 * ```typescript
 * async updateBooking(id: number, expectedVersion: number, data: any) {
 *   await this.versionCheck.checkVersion('booking', id, expectedVersion);
 *
 *   const updated = await this.prisma.booking.update({
 *     where: { id },
 *     data: { ...data, version: { increment: 1 } }
 *   });
 *
 *   return updated;
 * }
 * ```
 */
@Injectable()
export class VersionCheckService {
  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly prismaWrite: PrismaWriteService
  ) {}

  /**
   * Check if entity version matches expected version
   * Throws 409 stale_version if mismatch
   *
   * @param entity - Entity type (booking | schedule | outOfOfficeEntry | selectedSlots)
   * @param id - Entity ID
   * @param expectedVersion - Version from client's read
   */
  async checkVersion(entity: VersionedEntity, id: number | string, expectedVersion: number): Promise<void> {
    const currentVersion = await this.getVersion(entity, id);

    if (currentVersion === null) {
      throw new ConflictException({
        code: "not_found",
        message: `${entity} not found`,
        retryable: false,
      });
    }

    if (currentVersion !== expectedVersion) {
      throw new ConflictException({
        code: "stale_version",
        message: `Entity has been modified. Expected version ${expectedVersion}, current version is ${currentVersion}`,
        retryable: false,
        details: {
          expected_version: expectedVersion,
          current_version: currentVersion,
          entity,
          id,
        },
      });
    }
  }

  /**
   * Get current version of an entity
   *
   * @param entity - Entity type
   * @param id - Entity ID
   * @returns Current version number, or null if not found
   */
  async getVersion(entity: VersionedEntity, id: number | string): Promise<number | null> {
    const prisma = this.prismaRead.prisma;

    let record;

    switch (entity) {
      case "booking":
        record = await prisma.booking.findUnique({
          where: typeof id === "number" ? { id } : { uid: id },
          select: { version: true },
        });
        break;

      case "schedule":
        record = await prisma.schedule.findUnique({
          where: { id: id as number },
          select: { version: true },
        });
        break;

      case "outOfOfficeEntry":
        record = await prisma.outOfOfficeEntry.findUnique({
          where: typeof id === "number" ? { id } : { uuid: id },
          select: { version: true },
        });
        break;

      case "selectedSlots":
        record = await prisma.selectedSlots.findUnique({
          where: { id: id as number },
          select: { version: true },
        });
        break;

      default:
        throw new Error(`Unsupported entity type: ${entity}`);
    }

    return record?.version ?? null;
  }

  /**
   * Increment version (called automatically in update operations)
   * This is typically used in Prisma update calls: `version: { increment: 1 }`
   *
   * For manual increment:
   * @param entity - Entity type
   * @param id - Entity ID
   */
  async incrementVersion(entity: VersionedEntity, id: number | string): Promise<number> {
    const prisma = this.prismaWrite.prisma;

    let updated;

    switch (entity) {
      case "booking":
        updated = await prisma.booking.update({
          where: typeof id === "number" ? { id } : { uid: id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        break;

      case "schedule":
        updated = await prisma.schedule.update({
          where: { id: id as number },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        break;

      case "outOfOfficeEntry":
        updated = await prisma.outOfOfficeEntry.update({
          where: typeof id === "number" ? { id } : { uuid: id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        break;

      case "selectedSlots":
        updated = await prisma.selectedSlots.update({
          where: { id: id as number },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        break;

      default:
        throw new Error(`Unsupported entity type: ${entity}`);
    }

    return updated.version;
  }
}

/**
 * Supported entity types for versioning
 */
export type VersionedEntity = "booking" | "schedule" | "outOfOfficeEntry" | "selectedSlots";
