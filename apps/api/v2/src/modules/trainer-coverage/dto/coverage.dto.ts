import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsString, IsInt, ArrayMinSize } from "class-validator";

// POST /coverage/eligibility request
export class GetEligibilityDto {
  @ApiProperty({
    description: "Array of occurrence UIDs to find coverage for",
    type: [String],
    example: ["occ-uuid-1", "occ-uuid-2"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  occurrenceIds!: string[];
}

// POST /coverage/eligibility response
export class TrainerAvailabilityDto {
  @ApiProperty()
  trainerId!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;
}

export class OccurrenceEligibilityDto {
  @ApiProperty()
  occurrenceId!: string;

  @ApiProperty({ type: [TrainerAvailabilityDto] })
  eligibleTrainers!: TrainerAvailabilityDto[];
}

export class GetEligibilityResponseDto {
  @ApiProperty({ type: [OccurrenceEligibilityDto] })
  data!: OccurrenceEligibilityDto[];
}

// POST /coverage/reassign request
export class ReassignmentDto {
  @ApiProperty({ description: "Occurrence UID to reassign" })
  @IsString()
  occurrenceId!: string;

  @ApiProperty({ description: "Trainer ID to assign to" })
  @IsInt()
  toTrainerId!: number;
}

export class ReassignOccurrencesDto {
  @ApiProperty({
    description: "Array of reassignment requests",
    type: [ReassignmentDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  assignments!: ReassignmentDto[];
}

// POST /coverage/reassign response
export class ReassignResultDto {
  @ApiProperty()
  occurrenceId!: string;

  @ApiProperty()
  toTrainerId!: number;

  @ApiProperty({ required: false })
  error?: string;
}

export class ReassignResponseDto {
  @ApiProperty({ type: [ReassignResultDto] })
  successes!: ReassignResultDto[];

  @ApiProperty({ type: [ReassignResultDto] })
  failures!: ReassignResultDto[];
}
