import { IsOptional, IsString, IsBoolean, IsDateString } from "class-validator";

export class RescheduleEnrollmentDto {
  @IsOptional()
  @IsString()
  newOccurrenceId?: string;

  @IsOptional()
  @IsDateString()
  newStartTime?: string;

  @IsOptional()
  @IsBoolean()
  adminOverride?: boolean;
}

export class RescheduleResponseDto {
  kind: "GROUP" | "PRIVATE";
  oldStartTime: string;
  newStartTime: string;
  policyOutcome?: "full_refund" | "credit" | "no_refund";
}
