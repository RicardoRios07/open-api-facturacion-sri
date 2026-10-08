-- Estado: aplicar en db_sri antes del deploy del backend.
-- Una referencia externa identifica una única emisión por emisor y tipo.
CREATE TABLE IF NOT EXISTS public.sri_emision_idempotencia (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    emisor_ruc varchar(13) NOT NULL,
    tipo_comprobante varchar(20) NOT NULL,
    tipo_sistema_externo varchar(50) NOT NULL,
    id_referencia_externa varchar(100) NOT NULL,
    request_hash char(64) NOT NULL,
    job_id varchar(128),
    estado varchar(24) NOT NULL DEFAULT 'RECIBIDA',
    clave_acceso varchar(49),
    resultado_json jsonb,
    error_message varchar(300),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sri_emision_idempotencia_estado_ck
      CHECK (estado IN ('RECIBIDA', 'EN_COLA', 'PROCESANDO', 'COMPLETADA', 'REQUIERE_REVISION')),
    CONSTRAINT sri_emision_idempotencia_emisor_tipo_ref_uk
      UNIQUE (emisor_ruc, tipo_comprobante, tipo_sistema_externo, id_referencia_externa)
);

CREATE INDEX IF NOT EXISTS sri_emision_idempotencia_job_idx
  ON public.sri_emision_idempotencia (job_id)
  WHERE job_id IS NOT NULL;
