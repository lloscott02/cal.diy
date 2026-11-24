import { IsString, IsIn, IsOptional, IsInt, Min } from "class-validator";

export class CreateHoldDto {
  @IsString()
  @IsIn(["GROUP", "PRIVATE"])
  kind!: "GROUP" | "PRIVATE";

  @IsString()
  athleteId!: string; // Ops system athlete ID

  // For GROUP holds
  @IsOptional()
  @IsString()
  occurrenceId?: string;

  // For PRIVATE holds
  @IsOptional()
  @IsString()
  openingKey?: string; // From listings API: "trainerId_startTime_duration"

  @IsOptional()
  @IsString()
  trainerId?: string; // For PRIVATE holds

  @IsOptional()
  @IsString()
  startTime?: string; // ISO 8601

  @IsOptional()
  @IsInt()
  @Min(15)
  durationMinutes?: number;
}
