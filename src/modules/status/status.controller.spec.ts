import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { SriHealthIndicator } from './sri.health';

/**
 * Contrato de /health: el HEALTHCHECK del Dockerfile (cada 30s) apunta acá,
 * así que este endpoint NO puede generar tráfico externo (HEAD a celcer)
 * ni ruido de logs (lectura de templates). /status conserva el diagnóstico completo.
 */
describe('StatusController — /health (liveness) vs /status (completo)', () => {
  const checkMock = jest
    .fn()
    .mockImplementation(async (thunks: Array<() => Promise<unknown>>) => {
      const info: Record<string, unknown> = {};
      for (const thunk of thunks) {
        Object.assign(info, (await thunk()) as object);
      }
      return { status: 'ok', info, error: {}, details: info };
    });
  const dbIsHealthy = jest
    .fn()
    .mockResolvedValue({ database: { status: 'up' } });
  const redisIsHealthy = jest
    .fn()
    .mockResolvedValue({ redis: { status: 'up' } });
  const checkHeap = jest
    .fn()
    .mockResolvedValue({ memory_heap: { status: 'up' } });
  const checkRSS = jest
    .fn()
    .mockResolvedValue({ memory_rss: { status: 'up' } });
  const sriIsHealthy = jest
    .fn()
    .mockResolvedValue({ sri_soap: { status: 'up' } });
  const getStatus = jest.fn().mockReturnValue({
    success: true,
    status: 'ok',
    message: 'Servidor funcionando correctamente',
    data: { directories: {}, fileCount: {}, templates: [] },
  });

  let controller: StatusController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [
        { provide: HealthCheckService, useValue: { check: checkMock } },
        {
          provide: DatabaseHealthIndicator,
          useValue: { isHealthy: dbIsHealthy },
        },
        {
          provide: RedisHealthIndicator,
          useValue: { isHealthy: redisIsHealthy },
        },
        {
          provide: MemoryHealthIndicator,
          useValue: { checkHeap, checkRSS },
        },
        { provide: SriHealthIndicator, useValue: { isHealthy: sriIsHealthy } },
        { provide: StatusService, useValue: { getStatus } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, def?: unknown) => def) },
        },
      ],
    }).compile();

    controller = module.get(StatusController);
  });

  describe('GET /health', () => {
    it('corre solo checks locales (database, redis, memoria) — sin sri_soap', async () => {
      const result = (await controller.getHealth()) as unknown as {
        info: Record<string, { status: string }>;
      };

      expect(Object.keys(result.info).sort()).toEqual([
        'database',
        'memory_heap',
        'memory_rss',
        'redis',
      ]);
      expect(dbIsHealthy).toHaveBeenCalledTimes(1);
      expect(redisIsHealthy).toHaveBeenCalledTimes(1);
      expect(checkHeap).toHaveBeenCalledTimes(1);
      expect(checkRSS).toHaveBeenCalledTimes(1);
    });

    it('no hace HEAD al WSDL de celcer (el probe de Docker no genera tráfico externo)', async () => {
      await controller.getHealth();
      expect(sriIsHealthy).not.toHaveBeenCalled();
    });

    it('no lee templates (statusService.getStatus no se invoca → cero log spam)', async () => {
      await controller.getHealth();
      expect(getStatus).not.toHaveBeenCalled();
    });

    it('usa los thresholds de memoria de configuración (defaults 150/300 MB)', async () => {
      await controller.getHealth();
      expect(checkHeap).toHaveBeenCalledWith('memory_heap', 150 * 1024 * 1024);
      expect(checkRSS).toHaveBeenCalledWith('memory_rss', 300 * 1024 * 1024);
    });
  });

  describe('GET /status', () => {
    it('mantiene el diagnóstico completo: sri_soap + info de templates', async () => {
      await controller.getStatus();

      expect(sriIsHealthy).toHaveBeenCalledWith('sri_soap');
      expect(getStatus).toHaveBeenCalledTimes(1);
    });
  });
});
