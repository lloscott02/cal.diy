import {
  CreateOutOfOfficeEntryDto,
  UpdateOutOfOfficeEntryDto,
  OutOfOfficeReason,
} from "@/modules/ooo/inputs/ooo.input";
import { UserOOORepository } from "@/modules/ooo/repositories/ooo.repository";
import { UsersRepository } from "@/modules/users/users.repository";
import { OutboxService } from "@/modules/outbox/services/outbox.service";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";

import type { OutOfOfficeEntry } from "@calcom/prisma/client";

const OOO_REASON_ID_TO_REASON = {
  1: OutOfOfficeReason["UNSPECIFIED"],
  2: OutOfOfficeReason["VACATION"],
  3: OutOfOfficeReason["TRAVEL"],
  4: OutOfOfficeReason["SICK_LEAVE"],
  5: OutOfOfficeReason["PUBLIC_HOLIDAY"],
};

const OOO_REASON_TO_REASON_ID = {
  [OutOfOfficeReason["UNSPECIFIED"]]: 1,
  [OutOfOfficeReason["VACATION"]]: 2,
  [OutOfOfficeReason["TRAVEL"]]: 3,
  [OutOfOfficeReason["SICK_LEAVE"]]: 4,
  [OutOfOfficeReason["PUBLIC_HOLIDAY"]]: 5,
};

@Injectable()
export class UserOOOService {
  constructor(
    private readonly oooRepository: UserOOORepository,
    private readonly usersRepository: UsersRepository,
    private readonly outboxService: OutboxService
  ) {}

  formatOooReason(ooo: OutOfOfficeEntry) {
    return {
      ...ooo,
      reason: ooo.reasonId
        ? OOO_REASON_ID_TO_REASON[ooo.reasonId as keyof typeof OOO_REASON_ID_TO_REASON]
        : OOO_REASON_ID_TO_REASON[1],
    };
  }

  isStartBeforeEnd(start?: Date, end?: Date) {
    if ((end && !start) || (start && !end)) {
      throw new BadRequestException("Please specify both ooo start and end time.");
    }

    if (start && end) {
      if (start.getTime() > end.getTime()) {
        throw new BadRequestException("Start date must be before end date.");
      }
    }
    return true;
  }

  async checkUserEligibleForRedirect(userId: number, toUserId?: number) {
    if (toUserId) {
      const user = await this.usersRepository.findUserOOORedirectEligible(userId, toUserId);
      if (!user) {
        throw new BadRequestException("Cannot redirect to this user.");
      }
    }
  }

  async checkExistingOooRedirect(userId: number, start?: Date, end?: Date, toUserId?: number) {
    if (start && end) {
      const existingOooRedirect = await this.oooRepository.findExistingOooRedirect(
        userId,
        start,
        end,
        toUserId
      );

      if (existingOooRedirect) {
        throw new BadRequestException("Booking redirect infinite not allowed.");
      }
    }
  }

  async checkDuplicateOOOEntry(userId: number, start?: Date, end?: Date) {
    if (start && end) {
      const duplicateEntry = await this.oooRepository.getOooByUserIdAndTime(userId, start, end);

      if (duplicateEntry) {
        throw new ConflictException("Ooo entry already exists.");
      }
    }
  }

  checkRedirectToSelf(userId: number, toUserId?: number) {
    if (toUserId && toUserId === userId) {
      throw new BadRequestException("Cannot redirect to self.");
    }
  }

  async checkIsValidOOO(userId: number, ooo: CreateOutOfOfficeEntryDto | UpdateOutOfOfficeEntryDto) {
    this.isStartBeforeEnd(ooo.start, ooo.end);
    await this.checkExistingOooRedirect(userId, ooo.start, ooo.end, ooo.toUserId);
    await this.checkDuplicateOOOEntry(userId, ooo.start, ooo.end);
    await this.checkRedirectToSelf(userId, ooo.toUserId);
    await this.checkUserEligibleForRedirect(userId, ooo.toUserId);
  }

  async createUserOOO(userId: number, body: CreateOutOfOfficeEntryDto) {
    await this.checkIsValidOOO(userId, body);
    const { reason, ...rest } = body;
    const ooo = await this.oooRepository.createUserOOO({
      ...rest,
      userId,
      reasonId: OOO_REASON_TO_REASON_ID[reason ?? OutOfOfficeReason["UNSPECIFIED"]],
    });

    // Emit OOO_CREATED event
    await this.outboxService.createEvent("OOO_CREATED", {
      oooId: ooo.id.toString(),
      trainerId: userId.toString(),
      start: ooo.start.toISOString(),
      end: ooo.end.toISOString(),
      reason: this.formatOooReason(ooo).reason,
      createdAt: new Date().toISOString(),
    });

    return this.formatOooReason(ooo);
  }

  async updateUserOOO(userId: number, oooId: number, body: UpdateOutOfOfficeEntryDto) {
    await this.checkIsValidOOO(userId, body);
    const { reason, ...rest } = body;
    const data = reason
      ? { ...rest, reasonId: OOO_REASON_TO_REASON_ID[reason ?? OutOfOfficeReason["UNSPECIFIED"]] }
      : rest;
    const ooo = await this.oooRepository.updateUserOOO(oooId, data);

    // Emit OOO_UPDATED event
    await this.outboxService.createEvent("OOO_UPDATED", {
      oooId: ooo.id.toString(),
      trainerId: userId.toString(),
      start: ooo.start.toISOString(),
      end: ooo.end.toISOString(),
      reason: this.formatOooReason(ooo).reason,
      updatedAt: new Date().toISOString(),
    });

    return this.formatOooReason(ooo);
  }

  async deleteUserOOO(oooId: number) {
    const ooo = await this.oooRepository.deleteUserOOO(oooId);

    // Emit OOO_DELETED event
    await this.outboxService.createEvent("OOO_DELETED", {
      oooId: ooo.id.toString(),
      trainerId: ooo.userId.toString(),
      start: ooo.start.toISOString(),
      end: ooo.end.toISOString(),
      deletedAt: new Date().toISOString(),
    });

    return this.formatOooReason(ooo);
  }

  async getUserOOOPaginated(
    userId: number,
    skip: number,
    take: number,
    sort?: { sortStart?: "asc" | "desc"; sortEnd?: "asc" | "desc" }
  ) {
    const ooos = await this.oooRepository.getUserOOOPaginated(userId, skip, take, sort);
    return ooos.map((ooo) => this.formatOooReason(ooo));
  }

  async getUserOOOById(oooId: number) {
    return this.oooRepository.getUserOOOById(oooId);
  }
}
