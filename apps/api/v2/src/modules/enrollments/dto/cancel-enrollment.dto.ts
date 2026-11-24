import { IsOptional, IsString, IsBoolean } from "class-validator";

export class CancelEnrollmentDto {
  @IsOptional()
  @IsBoolean()
  trainerCaused?: boolean;

  @IsOptional()
  @IsString()
  cancellationReason?: string;
}

export class CancelResponseDto {
  kind!: "GROUP" | "PRIVATE";
  timingTag!: "on_time" | "late";
  trainerCaused!: boolean;
  policyOutcome!: "full_refund" | "credit" | "no_refund";
}
