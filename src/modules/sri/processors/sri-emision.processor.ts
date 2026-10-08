import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FacturaService } from '../services/factura.service';
import { NotaVentaService } from '../services/nota-venta.service';
import { NotaCreditoService } from '../services/nota-credito.service';
import { NotaDebitoService } from '../services/nota-debito.service';
import { RetencionService } from '../services/retencion.service';
import { GuiaRemisionService } from '../services/guia-remision.service';
import { DatabaseService } from '../../../database';

@Processor('sri-emision')
export class SriEmisionProcessor extends WorkerHost {
  private readonly logger = new Logger(SriEmisionProcessor.name);

  constructor(
    private readonly facturaService: FacturaService,
    private readonly notaVentaService: NotaVentaService,
    private readonly notaCreditoService: NotaCreditoService,
    private readonly notaDebitoService: NotaDebitoService,
    private readonly retencionService: RetencionService,
    private readonly guiaRemisionService: GuiaRemisionService,
    private readonly db: DatabaseService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { tipo, dto, idempotencia } = job.data;
    this.logger.log(
      `Procesando emisión asíncrona de ${tipo} - Job ID: ${job.id}`,
    );

    try {
      if (idempotencia) {
        await this.actualizarIdempotencia(idempotencia, {
          estado: 'PROCESANDO',
          jobId: String(job.id),
        });
      }

      const result = await (async () => {
        switch (tipo) {
          case 'FACTURA':
            return await this.facturaService.emitirFactura(dto);
          case 'NOTA_VENTA':
            return await this.notaVentaService.emitirNotaVenta(dto);
          case 'NOTA_CREDITO':
            return await this.notaCreditoService.emitirNotaCredito(dto);
          case 'NOTA_DEBITO':
            return await this.notaDebitoService.emitirNotaDebito(dto);
          case 'RETENCION':
            return await this.retencionService.emitirRetencion(dto);
          case 'GUIA_REMISION':
            return await this.guiaRemisionService.emitirGuiaRemision(dto);
          default:
            throw new Error(`Tipo de comprobante no soportado: ${tipo}`);
        }
      })();

      if (idempotencia) {
        const response = result as unknown as Record<string, unknown>;
        const safeResult = {
          success: response.success,
          estado: response.estado,
          claveAcceso: response.claveAcceso,
          fechaAutorizacion: response.fechaAutorizacion,
          numeroAutorizacion: response.numeroAutorizacion,
          mensajes: response.mensajes,
        };
        await this.actualizarIdempotencia(idempotencia, {
          estado: 'COMPLETADA',
          claveAcceso:
            typeof response.claveAcceso === 'string'
              ? response.claveAcceso
              : null,
          resultado: safeResult,
          jobId: String(job.id),
        });
      }
      return result;
    } catch (error: any) {
      if (idempotencia) {
        try {
          await this.actualizarIdempotencia(idempotencia, {
            estado: 'REQUIERE_REVISION',
            error: error.message,
            jobId: String(job.id),
          });
        } catch (persistError) {
          this.logger.error(
            `No se pudo guardar el estado idempotente del job ${job.id}: ${(persistError as Error).message}`,
          );
        }
      }
      this.logger.error(
        `Error procesando job ${job.id} de tipo ${tipo}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async actualizarIdempotencia(
    identity: {
      emisorRuc: string;
      tipoComprobante: string;
      tipoSistemaExterno: string;
      idReferenciaExterna: string;
    },
    update: {
      estado: string;
      jobId: string;
      claveAcceso?: string | null;
      resultado?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<void> {
    await this.db.query(
      `UPDATE sri_emision_idempotencia
          SET estado = $5,
              job_id = $6,
              clave_acceso = COALESCE($7, clave_acceso),
              resultado_json = COALESCE($8::jsonb, resultado_json),
              error_message = $9,
              updated_at = NOW()
        WHERE emisor_ruc = $1 AND tipo_comprobante = $2
          AND tipo_sistema_externo = $3 AND id_referencia_externa = $4`,
      [
        identity.emisorRuc,
        identity.tipoComprobante,
        identity.tipoSistemaExterno,
        identity.idReferenciaExterna,
        update.estado,
        update.jobId,
        update.claveAcceso ?? null,
        update.resultado ? JSON.stringify(update.resultado) : null,
        update.error?.slice(0, 300) ?? null,
      ],
    );
  }
}
