import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { VendiTenantBindingController } from './vendi-tenant-binding.controller';
import { DatabaseModule } from '../../database';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantsController, VendiTenantBindingController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
