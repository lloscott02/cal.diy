import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { getEnv } from "@/env";
import { JwtService } from "../jwt.service";

/**
 * Guard that verifies JWT tokens issued by Ops (Ground Zero)
 *
 * Extracts the token from the Authorization header, verifies it with
 * the Ops public key, and attaches the payload to the request object.
 *
 * Usage:
 * @UseGuards(OpsJwtGuard)
 * async myEndpoint(@Request() req) {
 *   const opsUserId = req.user.sub;
 *   const isAdmin = req.user.isAdmin;
 * }
 */
@Injectable()
export class OpsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract token from Authorization header
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    // Get Ops public key from environment
    const publicKey = getEnv('OPS_JWT_PUBLIC_KEY');
    if (!publicKey) {
      throw new Error('OPS_JWT_PUBLIC_KEY not configured');
    }

    try {
      // Verify the token
      const payload = await this.jwtService.verifyOpsToken(token, publicKey);

      // Attach payload to request for use in controllers
      request.user = payload;

      return true;
    } catch (error) {
      const err = error as Error;
      throw new UnauthorizedException(`Invalid token: ${err.message}`);
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
