import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from "@nestjs/common";
import { Observable } from "rxjs";

/**
 * ActorInterceptor - Extracts and validates acting user context
 *
 * Ground Zero sends actor information on every user-initiated request:
 * - X-Acting-User: Ground Zero user ID who initiated the action
 * - X-Acting-Role: client | trainer | admin | owner
 *
 * This interceptor:
 * 1. Extracts actor headers
 * 2. Validates role values
 * 3. Attaches actor info to request.actor
 * 4. Used for permission enforcement and audit logging
 *
 * Usage in controllers:
 * ```typescript
 * @UseInterceptors(ActorInterceptor)
 * async myEndpoint(@Request() req) {
 *   const actorUserId = req.actor.userId;
 *   const actorRole = req.actor.role;
 *   const requestId = req.actor.requestId;
 *
 *   // Enforce permissions
 *   if (req.actor.role !== 'owner') {
 *     throw new ForbiddenException('Only owner can perform this action');
 *   }
 * }
 * ```
 */
@Injectable()
export class ActorInterceptor implements NestInterceptor {
  private readonly VALID_ROLES = ["client", "trainer", "admin", "owner"];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Extract actor headers
    const actingUser = request.headers["x-acting-user"];
    const actingRole = request.headers["x-acting-role"];
    const requestId = request.headers["x-request-id"];

    // Validate role if provided
    if (actingRole && !this.VALID_ROLES.includes(actingRole)) {
      throw new BadRequestException({
        code: "invalid_acting_role",
        message: `X-Acting-Role must be one of: ${this.VALID_ROLES.join(", ")}`,
        retryable: false,
        details: {
          received: actingRole,
          valid_roles: this.VALID_ROLES,
        },
      });
    }

    // Attach actor info to request
    request.actor = {
      userId: actingUser || null,
      role: (actingRole as ActorRole) || null,
      requestId: requestId || null,
    };

    return next.handle();
  }
}

/**
 * Actor information attached to request
 */
export interface ActorInfo {
  userId: string | null;
  role: ActorRole | null;
  requestId: string | null;
}

/**
 * Valid actor roles from Ground Zero
 */
export type ActorRole = "client" | "trainer" | "admin" | "owner";

/**
 * Helper to check if actor has required role
 *
 * @param actor - Actor info from request
 * @param requiredRole - Minimum role required
 * @returns True if actor has required role or higher
 */
export function hasRole(actor: ActorInfo, requiredRole: ActorRole): boolean {
  if (!actor.role) {
    return false;
  }

  const roleHierarchy: Record<ActorRole, number> = {
    client: 1,
    trainer: 2,
    admin: 3,
    owner: 4,
  };

  return roleHierarchy[actor.role] >= roleHierarchy[requiredRole];
}

/**
 * Decorator to require specific role
 *
 * Usage:
 * ```typescript
 * @RequireRole('owner')
 * async offboardTrainer() { ... }
 * ```
 */
export const RequireRole = (role: ActorRole) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const request = args[0]; // First arg is typically request in NestJS

      if (request.actor && !hasRole(request.actor, role)) {
        throw new BadRequestException({
          code: "permission_denied",
          message: `This action requires ${role} role or higher`,
          retryable: false,
        });
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
};

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      actor?: ActorInfo;
    }
  }
}
