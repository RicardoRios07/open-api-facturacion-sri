import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { ProvisionTenantDto, TenantResponseDto } from './dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/dto/auth.dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Internal integrations')
@ApiBearerAuth('JWT')
@Controller('internal/integrations/vendi')
export class VendiTenantBindingController {
  constructor(
    private readonly tenantsService: TenantsService,
  ) {}

  @Post('tenant-bindings')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Sincronización idempotente de vínculo tenant Vendi/Open-SRI' })
  async ensureVendiTenantBinding(
    @Body() dto: ProvisionTenantDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TenantResponseDto> {
    const expectedAudience = 'open-sri-tenant-bindings';
    if (
      user.iss !== 'vendi-dashboard' ||
      user.aud !== expectedAudience ||
      user.scope !== 'tenant:binding:write'
    ) {
      throw new UnauthorizedException('Token de servicio no autorizado para tenant bindings');
    }
    return this.tenantsService.ensureVendiTenantBinding(dto);
  }
}
