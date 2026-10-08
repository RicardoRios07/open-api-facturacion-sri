import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SriEmisionProcessor } from './sri-emision.processor';
import { FacturaService } from '../services/factura.service';
import { NotaVentaService } from '../services/nota-venta.service';
import { NotaCreditoService } from '../services/nota-credito.service';
import { NotaDebitoService } from '../services/nota-debito.service';
import { RetencionService } from '../services/retencion.service';
import { GuiaRemisionService } from '../services/guia-remision.service';
import { DatabaseService } from '../../../database';

/**
 * Tests unitarios para SriEmisionProcessor
 * Cubre delegación por tipo de comprobante y manejo de errores
 */
describe('SriEmisionProcessor', () => {
  let processor: SriEmisionProcessor;
  let facturaService: jest.Mocked<FacturaService>;
  let notaVentaService: jest.Mocked<NotaVentaService>;
  let notaCreditoService: jest.Mocked<NotaCreditoService>;
  let notaDebitoService: jest.Mocked<NotaDebitoService>;
  let retencionService: jest.Mocked<RetencionService>;
  let guiaRemisionService: jest.Mocked<GuiaRemisionService>;
  let databaseQuery: jest.Mock;

  function createMockJob(
    tipo: string,
    dto: any,
    idempotencia?: Record<string, string>,
  ): Job {
    return {
      id: 'job-test-1',
      data: { tipo, dto, idempotencia },
    } as unknown as Job;
  }

  beforeEach(async () => {
    databaseQuery = jest.fn().mockResolvedValue({ rows: [] });
    const module = await Test.createTestingModule({
      providers: [
        SriEmisionProcessor,
        {
          provide: FacturaService,
          useValue: { emitirFactura: jest.fn() },
        },
        {
          provide: NotaVentaService,
          useValue: { emitirNotaVenta: jest.fn() },
        },
        {
          provide: NotaCreditoService,
          useValue: { emitirNotaCredito: jest.fn() },
        },
        {
          provide: NotaDebitoService,
          useValue: { emitirNotaDebito: jest.fn() },
        },
        {
          provide: RetencionService,
          useValue: { emitirRetencion: jest.fn() },
        },
        {
          provide: GuiaRemisionService,
          useValue: { emitirGuiaRemision: jest.fn() },
        },
        { provide: DatabaseService, useValue: { query: databaseQuery } },
      ],
    }).compile();

    processor = module.get(SriEmisionProcessor);
    facturaService = module.get(FacturaService);
    notaVentaService = module.get(NotaVentaService);
    notaCreditoService = module.get(NotaCreditoService);
    notaDebitoService = module.get(NotaDebitoService);
    retencionService = module.get(RetencionService);
    guiaRemisionService = module.get(GuiaRemisionService);
  });

  // ==========================================
  // U-PROC-01: Procesa job de tipo FACTURA
  // ==========================================
  it('U-PROC-01: Job tipo FACTURA delega a facturaService.emitirFactura', async () => {
    const mockDto = { fechaEmision: '07/02/2026' };
    const mockResponse = {
      success: true,
      claveAcceso: 'test123',
      estado: 'AUTORIZADO',
    };
    facturaService.emitirFactura.mockResolvedValue(mockResponse as any);

    const result = await processor.process(createMockJob('FACTURA', mockDto));

    expect(facturaService.emitirFactura).toHaveBeenCalledWith(mockDto);
    expect(result).toEqual(mockResponse);
  });

  // ==========================================
  // U-PROC-02: Tipo no soportado lanza error
  // ==========================================
  it('U-PROC-02: Tipo no soportado lanza Error', async () => {
    await expect(
      processor.process(createMockJob('TIPO_DESCONOCIDO', {})),
    ).rejects.toThrow('Tipo de comprobante no soportado: TIPO_DESCONOCIDO');
  });

  // ==========================================
  // U-PROC-03: Error del servicio se propaga
  // ==========================================
  it('U-PROC-03: Error de facturaService se propaga sin swallow', async () => {
    facturaService.emitirFactura.mockRejectedValue(new Error('SRI timeout'));

    await expect(
      processor.process(createMockJob('FACTURA', {})),
    ).rejects.toThrow('SRI timeout');
  });

  it('U-PROC-IDEMP-01: conserva clave y resultado consultable al terminar', async () => {
    const identity = {
      emisorRuc: '0924383631001',
      tipoComprobante: 'FACTURA',
      tipoSistemaExterno: 'vendi',
      idReferenciaExterna: 'order_123',
    };
    facturaService.emitirFactura.mockResolvedValue({
      success: true,
      claveAcceso: 'access-key',
      estado: 'AUTORIZADO',
      xmlAutorizado: '<xml/>',
    } as any);

    await processor.process(createMockJob('FACTURA', {}, identity));

    expect(databaseQuery).toHaveBeenCalledTimes(2);
    expect(databaseQuery.mock.calls[0][1][4]).toBe('PROCESANDO');
    expect(databaseQuery.mock.calls[1][1][4]).toBe('COMPLETADA');
    expect(JSON.parse(databaseQuery.mock.calls[1][1][7])).toEqual(
      expect.objectContaining({
        estado: 'AUTORIZADO',
        claveAcceso: 'access-key',
      }),
    );
    expect(databaseQuery.mock.calls[1][1][7]).not.toContain('<xml/>');
  });

  it('U-PROC-IDEMP-02: un error queda marcado para revisión y no se reemite solo', async () => {
    const identity = {
      emisorRuc: '0924383631001',
      tipoComprobante: 'NOTA_VENTA',
      tipoSistemaExterno: 'vendi',
      idReferenciaExterna: 'order_123',
    };
    notaVentaService.emitirNotaVenta.mockRejectedValue(new Error('timeout'));

    await expect(
      processor.process(createMockJob('NOTA_VENTA', {}, identity)),
    ).rejects.toThrow('timeout');

    expect(databaseQuery.mock.calls.at(-1)?.[1][4]).toBe('REQUIERE_REVISION');
  });
});
