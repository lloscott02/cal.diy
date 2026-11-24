import { Injectable } from "@nestjs/common";
import { JwtService as NestJwtService } from "@nestjs/jwt";

@Injectable()
export class JwtService {
  constructor(private readonly nestJwtService: NestJwtService) {}

  signAccessToken(payload: Payload) {
    const accessToken = this.sign({ type: "access_token", ...payload });
    return accessToken;
  }

  signRefreshToken(payload: Payload) {
    const refreshToken = this.sign({ type: "refresh_token", ...payload });
    return refreshToken;
  }

  sign(payload: Payload) {
    const issuedAtTime = this.getIssuedAtTime();

    const token = this.nestJwtService.sign({ ...payload, iat: issuedAtTime });
    return token;
  }

  getIssuedAtTime() {
    // divided by 1000 because iat (issued at time) is in seconds (not milliseconds) as informed by JWT specification
    return Math.floor(Date.now() / 1000);
  }

  decode(token: string): Payload {
    return this.nestJwtService.decode(token) as Payload;
  }

  /**
   * Verify a JWT token signed by an external issuer (Ops)
   * Uses asymmetric verification with a public key
   */
  async verifyOpsToken(token: string, publicKey: string): Promise<OpsJwtPayload> {
    try {
      const verified = await this.nestJwtService.verifyAsync(token, {
        publicKey,
        algorithms: ['RS256'], // Asymmetric signing
      });

      // Validate required Ops claims
      if (!verified.sub || !verified.aud || verified.aud !== 'calzero') {
        throw new Error('Invalid Ops JWT: missing required claims');
      }

      return verified as OpsJwtPayload;
    } catch (error) {
      throw new Error(`Ops JWT verification failed: ${error.message}`);
    }
  }
}

type Payload = Record<string | number | symbol, any>;

export interface OpsJwtPayload {
  sub: string;          // Ops user ID
  isAdmin?: boolean;
  isTrainer?: boolean;
  isOwner?: boolean;
  trainerId?: string;
  aud: string;          // Must be "calzero"
  iat: number;          // Issued at
  exp: number;          // Expires at
  jti?: string;         // JWT ID
}
