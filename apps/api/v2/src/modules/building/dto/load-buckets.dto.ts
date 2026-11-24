import { IsDateString, IsOptional, IsInt, Min } from "class-validator";
import { Type } from "class-transformer";

export class LoadBucketsQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bucketMinutes?: number = 30;
}

export interface LoadBucketDto {
  bucketStart: string;
  bucketEnd: string;
  bookedMembers: number;
  bookedDropIns: number;
  walkIns: number;
  total: number;
}

export class LoadBucketsResponseDto {
  buckets!: LoadBucketDto[];
}
