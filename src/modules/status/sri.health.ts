import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';

/**
 * Health check de conectividad SOAP al SRI Ecuador.
 * Hace un HEAD request al WSDL de recepción con timeout de 5s.
 * Útil para K8s readinessProbe: si el SRI es inalcanzable, el pod
 * no debería recibir tráfico de facturación.
 */
@Injectable()
export class SriHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const wsdlUrl = this.configService.getOrThrow<string>('sri.wsdl.reception');

    try {
      const response = await fetch(wsdlUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      // El SRI puede retornar 200 o 405 (Method Not Allowed para HEAD) — ambos indican conectividad
      const isReachable = response.status < 500;
      if (!isReachable) {
        throw new Error(`SRI respondió con status ${response.status}`);
      }

      return this.getStatus(key, true, { url: wsdlUrl });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'SRI inalcanzable';
      throw new HealthCheckError(
        'SRI SOAP unreachable',
        this.getStatus(key, false, { message: msg }),
      );
    }
  }
}
