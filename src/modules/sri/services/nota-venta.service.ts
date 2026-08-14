import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PoolClient } from 'pg';
import { Decimal } from 'decimal.js';
import { ClaveAccesoService } from './clave-acceso.service';
import { XmlBuilderService } from './xml-builder.service';
import { XmlSignerService } from './xml-signer.service';
import { SriSoapClient } from './sri-soap.client';
import { SriRepositoryService } from './sri-repository.service';
import { XmlStorageService } from './xml-storage.service';
import { SriBaseService } from './sri-base.service';
import { CreateNotaVentaDto, NotaVentaResponseDto } from '../dto';
import {
  NotaVenta,
  InfoTributaria,
  InfoNotaVenta,
  DetalleNotaVenta,
  TotalImpuesto,
  SriOperationResult,
} from '../interfaces';
import { TipoComprobante, Ambiente, TipoEmision } from '../constants';

const CONSUMIDOR_FINAL = {
  tipoIdentificacion: '07',
  identificacion: '9999999999',
  razonSocial: 'CONSUMIDOR FINAL',
} as const;

/**
 * Servicio de emisión de Notas de Venta electrónicas (RIMPE Negocio Popular / RISE).
 *
 * La nota de venta NO desglosa IVA: se declara el total como IVA "no objeto"
 * (código 2 / códigoPorcentaje 6 / valor 0). Sigue el mismo patrón de 3 fases
 * de FacturaService (nunca bloquea el pool de DB durante la llamada SOAP).
 */
@Injectable()
export class NotaVentaService {
  private readonly logger = new Logger(NotaVentaService.name);

