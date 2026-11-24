import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { Observable, of } from "rxjs";
import { tap } from "rxjs/operators";
import * as crypto from "crypto";

/**
 * IdempotencyInterceptor - Prevents duplicate requests
 *
 * Ground Zero requires idempotency for all mutation operations.
 * This interceptor:
 * 1. Requires Idempotency-Key header on POST/PUT/PATCH/DELETE
 * 2. Caches responses for 24 hours keyed by idempotency key
 * 3. Returns cached response if same key + same body
 * 4. Returns 409 idempotency_conflict if same key + different body
 *
 * Cache keys: idem:{idempotency-key}
 * Cache value: { bodyHash: string, response: any, timestamp: number }
 * Cache TTL: 24 hours (86400 seconds)
 *
 * Usage:
 * Apply globally or per-controller:
 * @UseInterceptors(IdempotencyInterceptor)
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly cache = new Map<string, { bodyHash: string; response: any; timestamp: number }>();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Only apply to mutation methods
    if (!this.MUTATION_METHODS.includes(method)) {
      return next.handle();
    }

    // Extract idempotency key
    const idempotencyKey = request.headers["idempotency-key"];

    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "idempotency_key_required",
        message: "Idempotency-Key header is required for mutation operations",
        retryable: false,
      });
    }

    // Validate idempotency key format (should be UUID-like)
    if (!/^[a-f0-9-]{20,50}$/i.test(idempotencyKey)) {
      throw new BadRequestException({
        code: "invalid_idempotency_key",
        message: "Idempotency-Key must be a valid UUID or similar unique identifier",
        retryable: false,
      });
    }

    // Compute body hash
    const rawBody = request.rawBody || JSON.stringify(request.body || {});
    const bodyHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");

    // Check cache
    const cacheKey = `idem:${idempotencyKey}`;
    const cached = this.cache.get(cacheKey);

    if (cached) {
      // Clean up expired entries
      if (Date.now() - cached.timestamp > this.CACHE_TTL_MS) {
        this.cache.delete(cacheKey);
      } else {
        // Entry still valid
        if (cached.bodyHash === bodyHash) {
          // Same request - return cached response
          return of(cached.response);
        } else {
          // Different body with same key - conflict
          throw new ConflictException({
            code: "idempotency_conflict",
            message: "Idempotency-Key already used with different request body",
            retryable: false,
            details: {
              idempotency_key: idempotencyKey,
            },
          });
        }
      }
    }

    // Execute request and cache result
    return next.handle().pipe(
      tap((response) => {
        // Cache the response
        this.cache.set(cacheKey, {
          bodyHash,
          response,
          timestamp: Date.now(),
        });

        // Cleanup old entries periodically (every 100 requests)
        if (Math.random() < 0.01) {
          this.cleanupExpiredEntries();
        }
      })
    );
  }

  /**
   * Remove expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL_MS) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear all cache entries (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size (useful for monitoring)
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
