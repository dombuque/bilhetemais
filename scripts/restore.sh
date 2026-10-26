#!/usr/bin/env bash
# Restaura um backup para uma base JÁ CRIADA e vazia. Uso: restore.sh <ficheiro.dump> <base-destino>
set -euo pipefail
FILE="${1:?uso: restore.sh <ficheiro.dump> <base-destino>}"
DB="${2:?indique a base de destino}"
pg_restore -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" --no-owner --exit-on-error -d "$DB" "$FILE"
echo "Restaurado em $DB. Valide a reconciliação dos eventos antes de repor produção."
