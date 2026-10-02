import { UnauthorizedException } from '@nestjs/common';
import { VendiTenantBindingController } from './vendi-tenant-binding.controller';

describe('VendiTenantBindingController', () => {
  const service = { ensureVendiTenantBinding: jest.fn() } as any;
  let controller: VendiTenantBindingController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new VendiTenantBindingController(service);
  });

  it('rechaza issuer, audience o scope incorrectos', async () => {
    await expect(controller.ensureVendiTenantBinding(
      { vendiTenantKey: 'almafit', nombre: 'Almafit' },
      { iss: 'https://attacker.example', aud: 'wrong', scope: 'tenant:binding:write' } as any,
    )).rejects.toThrow(UnauthorizedException);
    expect(service.ensureVendiTenantBinding).not.toHaveBeenCalled();
  });

  it('delega solo con el contrato de servicio correcto', async () => {
    service.ensureVendiTenantBinding.mockResolvedValue({ id: 'sri-uuid' });
    const dto = { vendiTenantKey: 'AlmaFit', nombre: 'Almafit' };
    await controller.ensureVendiTenantBinding(dto, {
      iss: 'vendi-dashboard', aud: 'open-sri-tenant-bindings', scope: 'tenant:binding:write',
    } as any);
    expect(service.ensureVendiTenantBinding).toHaveBeenCalledWith(dto);
  });
});
