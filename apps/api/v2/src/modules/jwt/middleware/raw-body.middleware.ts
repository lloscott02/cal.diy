import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import * as rawBodyParser from "raw-body";

/**
 * RawBodyMiddleware - Captures raw request body for HMAC verification
 *
 * NestJS/Express automatically parses JSON bodies, but HMAC signature
 * verification requires the original raw bytes. This middleware:
 * 1. Captures the raw body before parsing
 * 2. Attaches it to request.rawBody
 * 3. Allows normal JSON parsing to continue
 *
 * Must be applied BEFORE body-parser middleware.
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  async use(req: Request & { rawBody?: string }, res: Response, next: NextFunction) {
    // Only capture raw body for POST/PUT/PATCH/DELETE
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }

    try {
      const raw = await rawBodyParser(req, {
        length: req.headers["content-length"],
        limit: "10mb",
        encoding: "utf8",
      });

      // Store raw body on request object
      req.rawBody = raw.toString("utf8");

      // Also parse as JSON and attach to req.body
      // (This mimics what body-parser would do)
      if (req.headers["content-type"]?.includes("application/json")) {
        try {
          req.body = JSON.parse(req.rawBody);
        } catch (e) {
          // Invalid JSON - let the controller handle it
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }
}
