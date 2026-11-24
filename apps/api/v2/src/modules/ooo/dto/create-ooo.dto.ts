import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsOptional, IsString } from "class-validator";

export class CreateOooDto {
  @ApiProperty({ description: "Trainer user ID (for admins) or omit to use authenticated user" })
  @IsOptional()
  @IsInt()
  userId?: number;

  @ApiProperty({ description: "OOO start date/time (ISO 8601)", example: "2024-12-15T00:00:00Z" })
  @IsDateString()
  start!: string;

  @ApiProperty({ description: "OOO end date/time (ISO 8601)", example: "2024-12-20T23:59:59Z" })
  @IsDateString()
  end!: string;

  @ApiPropertyOptional({ description: "Optional notes about the OOO" })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: "Optional reason ID from OutOfOfficeReason table" })
  @IsOptional()
  @IsInt()
  reasonId?: number;

  @ApiPropertyOptional({ description: "Optional user ID to redirect bookings to" })
  @IsOptional()
  @IsInt()
  toUserId?: number;
}
