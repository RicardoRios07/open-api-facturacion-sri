import { IsString, IsOptional, IsNotEmpty, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// TENANT-02: Enums para validación estricta de valores permitidos
export enum TenantPlan {
  BASICO = 'BASICO',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum TenantEstado {
  ACTIVO = 'ACTIVO',
  INACTIVO = 'INACTIVO',
  SUSPENDIDO = 'SUSPENDIDO',
}

export class QueryTenantsDto {
  @ApiPropertyOptional({
    description: 'Plan del tenant para filtrar',
    enum: TenantPlan,
  })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional({
    description: 'Estado del tenant para filtrar',
    enum: TenantEstado,
  })
  @IsOptional()
  @IsEnum(TenantEstado)
  estado?: TenantEstado;

  @ApiPropertyOptional({
    description: 'Cursor (UUID) para paginación (ID del último tenant obtenido en la página anterior)',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Cantidad máxima de registros a retornar',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}


export class CreateTenantDto {
  @ApiProperty({ description: 'Nombre del tenant/empresa' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional({
    description: 'Plan del tenant',
    enum: TenantPlan,
    example: TenantPlan.BASICO,
  })
  @IsOptional()
  @IsEnum(TenantPlan, {
    message: `plan debe ser uno de: ${Object.values(TenantPlan).join(', ')}`,
  })
  plan?: TenantPlan;
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ description: 'Nombre del tenant' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Plan del tenant',
    enum: TenantPlan,
  })
  @IsOptional()
  @IsEnum(TenantPlan, {
    message: `plan debe ser uno de: ${Object.values(TenantPlan).join(', ')}`,
  })
  plan?: TenantPlan;

  @ApiPropertyOptional({
    description: 'Estado del tenant',
    enum: TenantEstado,
  })
  @IsOptional()
  @IsEnum(TenantEstado, {
    message: `estado debe ser uno de: ${Object.values(TenantEstado).join(', ')}`,
  })
  estado?: TenantEstado;
}

export class TenantResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nombre: string;

  @ApiProperty({ enum: TenantPlan })
  plan: string;

  @ApiProperty({ enum: TenantEstado })
  estado: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional()
  emisoresCount?: number;
}

export class PaginatedTenantsResponseDto {
  @ApiProperty({ type: [TenantResponseDto] })
  data: TenantResponseDto[];

  @ApiPropertyOptional({ description: 'Cursor para la siguiente página, null si no hay más' })
  nextCursor: string | null;

  @ApiProperty({ description: 'Indica si hay más elementos disponibles' })
  hasMore: boolean;
}

