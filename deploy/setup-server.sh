#!/bin/bash
# PREPARAÇÃO ÚNICA do servidor (correr como root, depois de o código estar em /var/www/bilheteplus):
#     sudo bash /var/www/bilheteplus/deploy/setup-server.sh
# Não mexe nos serviços existentes (Nucleus, semFila…): só cria utilizador, serviço e site novos.
set -euo pipefail
APP=/var/www/bilheteplus
PORT=4100
SERVER_NAME="${SERVER_NAME:-bilhetemais.semfila.online}"

if ss -ltn | awk '{print $4}' | grep -qE "[:.]${PORT}$"; then
  echo "ERRO: a porta ${PORT} já está em uso nesta máquina. Escolha outra (altere PORT no .env e em nginx_bilheteplus.conf)."; exit 1
fi
node -v | grep -qE '^v(2[0-9]|[3-9][0-9])' || { echo "ERRO: é preciso Node 20 ou superior (actual: $(node -v))"; exit 1; }

id bilheteplus >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin bilheteplus
chown -R bilheteplus:bilheteplus "$APP"

if [ ! -f "$APP/apps/api/.env" ]; then
  cat > "$APP/apps/api/.env" <<ENV
# --- Base de dados (no servidor, a base 'bilheteplus' já existe) ---
PGHOST=localhost
PGPORT=5432
PGUSER=PREENCHER
PGPASSWORD=PREENCHER
PG_ADMIN_DATABASE=postgres
PG_DATABASE=bilheteplus

PORT=${PORT}
TOKEN_SECRET=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)
PUBLIC_URL=https://${SERVER_NAME}
# BASE_DOMAIN=            (só quando houver subdomínios por evento: <evento>.${SERVER_NAME})
# PAYMENT_SIMULATOR=true  (APENAS em teste/staging; NUNCA com dinheiro real)

# E-mail (opcional)
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM="Bilhete+ <no-reply@semfila.online>"
ENV
  chown bilheteplus:bilheteplus "$APP/apps/api/.env"; chmod 600 "$APP/apps/api/.env"
  echo ">> Criei apps/api/.env — EDITE PGUSER/PGPASSWORD antes de continuar."
fi

install -m 644 "$APP/deploy/bilheteplus.service" /etc/systemd/system/bilheteplus.service
systemctl daemon-reload
systemctl enable bilheteplus

install -m 644 "$APP/deploy/nginx_bilheteplus.conf" /etc/nginx/sites-available/bilheteplus
sed -i "s/bilhetemais.semfila.online/${SERVER_NAME}/g" /etc/nginx/sites-available/bilheteplus
ln -sf /etc/nginx/sites-available/bilheteplus /etc/nginx/sites-enabled/bilheteplus
nginx -t && systemctl reload nginx
echo ">> Pronto. Próximos passos: editar .env, correr deploy.sh e emitir o certificado:"
echo "   certbot --nginx -d ${SERVER_NAME}"
