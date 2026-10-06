# Entorno local aislado

Este entorno usa solamente contenedores y datos locales. No apunta a Neon,
staging ni producción.

## Arranque

1. Inicia Docker Desktop y espera a que el motor Linux esté disponible.
2. Desde la raíz del repositorio ejecuta:

```powershell
docker compose --env-file .env.docker up --build -d
```

3. Verifica los servicios:

```powershell
docker compose --env-file .env.docker ps
Invoke-WebRequest http://localhost:3001/status
```

La API queda en `http://localhost:3005`; PostgreSQL local queda expuesto en
`localhost:5433`. Redis y Carbone se usan dentro de la red Docker.

## Datos y secretos

`.env.docker` contiene únicamente valores de desarrollo y está ignorado por Git.
El volumen `postgres_data` se inicializa desde `database/init.sql` la primera vez.

Para reiniciar solo los datos locales:

```powershell
docker compose --env-file .env.docker down -v
docker compose --env-file .env.docker up --build -d
```

> Esto elimina únicamente los volúmenes locales de esta composición.

## Emisión contra Celcer

La configuración incluye los WSDL de Celcer, pero no incluye certificados ni
emisores reales. Antes de una emisión real de pruebas hay que crear un emisor
local y cargar un certificado de pruebas autorizado.
