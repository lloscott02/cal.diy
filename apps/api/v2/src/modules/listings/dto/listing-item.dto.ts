/**
 * Unified listing item - either a GROUP occurrence or PRIVATE opening
 */
export type ListingItemDto = GroupListingDto | PrivateListingDto;

export interface GroupListingDto {
  kind: "GROUP";
  occurrenceId: string;
  seriesId: string;
  catalogItemId: string;
  trainerId: string; // Internal Cal.com user ID
  trainerOpsId: string; // Ops system user ID
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601
  availableSeats: number;
  softCap: number;
  hardCap: number;
}

export interface PrivateListingDto {
  kind: "PRIVATE";
  openingKey: string; // "trainerId_startTime_duration" for idempotent holds
  trainerId: string; // Internal Cal.com user ID
  trainerOpsId: string; // Ops system user ID
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601
  durationMinutes: number;
}