  constructor(
    private readonly claveAccesoService: ClaveAccesoService,
    private readonly xmlBuilderService: XmlBuilderService,
    private readonly xmlSignerService: XmlSignerService,
    private readonly sriSoapClient: SriSoapClient,
    private readonly repository: SriRepositoryService,
    private readonly xmlStorage: XmlStorageService,
    private readonly base: SriBaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async emitirNotaVenta(dto: CreateNotaVentaDto): Promise<NotaVentaResponseDto> {
    this.logger.log('Iniciando emisión de nota de venta electrónica');

    try {
      const comprador = dto.comprador || CONSUMIDOR_FINAL;

      if (dto.comprador) {
        this.base.validarIdentificacion(
          comprador.tipoIdentificacion,
          comprador.identificacion,
          'comprador',
        );
      }

      // Validaciones de catálogo + búsqueda de emisor en paralelo
      const [, , emisor] = await Promise.all([
        dto.comprador
          ? this.base.validarTipoIdentificacionCatalogo(
              comprador.tipoIdentificacion,
            )
          : Promise.resolve(),
        dto.pagos && dto.pagos.length > 0
          ? this.base.validarFormasPagoCatalogo(dto.pagos)
          : Promise.resolve(),
        this.repository.findEmisorByRuc(dto.emisor.ruc),
      ]);

      const ambiente = dto.ambiente || this.base.getDefaultAmbiente();
      const tipoEmision = dto.tipoEmision || TipoEmision.NORMAL;
      const [day, month, year] = dto.fechaEmision.split('/');
      const fechaEmision = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
      );

      const puntoEmisionInfo = emisor
        ? await this.repository.findPuntoEmision(
            emisor.id,
            dto.emisor.establecimiento,
            dto.emisor.puntoEmision,
          )
        : null;

      // ─── FASE 1: Transacción corta — Solo reservar secuencial ───
      let secuencial: string;
      if (dto.secuencial) {
        secuencial = dto.secuencial.padStart(9, '0');
      } else {
        if (!puntoEmisionInfo) {
          throw new BadRequestException(
            `No se puede generar secuencial automático: punto de emisión ${dto.emisor.establecimiento}-${dto.emisor.puntoEmision} no encontrado para emisor ${dto.emisor.ruc}`,
          );
        }
        secuencial = await this.repository.executeInTransaction(
          async (client) => {
            return this.repository.getNextSecuencial(
              puntoEmisionInfo.punto_emision_id,
              TipoComprobante.NOTA_VENTA,
              client,
            );
          },
        );
      }

      // ─── FASE 2: Fuera de transacción — Firma + Envío al SRI ───
      const claveAcceso = this.claveAccesoService.generate({
        fechaEmision,
        tipoComprobante: TipoComprobante.NOTA_VENTA,
        ruc: dto.emisor.ruc,
        ambiente,
        establecimiento: dto.emisor.establecimiento,
        puntoEmision: dto.emisor.puntoEmision,
        secuencial,
        tipoEmision,
      });

      const notaVenta = await this.buildNotaVentaFromDto(
        dto,
        comprador,
        claveAcceso,
        secuencial,
        ambiente,
        tipoEmision,
      );
      const xml = this.xmlBuilderService.buildNotaVenta(notaVenta);

      if (
        !emisor ||
        !emisor.certificado_nombre ||
        !emisor.certificado_password_encrypted
      ) {
        throw new BadRequestException(
          `El emisor con RUC ${dto.emisor.ruc} no tiene certificado digital configurado. ` +
            'Use el endpoint POST /certificates/upload-cert con el RUC para vincular un certificado P12.',
        );
      }

      const xmlFirmado = await this.xmlSignerService.signXmlForEmisor(
        xml,
        dto.emisor.ruc,
      );

      let resultado: SriOperationResult;
      try {
        resultado = await this.sriSoapClient.enviarYAutorizar(
          xmlFirmado,
          claveAcceso,
        );
      } catch (error) {
        // El SRI no respondió — guardar como PENDIENTE para reintento posterior
        if (emisor && puntoEmisionInfo) {
          await this.repository.executeInTransaction(async (client) => {
            await this.persistirNotaVenta(
              dto,
              notaVenta,
              emisor.id,
              puntoEmisionInfo.punto_emision_id,
              claveAcceso,
              secuencial,
              ambiente,
              tipoEmision,
              xml,
              xmlFirmado,
              {
                success: false,
                claveAcceso,
                estado: 'PENDIENTE',
                mensajes: [
                  {
                    identificador: 'SRI_TIMEOUT',
                    mensaje: (error as Error).message,
                    tipo: 'ERROR',
                  },
                ],
              },
              client,
            );
          });
        }
        throw error;
      }

      // ─── FASE 3: Transacción corta — Solo persistir resultado ───
      if (emisor && puntoEmisionInfo) {
        await this.repository.executeInTransaction(async (client) => {
          await this.persistirNotaVenta(
            dto,
            notaVenta,
            emisor.id,
            puntoEmisionInfo.punto_emision_id,
            claveAcceso,
            secuencial,
            ambiente,
            tipoEmision,
            xml,
            xmlFirmado,
            resultado,
            client,
          );
        });
      }

      if (resultado.success || resultado.estado === 'AUTORIZADO') {
        this.eventEmitter.emit('comprobante.autorizado', {
          emisorId: emisor?.id,
          claveAcceso,
          tipoComprobante: TipoComprobante.NOTA_VENTA,
          secuencial,
          fechaAutorizacion: resultado.fechaAutorizacion,
          numeroAutorizacion: resultado.numeroAutorizacion,
        });
      } else if (
        resultado.estado === 'RECHAZADO' ||
        resultado.estado === 'DEVUELTA'
      ) {
        this.eventEmitter.emit('comprobante.rechazado', {
          emisorId: emisor?.id,
          claveAcceso,
          tipoComprobante: TipoComprobante.NOTA_VENTA,
          estado: resultado.estado,
          mensajes: resultado.mensajes,
        });
      }

      return this.mapResultToResponse(resultado);
    } catch (error) {
      this.logger.error(
        `Error al emitir nota de venta: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private async buildNotaVentaFromDto(
    dto: CreateNotaVentaDto,
    comprador: {
      tipoIdentificacion: string;
      identificacion: string;
      razonSocial: string;
    },
    claveAcceso: string,
    secuencial: string,
    ambiente: Ambiente,
    tipoEmision: TipoEmision,
  ): Promise<NotaVenta> {
    const detalles = this.buildDetalles(dto.detalles);
    const { totalSinImpuestos, totalDescuento, importeTotal } =
      this.calculateTotales(detalles, dto.propina || 0);

    const infoTributaria: InfoTributaria = {
      ambiente,
      tipoEmision,
      razonSocial: dto.emisor.razonSocial,
      nombreComercial: dto.emisor.nombreComercial,
      ruc: dto.emisor.ruc,
      claveAcceso,
      codDoc: TipoComprobante.NOTA_VENTA,
      estab: dto.emisor.establecimiento.padStart(3, '0'),
      ptoEmi: dto.emisor.puntoEmision.padStart(3, '0'),
      secuencial: secuencial.padStart(9, '0'),
      dirMatriz: dto.emisor.dirMatriz,
      agenteRetencion: dto.emisor.agenteRetencion,
      contribuyenteRimpe: dto.emisor.contribuyenteRimpe,
    };

    const pagos = dto.pagos && dto.pagos.length > 0
      ? dto.pagos.map((p) => ({
          formaPago: p.formaPago,
          total: p.total,
          plazo: p.plazo,
          unidadTiempo: p.unidadTiempo,
        }))
      : [{ formaPago: '01', total: importeTotal }];

    const infoNotaVenta: InfoNotaVenta = {
      fechaEmision: dto.fechaEmision,
      dirEstablecimiento: dto.emisor.dirEstablecimiento,
      contribuyenteEspecial: dto.emisor.contribuyenteEspecial,
      obligadoContabilidad: dto.emisor.obligadoContabilidad,
      tipoIdentificacionComprador: comprador
        .tipoIdentificacion as InfoNotaVenta['tipoIdentificacionComprador'],
      razonSocialComprador: comprador.razonSocial,
      identificacionComprador: comprador.identificacion,
      totalSinImpuestos,
      totalDescuento,
      totalConImpuestos: [
        {
          codigo: '2',
          codigoPorcentaje: '6',
          baseImponible: totalSinImpuestos,
          tarifa: 0,
          valor: 0,
        },
      ],
      propina: dto.propina || 0,
      importeTotal,
      moneda: 'DOLAR',
      pagos: pagos as InfoNotaVenta['pagos'],
    };

    const notaVenta: NotaVenta = {
      infoTributaria,
      infoNotaVenta,
      detalles,
    };

    const infoAdicional: any[] = [];

    if (dto.comprador?.email) {
      infoAdicional.push({ nombre: 'email', valor: dto.comprador.email });
    }
    if (dto.comprador?.telefono) {
      infoAdicional.push({ nombre: 'telefono', valor: dto.comprador.telefono });
    }
    if (dto.comprador?.direccion) {
      infoAdicional.push({
        nombre: 'direccion',
        valor: dto.comprador.direccion,
      });
    }

    if (dto.infoAdicional) {
      infoAdicional.push(...dto.infoAdicional);
    }

    // Leyenda RIMPE obligatoria
    if (dto.emisor.contribuyenteRimpe) {
      infoAdicional.push({
        nombre: 'Contribuyente Régimen RIMPE',
        valor: dto.emisor.contribuyenteRimpe,
      });
    }

    // Resolución NAC-DGERCGC26-00000027: RUC del proveedor del sistema
    const infoAdicionalFinal =
      await this.base.injectProveedorRucInfoAdicional(infoAdicional);

    if (infoAdicionalFinal.length > 0) {
      notaVenta.infoAdicional = infoAdicionalFinal;
    }

    return notaVenta;
  }

  private buildDetalles(
    dtoDetalles: CreateNotaVentaDto['detalles'],
  ): DetalleNotaVenta[] {
    return dtoDetalles.map((d) => {
      const subtotal = d.cantidad * d.precioUnitario;
      const descuento = d.descuento || 0;
      if (descuento > subtotal) {
        throw new BadRequestException(
          `Descuento (${descuento}) no puede ser mayor al subtotal del detalle (${subtotal})`,
        );
      }

      return {
        codigoPrincipal: d.codigoPrincipal,
        codigoAuxiliar: d.codigoAuxiliar,
        descripcion: d.descripcion,
        unidadMedida: d.unidadMedida,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario,
        descuento,
        precioTotalSinImpuesto: subtotal - descuento,
      };
    });
  }

  private calculateTotales(detalles: DetalleNotaVenta[], propina: number): {
    totalSinImpuestos: number;
    totalDescuento: number;
    importeTotal: number;
  } {
    let totalSinImpuestos = new Decimal(0);
    let totalDescuento = new Decimal(0);

    for (const detalle of detalles) {
      totalSinImpuestos = totalSinImpuestos.plus(
        new Decimal(detalle.precioTotalSinImpuesto),
      );
      totalDescuento = totalDescuento.plus(new Decimal(detalle.descuento));
    }

    const importeTotal = totalSinImpuestos.plus(new Decimal(propina));

    return {
      totalSinImpuestos: totalSinImpuestos.toNumber(),
      totalDescuento: totalDescuento.toNumber(),
      importeTotal: importeTotal.toNumber(),
    };
  }

  private async persistirNotaVenta(
    dto: CreateNotaVentaDto,
    notaVenta: NotaVenta,
    emisorId: string,
    puntoEmisionId: string,
    claveAcceso: string,
    secuencial: string,
    ambiente: string,
    tipoEmision: string,
    xmlSinFirma: string,
    xmlFirmado: string,
    resultado: SriOperationResult,
    client: PoolClient,
  ): Promise<void> {
    try {
      const comprador = dto.comprador || CONSUMIDOR_FINAL;

      const comprobante = await this.repository.createComprobante(
        {
          emisor_id: emisorId,
          punto_emision_id: puntoEmisionId,
          tipo_comprobante: TipoComprobante.NOTA_VENTA,
          ambiente,
          tipo_emision: tipoEmision,
          secuencial: secuencial,
          clave_acceso: claveAcceso,
          fecha_emision: dto.fechaEmision.split('/').reverse().join('-'),
          estado: resultado.success ? 'AUTORIZADO' : resultado.estado,
          estado_sri: resultado.estado,
          fecha_autorizacion: resultado.fechaAutorizacion,
          numero_autorizacion: resultado.numeroAutorizacion || claveAcceso,
          total_sin_impuestos: notaVenta.infoNotaVenta.totalSinImpuestos,
          total_descuento: notaVenta.infoNotaVenta.totalDescuento,
          importe_total: notaVenta.infoNotaVenta.importeTotal,
          propina: notaVenta.infoNotaVenta.propina,
          moneda: notaVenta.infoNotaVenta.moneda,
          receptor_tipo_identificacion: comprador.tipoIdentificacion,
          receptor_identificacion: comprador.identificacion,
          receptor_razon_social: comprador.razonSocial,
          receptor_direccion: dto.comprador?.direccion,
          receptor_email: dto.comprador?.email,
          receptor_telefono: dto.comprador?.telefono,
        },
        client,
      );

      this.logger.log(`Comprobante creado con ID: ${comprobante.id}`);

      for (let i = 0; i < notaVenta.detalles.length; i++) {
        const det = notaVenta.detalles[i];
        const detalleRecords = await this.repository.createDetalles(
          [
            {
              comprobante_id: comprobante.id!,
              codigo_principal: det.codigoPrincipal,
              codigo_auxiliar: det.codigoAuxiliar,
              descripcion: det.descripcion,
              unidad_medida: det.unidadMedida,
              cantidad: det.cantidad,
              precio_unitario: det.precioUnitario,
              descuento: det.descuento,
              precio_total_sin_impuesto: det.precioTotalSinImpuesto,
              orden: i,
            },
          ],
          client,
        );

        const detalleId = detalleRecords[0].id!;

        if (det.detallesAdicionales && det.detallesAdicionales.length > 0) {
          await this.repository.createDetallesAdicionales(
            det.detallesAdicionales.map((da) => ({
              comprobante_detalle_id: detalleId,
              nombre: da.nombre,
              valor: da.valor,
            })),
            client,
          );
        }
      }

      if (notaVenta.infoNotaVenta.totalConImpuestos) {
        await this.repository.createTotales(
          notaVenta.infoNotaVenta.totalConImpuestos.map((tot: TotalImpuesto) => ({
            comprobante_id: comprobante.id!,
            codigo: tot.codigo,
            codigo_porcentaje: tot.codigoPorcentaje,
            descuento_adicional: tot.descuentoAdicional,
            base_imponible: tot.baseImponible,
            tarifa: tot.tarifa,
            valor: tot.valor,
            valor_devolucion_iva: tot.valorDevolucionIva,
          })),
          client,
        );
      }

      if (notaVenta.infoNotaVenta.pagos) {
        await this.repository.createPagos(
          notaVenta.infoNotaVenta.pagos.map((pago) => ({
            comprobante_id: comprobante.id!,
            forma_pago: pago.formaPago,
            total: pago.total,
            plazo: pago.plazo,
            unidad_tiempo: pago.unidadTiempo,
          })),
          client,
        );
      }

      const fechaEmision = new Date(
        parseInt(dto.fechaEmision.split('/')[2]),
        parseInt(dto.fechaEmision.split('/')[1]) - 1,
        parseInt(dto.fechaEmision.split('/')[0]),
      );
      const xmlPaths = this.xmlStorage.saveAllXmls(
        dto.emisor.ruc,
        claveAcceso,
        fechaEmision,
        undefined,
        xmlFirmado,
        resultado.xmlAutorizado,
      );
      await this.repository.saveXml(
        {
          comprobante_id: comprobante.id!,
          xml_firmado_path: xmlPaths.firmadoPath,
          xml_autorizado_path: xmlPaths.autorizadoPath,
        },
        client,
      );

      if (notaVenta.infoAdicional && notaVenta.infoAdicional.length > 0) {
        await this.repository.createInfoAdicional(
          notaVenta.infoAdicional.map((info) => ({
            comprobante_id: comprobante.id!,
            nombre: info.nombre,
            valor: info.valor,
          })),
          client,
        );
      }

      this.logger.log(
        `Nota de venta ${claveAcceso} persistida correctamente`,
      );
    } catch (error) {
      this.logger.error(
        `CRÍTICO: Nota de venta ${claveAcceso} autorizada por SRI pero NO persistida: ${(error as Error).message}`,
      );

      this.eventEmitter.emit('comprobante.persistencia_fallida', {
        claveAcceso,
        emisorRuc: dto.emisor.ruc,
        tipoComprobante: TipoComprobante.NOTA_VENTA,
        error: (error as Error).message,
        timestamp: new Date(),
      });
      throw error;
    }
  }

  mapResultToResponse(result: SriOperationResult): NotaVentaResponseDto {
    return {
      success: result.success,
      claveAcceso: result.claveAcceso,
      estado: result.estado,
      fechaAutorizacion: result.fechaAutorizacion,
      numeroAutorizacion: result.numeroAutorizacion,
      xmlAutorizado: result.xmlAutorizado,
      mensajes: result.mensajes,
    };
  }
}
