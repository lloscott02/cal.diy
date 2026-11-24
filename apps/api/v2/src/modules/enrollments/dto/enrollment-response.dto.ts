export interface CancelResponseDto {
  status: "success";
  data: {
    enrollmentId: string;
    kind: "GROUP" | "PRIVATE";
    timingTag: "on_time" | "late";
    trainerCaused: boolean;
    policyOutcome: "full_refund" | "credit" | "no_refund";
    cancelledAt: string; // ISO 8601
  };
}

export interface RescheduleResponseDto {
  status: "success";
  data: {
    enrollmentId: string;
    kind: "GROUP" | "PRIVATE";
    oldStartTime: string; // ISO 8601
    newStartTime: string; // ISO 8601
    policyOutcome?: "full_refund" | "credit" | "no_refund";
    rescheduledAt: string; // ISO 8601
  };
}
