import { IsString, IsOptional, IsIn } from "class-validator";

export class ConfirmHoldDto {
  @IsString()
  athleteId!: string; // Must match the hold's athleteId

  // For GROUP enrollments
  @IsOptional()
  @IsString()
  @IsIn(["drop_in", "membership"])
  enrollmentType?: "drop_in" | "membership";

  // For PRIVATE enrollments
  @IsOptional()
  @IsString()
  athleteLabel?: string; // Display name for private sessions
}
