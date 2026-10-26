#!/bin/bash
# Arranque do Bilhete+ — só carrega apps/api/.env e arranca a API (que também serve a interface web).
set -u
PROJECT_DIR="/var/www/bilheteplus"
cd "$PROJECT_DIR/apps/api" || { echo "ERRO: $PROJECT_DIR/apps/api não encontrado"; exit 1; }

if [ -f .env ]; then
  set -a
  # aspas simples à volta dos valores (suporta espaços e caracteres especiais)
  # shellcheck disable=SC1090
  . <(grep -v '^#' .env | grep -v '^$' | sed 's/\r$//' | sed -E "s/^([A-Za-z_0-9]+)=(.*)$/\1='\2'/")
  set +a
else
  echo "ERRO: apps/api/.env em falta"; exit 1
fi

exec node --import tsx src/server.ts
