-- Estado: aplicar en db_sri antes de desplegar el backend.
-- Vincula el slug/id textual de Vendi con el UUID interno de Open-SRI.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vendi_tenant_key varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_vendi_tenant_key_unique
  ON tenants (vendi_tenant_key)
  WHERE vendi_tenant_key IS NOT NULL;
