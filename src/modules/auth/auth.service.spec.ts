import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from './dto/auth.dto';

describe('AuthService tenant identity boundary', () => {
  const db = { queryOne: jest.fn() } as any;
  const jwt = {} as any;
  const config = {} as any;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(db, jwt, config);
  });

  it('resuelve el slug de Vendi al UUID interno de Open-SRI', async () => {
    db.queryOne
      .mockResolvedValueOnce({ id: 'user-uuid', activo: true })
      .mockResolvedValueOnce({ id: 'sri-tenant-uuid' });

    const result = await service.validatePayload({
      sub: 'user-uuid', email: 'a@b.com', rol: UserRole.ADMIN, tenantId: 'almafit',
    });

    expect(result.tenantId).toBe('sri-tenant-uuid');
    expect(db.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('vendi_tenant_key = $1'),
      ['almafit'],
    );
  });

  it('rechaza un tenant no registrado y no permite continuar sin aislamiento', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 'user-uuid', activo: true }).mockResolvedValueOnce(null);

    await expect(service.validatePayload({
      sub: 'user-uuid', email: 'a@b.com', rol: UserRole.ADMIN, tenantId: 'desconocido',
    })).rejects.toThrow(UnauthorizedException);
  });

  it('mantiene null para el usuario superadmin global', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 'user-uuid', activo: true });
    const result = await service.validatePayload({
      sub: 'user-uuid', email: 'admin@b.com', rol: UserRole.SUPERADMIN, tenantId: null,
    });
    expect(result.tenantId).toBeNull();
  });

  it('acepta la identidad de servicio Vendi sin buscar un usuario humano', async () => {
    const result = await service.validatePayload({
      sub: 'vendi-dashboard', email: '', rol: UserRole.SUPERADMIN, tenantId: null,
      iss: 'vendi-dashboard', aud: 'open-sri-tenant-bindings', scope: 'tenant:binding:write',
    });
    expect(result.sub).toBe('vendi-dashboard');
    expect(db.queryOne).not.toHaveBeenCalled();
  });
});
