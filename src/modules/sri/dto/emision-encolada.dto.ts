import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EmisionEncoladaResponseDto {
  @ApiProperty({ example: 'Comprobante encolado para emisión asíncrona' })
  mensaje: string;

  @ApiProperty({ example: '12345' })
  jobId: string;

  @ApiProperty({ example: 'EN_COLA' })
  estado: string;

  @ApiPropertyOptional({ example: 'order_01J8ABCDEF' })
  idReferenciaExterna?: string;

  @ApiPropertyOptional({ example: 'vendi' })
  tipoSistemaExterno?: string;

  @ApiPropertyOptional({ example: false })
  repetida?: boolean;

  @ApiPropertyOptional({
    example: '0702202601092438363100110010010000000161245294013',
  })
  claveAcceso?: string;

  @ApiPropertyOptional()
  resultado?: Record<string, unknown>;

  @ApiPropertyOptional()
  error?: string;
}
