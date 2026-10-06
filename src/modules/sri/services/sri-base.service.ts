import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentificacionValidatorService,
  CatalogoValidatorService,
} from './index';
import { Ambiente } from '../constants';
import { DatabaseService } from '../../../database';

/**
 * Servicio base con métodos compartidos entre todos los tipos de comprobante SRI.
 * Contiene validaciones contra catálogos, helpers de ambiente, etc.
 */
@Injectable()
export class SriBaseService {
  private readonly logger = new Logger(SriBaseService.name);

  private proveedorRucCache: string | null = null;
  private proveedorRucCacheTime = 0;
  private static readonly PROVEEDOR_RUC_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly identificacionValidator: IdentificacionValidatorService,
    private readonly catalogoValidator: CatalogoValidatorService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Obtiene el ambiente por defecto desde la configuración
   */
  getDefaultAmbiente(): Ambiente {
    const env = this.configService.get<string>(
      'sri.environment',
      'development',
    );
    return env === 'production' ? Ambiente.PRODUCCION : Ambiente.PRUEBAS;
  }

  /**
   * Valida una identificación antes de enviar al SRI
   * @throws BadRequestException si la identificación es inválida
   */
  validarIdentificacion(
    tipoIdentificacion: string,
    identificacion: string,
    contexto: string,
  ): void {
    const resultado = this.identificacionValidator.validar(
      tipoIdentificacion,
      identificacion,
    );

    if (!resultado.valido) {
      this.logger.warn(
        `Identificación inválida para ${contexto}: ${resultado.error}`,
      );
      throw new BadRequestException(
        `Identificación del ${contexto} inválida: ${resultado.error}`,
      );
    }

    this.logger.log(`Identificación del ${contexto} validada correctamente`);
  }

  /**
   * Valida los códigos de impuesto de los detalles contra el catálogo
   */
  async validarImpuestosDetalles(
    detalles: Array<{
      impuestos: Array<{ codigo: string; codigoPorcentaje: string }>;
    }>,
  ): Promise<void> {
    const impuestosToValidate: Array<{
      codigo: string;
      codigoPorcentaje: string;
    }> = [];

    for (const detalle of detalles) {
      if (detalle.impuestos) {
        for (const imp of detalle.impuestos) {
          impuestosToValidate.push({
            codigo: imp.codigo,
            codigoPorcentaje: imp.codigoPorcentaje,
          });
        }
      }
    }

    if (impuestosToValidate.length === 0) {
      return;
    }

    const result =
      await this.catalogoValidator.validateImpuestos(impuestosToValidate);

    if (!result.valid) {
      this.logger.warn(`Impuestos inválidos: ${result.errors.join(', ')}`);
      throw new BadRequestException({
        message: 'Códigos de impuesto inválidos',
        errors: result.errors,
      });
    }

    this.logger.log(
      `Validados ${impuestosToValidate.length} impuestos contra catálogo`,
    );
  }

  /**
   * Valida los códigos de retención contra el catálogo
   */
  async validarRetencionesCatalogo(
    retenciones: Array<{ codigo: string; codigoRetencion: string }>,
  ): Promise<void> {
    if (!retenciones || retenciones.length === 0) {
      return;
    }

    const result =
      await this.catalogoValidator.validateRetenciones(retenciones);

    if (!result.valid) {
      this.logger.warn(`Retenciones inválidas: ${result.errors.join(', ')}`);
      throw new BadRequestException({
        message: 'Códigos de retención inválidos',
        errors: result.errors,
      });
    }

    this.logger.log(
      `Validadas ${retenciones.length} retenciones contra catálogo`,
    );
  }

  /**
   * Valida el tipo de identificación contra el catálogo
   */
  async validarTipoIdentificacionCatalogo(
    tipoIdentificacion: string,
  ): Promise<void> {
    const result =
      await this.catalogoValidator.validateTipoIdentificacion(
        tipoIdentificacion,
      );

    if (!result.valid) {
      this.logger.warn(`Tipo identificación inválido: ${result.error}`);
      throw new BadRequestException({
        message: 'Tipo de identificación inválido',
        error: result.error,
      });
    }

    this.logger.log(
      `Tipo de identificación ${tipoIdentificacion} validado contra catálogo`,
    );
  }

  /**
   * Valida las formas de pago contra el catálogo
   */
  async validarFormasPagoCatalogo(
    pagos: Array<{ formaPago: string }>,
  ): Promise<void> {
    if (!pagos || pagos.length === 0) {
      return;
    }

    const result = await this.catalogoValidator.validateFormasPago(pagos);

    if (!result.valid) {
      this.logger.warn(`Formas de pago inválidas: ${result.errors.join(', ')}`);
      throw new BadRequestException({
        message: 'Formas de pago inválidas',
        errors: result.errors,
      });
    }

    this.logger.log(`Validadas ${pagos.length} formas de pago contra catálogo`);
  }

  /**
   * Valida el código de documento sustento contra el catálogo
   */
  async validarDocumentoSustentoCatalogo(
    codDocSustento: string,
  ): Promise<void> {
    const result =
      await this.catalogoValidator.validateDocumentoSustento(codDocSustento);

    if (!result.valid) {
      this.logger.warn(`Documento sustento inválido: ${result.error}`);
      throw new BadRequestException({
        message: 'Código de documento sustento inválido',
        error: result.error,
      });
    }

    this.logger.log(
      `Documento sustento ${codDocSustento} validado contra catálogo`,
    );
  }

  /**
   * Obtiene el RUC configurado para el proveedor del sistema y lo conserva
   * temporalmente en memoria para no consultar la base de datos por documento.
   */
  private async getProveedorRuc(): Promise<string | null> {
    const now = Date.now();
    if (
      this.proveedorRucCache !== null &&
      now - this.proveedorRucCacheTime < SriBaseService.PROVEEDOR_RUC_TTL_MS
    ) {
      return this.proveedorRucCache;
    }

    try {
      const result = await this.db.query(
        "SELECT valor FROM sistema_config WHERE clave = 'PROVEEDOR_RUC'",
      );
      const ruc = result.rows.length > 0 ? result.rows[0].valor : null;

      this.proveedorRucCache =
        typeof ruc === 'string' && /^\d{13}$/.test(ruc) ? ruc : null;
      this.proveedorRucCacheTime = now;
      return this.proveedorRucCache;
    } catch (error) {
      this.logger.error(
        `Error consultando PROVEEDOR_RUC desde sistema_config: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Incluye el RUC del proveedor del sistema una sola vez en infoAdicional.
   */
  async injectProveedorRucInfoAdicional(
    infoAdicional: { nombre: string; valor: string }[],
  ): Promise<{ nombre: string; valor: string }[]> {
    const ruc = await this.getProveedorRuc();
    if (!ruc || infoAdicional.some((item) => item.nombre === 'RUCProveedorSistema')) {
      return infoAdicional;
    }

    return [
      ...infoAdicional,
      { nombre: 'RUCProveedorSistema', valor: ruc },
    ];
  }
}
