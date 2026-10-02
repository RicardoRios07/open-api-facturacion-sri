import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthService } from '../auth.service';
import { JwtPayload } from '../dto/auth.dto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (
        _request: any,
        rawJwtToken: string,
        done: (err: Error | null, secretOrKey?: string | Buffer) => void,
      ) => {
        try {
          const payload = JSON.parse(
            Buffer.from(rawJwtToken.split('.')[1], 'base64url').toString(),
          );

          if (payload.iss === 'https://admin.etherlab.dev') {
            // Vendi token → RS256 via JWKS
            const jwksUri = configService.get<string>('vendi.jwksUri')!;
            const client = passportJwtSecret({
              cache: true,
              rateLimit: true,
              jwksRequestsPerMinute: 10,
              jwksUri,
            });
            client(_request, rawJwtToken, done);
          } else {
            // Binding Vendi → Open-SRI usa un secreto HS256 dedicado.
            // Los tokens internos de usuarios continúan usando jwt.secret.
            const secret = payload.iss === 'vendi-dashboard'
              ? configService.get<string>('vendi.bindingSecret')
              : configService.get<string>('jwt.secret');
            if (!secret) {
              done(new Error('JWT_SECRET not configured'));
              return;
            }
            done(null, secret);
          }
        } catch (err) {
          // If we can't decode the JWT header, fall back to HS256
          const secret = configService.get<string>('jwt.secret');
          if (secret) {
            done(null, secret);
          } else {
            done(new Error('Invalid token and no JWT_SECRET configured'));
          }
        }
      },
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    return this.authService.validatePayload(payload);
  }
}
