import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { Response } from "express";

/**
 * GroundZeroExceptionFilter - Formats errors in Ground Zero's expected envelope
 *
 * Ground Zero expects all errors in this format:
 * ```json
 * {
 *   "error": {
 *     "code": "slot_unavailable",
 *     "message": "That time was just taken.",
 *     "retryable": false,
 *     "details": { "slot_token": "slt_9f2c" }
 *   }
 * }
 * ```
 *
 * This filter:
 * 1. Catches all exceptions
 * 2. Maps to Ground Zero error codes
 * 3. Sets retryable flag (5xx = retryable, 4xx = not retryable)
 * 4. Includes additional details if available
 *
 * Error codes Ground Zero expects:
 * - validation_error
 * - permission_denied
 * - not_found
 * - idempotency_conflict
 * - slot_unavailable
 * - slot_taken_after_expiry
 * - hold_not_found
 * - hold_expired
 * - athlete_not_eligible
 * - group_not_found
 * - group_has_members
 * - trainer_inactive
 * - trainer_setup_incomplete
 * - would_strand_recurring_booking
 * - self_double_booking
 * - stale_version
 * - audit_unavailable
 * - rate_limited
 *
 * Usage:
 * Apply globally in main.ts or module
 * ```typescript
 * app.useGlobalFilters(new GroundZeroExceptionFilter());
 * ```
 */
@Catch()
export class GroundZeroExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Determine status code
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
    }

    // Extract error information
    let errorCode = "internal_error";
    let errorMessage = "An unexpected error occurred";
    let details: any = {};

    if (exception instanceof HttpException) {
      const exceptionResponse: any = exception.getResponse();

      // Check if error already has Ground Zero format
      if (
        typeof exceptionResponse === "object" &&
        exceptionResponse.code &&
        exceptionResponse.message
      ) {
        errorCode = exceptionResponse.code;
        errorMessage = exceptionResponse.message;
        details = exceptionResponse.details || {};
      } else if (typeof exceptionResponse === "object" && exceptionResponse.message) {
        // Standard NestJS validation error
        if (Array.isArray(exceptionResponse.message)) {
          errorCode = "validation_error";
          errorMessage = exceptionResponse.message.join(", ");
          details = { validation_errors: exceptionResponse.message };
        } else {
          errorMessage = exceptionResponse.message;
          errorCode = this.mapStatusToCode(status);
        }
      } else if (typeof exceptionResponse === "string") {
        errorMessage = exceptionResponse;
        errorCode = this.mapStatusToCode(status);
      }
    } else if (exception.message) {
      errorMessage = exception.message;
      errorCode = this.mapStatusToCode(status);
    }

    // Determine if retryable (5xx errors are retryable, 4xx are not)
    const retryable = status >= 500;

    // Include stack trace in development
    if (process.env.NODE_ENV === "development" && exception.stack) {
      details.stack = exception.stack;
    }

    // Send Ground Zero error envelope
    response.status(status).json({
      error: {
        code: errorCode,
        message: errorMessage,
        retryable,
        details,
      },
    });
  }

  /**
   * Map HTTP status code to Ground Zero error code
   */
  private mapStatusToCode(status: number): string {
    const codeMap: Record<number, string> = {
      400: "validation_error",
      401: "unauthorized",
      403: "permission_denied",
      404: "not_found",
      409: "conflict",
      422: "validation_error",
      429: "rate_limited",
      500: "internal_error",
      502: "bad_gateway",
      503: "service_unavailable",
      504: "gateway_timeout",
    };

    return codeMap[status] || "internal_error";
  }
}

/**
 * Helper to throw Ground Zero-formatted errors
 *
 * Usage:
 * ```typescript
 * throw new GroundZeroError(409, {
 *   code: 'slot_unavailable',
 *   message: 'That time was just taken',
 *   details: { slot_token: 'slt_9f2c' }
 * });
 * ```
 */
export class GroundZeroError extends HttpException {
  constructor(
    status: number,
    error: {
      code: string;
      message: string;
      details?: any;
    }
  ) {
    super(error, status);
  }
}
