#!/usr/bin/env bash
# Backup da base do Bilhete+ (pg_dump, formato comprimido). Uso: backup.sh <pasta-destino>
set -euo pipefail
DEST="${1:?uso: backup.sh <pasta-destino>}"
DB="${PG_DATABASE:-bilheteplus}"
mkdir -p "$DEST"
FILE="$DEST/${DB}_$(date +%Y%m%d_%H%M%S).dump"
pg_dump -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -Fc -f "$FILE" "$DB"
echo "Backup criado: $FILE"
find "$DEST" -name "${DB}_*.dump" -mtime +14 -delete   # mantém 14 dias; os mensais devem ser copiados à parte
