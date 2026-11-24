import { IsDateString, IsOptional, IsInt, Min, IsArray } from "class-validator";
import { Type } from "class-transformer";

export class ListingsQueryDto {
  @IsDateString()
  from!: string; // ISO 8601 date

  @IsDateString()
  to!: string; // ISO 8601 date

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  durationMinutes?: number; // Default 60 if not provided

  @IsOptional()
  @IsArray()
  trainerIds?: string[]; // Filter by specific trainers (opsUserIds)
}
