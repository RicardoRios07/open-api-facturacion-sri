import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  Matches,
  IsEnum,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmisorDto, CompradorDto, PagoDto, CampoAdicionalDto } from './common.dto';
import { Ambiente, TipoEmision } from '../constants';

export class NotaVentaDetalleDto {
  @ApiProperty({ description: 'Código principal del producto' })
  @IsString()
  @IsNotEmpty()
  codigoPrincipal: string;

  @ApiPropertyOptional({ description: 'Código auxiliar' })
  @IsOptional()
  @IsString()
  codigoAuxiliar?: string;

  @ApiProperty({ description: 'Descripción del producto' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({ description: 'Unidad de medida' })
  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @ApiProperty({ description: 'Cantidad' })
  @IsNumber()
  @Min(0)
  cantidad: number;

  @ApiProperty({ description: 'Precio unitario' })
  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @ApiPropertyOptional({ description: 'Descuento', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  descuento?: number;
}

export class CreateNotaVentaDto {
  @ApiPropertyOptional({
    description: 'Ambiente de emisión',
    enum: Ambiente,
    default: Ambiente.PRUEBAS,
  })
  @IsOptional()
  @IsEnum(Ambiente)
  ambiente?: Ambiente;

  @ApiPropertyOptional({
    description: 'Tipo de emisión',
    enum: TipoEmision,
    default: TipoEmision.NORMAL,
  })
  @IsOptional()
  @IsEnum(TipoEmision)
  tipoEmision?: TipoEmision;

  @ApiProperty({ description: 'Fecha de emisión en formato dd/mm/yyyy' })
  @IsString()
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, {
    message: 'La fecha debe tener el formato dd/mm/yyyy',
  })
  fechaEmision: string;

  @ApiPropertyOptional({
    description:
      'Número secuencial. Si no se proporciona, se genera automáticamente.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,9}$/, {
    message: 'El secuencial debe ser numérico de hasta 9 dígitos',
  })
  secuencial?: string;

  @ApiProperty({ description: 'Información del emisor', type: EmisorDto })
  @ValidateNested()
  @Type(() => EmisorDto)
  emisor: EmisorDto;

  @ApiPropertyOptional({
    description:
      'Información del comprador. Si no se envía, se usa CONSUMIDOR FINAL (07 / 9999999999).',
    type: CompradorDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompradorDto)
  comprador?: CompradorDto;

  @ApiProperty({
    description: 'Detalles de la venta',
    type: [NotaVentaDetalleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotaVentaDetalleDto)
  detalles: NotaVentaDetalleDto[];

  @ApiPropertyOptional({
    description: 'Formas de pago. Si no se envía, se asume efectivo (01).',
    type: [PagoDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoDto)
  pagos?: PagoDto[];

  @ApiPropertyOptional({
    description: 'Campos adicionales (ej. leyenda RIMPE)',
    type: [CampoAdicionalDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampoAdicionalDto)
  infoAdicional?: CampoAdicionalDto[];

  @ApiPropertyOptional({ description: 'Propina', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  propina?: number;
}

export class NotaVentaResponseDto {
  @ApiProperty({ description: 'Indica si la operación fue exitosa' })
  success: boolean;

  @ApiProperty({ description: 'Clave de acceso de 49 dígitos' })
  claveAcceso: string;

  @ApiProperty({ description: 'Estado del comprobante' })
  estado: string;

  @ApiPropertyOptional({ description: 'Fecha de autorización' })
  fechaAutorizacion?: string;

  @ApiPropertyOptional({ description: 'Número de autorización' })
  numeroAutorizacion?: string;

  @ApiPropertyOptional({ description: 'XML autorizado' })
  xmlAutorizado?: string;

  @ApiProperty({ description: 'Mensajes del SRI' })
  mensajes: {
    identificador: string;
    mensaje: string;
    tipo: string;
    adicional?: any;
  }[];
}
