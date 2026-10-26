#!/bin/bash
# Envia o código do PC para o servidor (sem node_modules, .env nem builds). Uso, a partir da pasta do projecto:
#     bash deploy/push.sh utilizador@IP-DO-SERVIDOR
set -euo pipefail
TARGET="${1:?uso: push.sh utilizador@servidor}"
tar czf - --exclude=node_modules --exclude=.env --exclude=dist --exclude=.git --exclude='*.log' . \
  | ssh "$TARGET" "mkdir -p /var/www/bilheteplus && tar xzf - -C /var/www/bilheteplus"
echo "Código enviado. No servidor: sudo bash /var/www/bilheteplus/deploy/deploy.sh"
