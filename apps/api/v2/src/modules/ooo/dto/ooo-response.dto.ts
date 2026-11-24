import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class OooResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  uuid!: string;

  @ApiProperty()
  userId!: number;

  @ApiProperty()
  start!: Date;

  @ApiProperty()
  end!: Date;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiPropertyOptional()
  reasonId?: number | null;

  @ApiPropertyOptional()
  toUserId?: number | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional()
  reason?: {
    id: number;
    emoji: string;
    reason: string;
  } | null;

  @ApiPropertyOptional()
  toUser?: {
    id: number;
    name: string | null;
    email: string;
  } | null;
}

export class OooListResponseDto {
  @ApiProperty({ type: [OooResponseDto] })
  data!: OooResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
