import type { OutOfOfficeEntry, Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

@Injectable()
export class OooRepository {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async createOOO(
    userId: number,
    start: Date,
    end: Date,
    notes?: string,
    reasonId?: number,
    toUserId?: number
  ): Promise<OutOfOfficeEntry> {
    return this.dbWrite.prisma.outOfOfficeEntry.create({
      data: {
        uuid: crypto.randomUUID(),
        userId,
        start,
        end,
        notes,
        reasonId,
        toUserId,
      },
    });
  }

  async findByUserId(
    userId: number,
    options?: {
      skip?: number;
      take?: number;
      orderBy?: Prisma.OutOfOfficeEntryOrderByWithRelationInput;
    }
  ): Promise<OutOfOfficeEntry[]> {
    return this.dbRead.prisma.outOfOfficeEntry.findMany({
      where: { userId },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { start: "desc" },
      include: {
        reason: true,
        toUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async findById(id: number): Promise<OutOfOfficeEntry | null> {
    return this.dbRead.prisma.outOfOfficeEntry.findUnique({
      where: { id },
      include: {
        reason: true,
        toUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async deleteOOO(id: number): Promise<OutOfOfficeEntry> {
    return this.dbWrite.prisma.outOfOfficeEntry.delete({
      where: { id },
    });
  }

  async countByUserId(userId: number): Promise<number> {
    return this.dbRead.prisma.outOfOfficeEntry.count({
      where: { userId },
    });
  }
}
