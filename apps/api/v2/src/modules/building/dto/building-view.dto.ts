import { IsDateString, IsOptional } from "class-validator";

export class BuildingQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export interface BuildingViewItemDto {
  kind: "GROUP" | "PRIVATE";
  occurrenceId: string;
  trainerId: string;
  trainerOpsId: string;
  startsAt: string;
  endsAt: string;
  headcount?: number; // For others when viewed by trainer
  rosterAthleteIds?: string[]; // For own sessions or admin
  athleteLabel?: string; // For PRIVATE sessions
  seriesId?: string; // For GROUP sessions
  seriesName?: string; // For GROUP sessions
}

export class BuildingViewResponseDto {
  items!: BuildingViewItemDto[];
}
