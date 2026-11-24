import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { getEnv } from "@/env";
import * as crypto from "crypto";

/**
 * HmacGuard - Verifies HMAC-SHA256 signatures from Ground Zero
 *
 * Ground Zero signs every request with:
 * - X-GZero-Timestamp: Unix timestamp (seconds)
 * - X-GZero-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + raw_body)>
 *
 * This guard:
 * 1. Rejects requests with timestamps >5 minutes old (replay protection)
 * 2. Verifies HMAC signature using constant-time comparison
 * 3. Returns 401 with error codes: timestamp_too_old, missing_signature, invalid_signature
 *
 * Usage:
 * @UseGuards(HmacGuard)
 * async myEndpoint(@Body() body: any) {
 *   // Request is authenticated
 * }
 */
@Injectable()
export class HmacGuard implements CanActivate {
  private readonly MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract headers
    const timestamp = request.headers["x-gzero-timestamp"];
    const signature = request.headers["x-gzero-signature"];

    // Validate timestamp exists
    if (!timestamp) {
      throw new UnauthorizedException({
        code: "missing_timestamp",
        message: "X-GZero-Timestamp header is required",
        retryable: false,
      });
    }

    // Validate signature exists
    if (!signature) {
      throw new UnauthorizedException({
        code: "missing_signature",
        message: "X-GZero-Signature header is required",
        retryable: false,
      });
    }

    // Check timestamp age (replay protection)
    const now = Math.floor(Date.now() / 1000);
    const requestTimestamp = parseInt(timestamp, 10);

    if (isNaN(requestTimestamp)) {
      throw new UnauthorizedException({
        code: "invalid_timestamp",
        message: "X-GZero-Timestamp must be a valid Unix timestamp",
        retryable: false,
      });
    }

    const age = now - requestTimestamp;
    if (age > this.MAX_TIMESTAMP_AGE_SECONDS) {
      throw new UnauthorizedException({
        code: "timestamp_too_old",
        message: `Request timestamp is ${age}s old (max ${this.MAX_TIMESTAMP_AGE_SECONDS}s)`,
        retryable: false,
      });
    }

    // Reject future timestamps
    if (age < -60) {
      // Allow 60s clock skew
      throw new UnauthorizedException({
        code: "timestamp_in_future",
        message: "Request timestamp is in the future",
        retryable: false,
      });
    }

    // Get raw body (must be stored by middleware before this guard)
    const rawBody = request.rawBody || "";

    // Get HMAC secret from environment
    const secret = getEnv("GZERO_HMAC_SECRET");
    if (!secret) {
      throw new Error("GZERO_HMAC_SECRET not configured");
    }

    // Compute expected signature
    const payload = `${timestamp}.${rawBody}`;
    const expectedHmac = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");

    const expectedSignature = `sha256=${expectedHmac}`;

    // Extract signature value (format: "sha256=<hex>")
    const receivedSignature = signature;

    // Constant-time comparison to prevent timing attacks
    if (!this.timingSafeEqual(expectedSignature, receivedSignature)) {
      throw new UnauthorizedException({
        code: "invalid_signature",
        message: "HMAC signature verification failed",
        retryable: false,
      });
    }

    return true;
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");

    return crypto.timingSafeEqual(bufA, bufB);
  }
}
