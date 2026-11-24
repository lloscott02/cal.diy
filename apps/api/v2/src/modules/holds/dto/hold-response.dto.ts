export interface HoldResponseDto {
  status: "success";
  data: {
    holdId: string;
    kind: "GROUP" | "PRIVATE";
    athleteId: string;
    startsAt: string; // ISO 8601
    endsAt: string; // ISO 8601
    expiresAt: string; // ISO 8601
    occurrenceId?: string; // For GROUP
    bookingId?: string; // For confirmed enrollments
  };
}

export interface ConfirmResponseDto {
  status: "success";
  data: {
    enrollmentId: string;
    kind: "GROUP" | "PRIVATE";
    athleteId: string;
    startsAt: string;
    endsAt: string;
    bookingId?: string; // For PRIVATE
    seatId?: string; // For GROUP
  };
}
