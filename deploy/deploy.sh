#!/bin/bash
# Publica uma versão: dependências, migrações, build da interface e reinício. Correr À MÃO:
#     sudo bash /var/www/bilheteplus/deploy/deploy.sh
# O código já tem de estar em /var/www/bilheteplus (git pull, ou deploy/push.sh a partir do PC).
set -euo pipefail
cd /var/www/bilheteplus
echo "--- DEPLOY Bilhete+ ($(date '+%F %T')) ---"
[ -d .git ] && { git fetch origin main && git reset --hard origin/main && echo ">> commit $(git rev-parse --short HEAD)"; }

echo ">> API: dependências"
( cd apps/api && npm ci --no-audit --no-fund )
echo ">> API: migrações da base de dados"
( cd apps/api && set -a && . <(grep -v '^#' .env | grep -v '^$' | sed 's/\r$//' | sed -E "s/^([A-Za-z_0-9]+)=(.*)$/\1='\2'/") && set +a && npx tsx scripts/migrate.ts )
echo ">> Web: dependências e build"
( cd apps/web && npm ci --no-audit --no-fund && npm run build )
[ -f apps/web/dist/index.html ] || { echo "ERRO: o build não gerou apps/web/dist/index.html. A abortar SEM reiniciar." >&2; exit 1; }

chown -R bilheteplus:bilheteplus /var/www/bilheteplus
echo ">> A reiniciar o serviço"
systemctl restart bilheteplus
sleep 2
systemctl --no-pager --lines=5 status bilheteplus || true
echo ">> Feito. Logs: journalctl -u bilheteplus -f"
