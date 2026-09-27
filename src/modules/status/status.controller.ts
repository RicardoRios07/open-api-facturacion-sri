import { Controller, Get, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StatusService } from './status.service';
import { Public } from '../auth/decorators/public.decorator';
import {
  HealthCheckService,
  HealthCheck,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { SriHealthIndicator } from './sri.health';

@ApiTags('Status')
@Public()
@Controller()
export class StatusController {
  constructor(
    private readonly statusService: StatusService,
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly sri: SriHealthIndicator,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /health
   * Liveness barato: solo dependencias locales (DB, Redis, memoria).
   * Es el target del HEALTHCHECK del Dockerfile (cada 30s). Por diseño NO
   * llama al SRI ni lee templates, para no generar tráfico externo ni ruido de logs.
   */
  @Get('health')
  @HealthCheck()
  @ApiOperation({ summary: 'Health check local (sin dependencias externas)' })
  @ApiResponse({
    status: 200,
    description: 'Estado de DB, Redis y memoria',
  })
  async getHealth() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', this.memoryHeapLimit()),
      () => this.memory.checkRSS('memory_rss', this.memoryRssLimit()),
    ]);
  }

  /**
   * GET /status
   * Verifica Redis health check, memory thresholds parametrizables y SRI connectivity health check
   */
  @Get('status')
  @HealthCheck()
  @ApiOperation({ summary: 'Obtener estado del servidor y dependencias' })
  @ApiResponse({
    status: 200,
    description: 'Estado del servidor, DB, Redis, memoria y conectividad SRI',
  })
  async getStatus() {
    // Info base estática
    const baseInfo = this.statusService.getStatus();

    // Health checks reales
    const healthCheck = await this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', this.memoryHeapLimit()),
      () => this.memory.checkRSS('memory_rss', this.memoryRssLimit()),
      () => this.sri.isHealthy('sri_soap'),
    ]);

    return {
      ...baseInfo,
      health: healthCheck,
    };
  }

  /**
   * GET /
   * Redirect to status
   */
  @Get()
  @Redirect('/status', 302)
  @ApiOperation({ summary: 'Redirigir a status' })
  root() {
    // Redirect handled by @Redirect decorator
  }

  private memoryHeapLimit(): number {
    const heapMb = this.configService.get<number>(
      'healthChecks.memoryHeapMb',
      150,
    );
    return heapMb * 1024 * 1024;
  }

  private memoryRssLimit(): number {
    const rssMb = this.configService.get<number>(
      'healthChecks.memoryRssMb',
      300,
    );
    return rssMb * 1024 * 1024;
  }
}
