# Hospedagem do Bilhete+ (histórico: primeiro em `bilhetemais.semfila.online`, hoje em `bilhetemais.live` — ver docs/07)

Segue o mesmo padrão do Nucleus e do semFila, na mesma máquina: **serviço `systemd` + script de arranque que carrega o `.env` + script de deploy + site Nginx próprio, numa porta própria (4100)**. Não altera nenhum serviço existente.

Os ficheiros estão em `deploy/`:

| Ficheiro | Função |
|---|---|
| `setup-server.sh` | Preparação única: utilizador `bilheteplus`, `.env`, serviço, site Nginx |
| `deploy.sh` | Publica: `npm ci`, migrações, build da interface, reinício |
| `run-bilheteplus.sh` | Arranque (carrega `apps/api/.env`) |
| `bilheteplus.service` | Unidade systemd |
| `nginx_bilheteplus.conf` | Site Nginx → `127.0.0.1:4100` |
| `push.sh` | Envia o código do PC para o servidor |

## Passo a passo

**1. DNS (Cloudflare).** Crie o registo `A` `bilhetemais` → `IP-DO-SERVIDOR`. Deixe «só DNS» (nuvem cinzenta) até o certificado estar emitido.

**2. Verifique o servidor** (por SSH):
```
node -v            # tem de ser 20 ou superior
ss -ltn | grep 4100  # não deve devolver nada (porta livre)
nginx -v && certbot --version
```

**3. Envie o código.** No PC, na pasta do projecto (Git Bash):
```
bash deploy/push.sh UTILIZADOR@IP-DO-SERVIDOR
```
(ou, se preferir, ponha o projecto num repositório e faça `git clone` em `/var/www/bilheteplus`, como no semFila.)

**4. Preparação única** (no servidor, como root):
```
sudo bash /var/www/bilheteplus/deploy/setup-server.sh
```
Cria o utilizador, o serviço e o site, e gera `apps/api/.env` com `TOKEN_SECRET` e `WEBHOOK_SECRET` aleatórios.
**Edite `/var/www/bilheteplus/apps/api/.env`** e preencha `PGUSER` e `PGPASSWORD` com o mesmo utilizador de base de dados que o Nucleus usa. Aí a base é `localhost` (já não precisa do túnel). A base `bilheteplus` já existe.

**5. Publicar:**
```
sudo bash /var/www/bilheteplus/deploy/deploy.sh
```
Aplica as migrações (a base `bilheteplus` só tem as 001–002; as restantes entram agora), compila a interface e arranca o serviço.

**6. HTTPS:**
```
sudo certbot --nginx -d bilhetemais.semfila.online
```
(Câmara e NFC dos telemóveis exigem HTTPS.)

**7. Administrador da plataforma** (escolha você a palavra-passe; não a escreva no chat):
```
cd /var/www/bilheteplus/apps/api
sudo -u bilheteplus bash -c 'set -a; . ./.env; set +a; npx tsx scripts/create-admin.ts admin@bilhetemais.live "Administrador" "PALAVRA-PASSE"'
```

**8. Verificação:**
- `https://bilhetemais.semfila.online/` abre a página inicial.
- `https://bilhetemais.semfila.online/public/config` responde `{"baseDomain":null,"simulator":false}`.
- `journalctl -u bilheteplus -f` mostra «Bilhete+ API em :4100».

## Decisões que são suas
- **Pagamentos.** Em produção o simulador está desligado, por isso, sem um prestador real, **não é possível pagar nem carregar saldo**. Para uma demonstração interna pode pôr `PAYMENT_SIMULATOR=true` no `.env` (só em teste, e sem dinheiro real: qualquer pessoa consegue «simular» um pagamento).
- **Subdomínios por evento** (`<evento>.bilhetemais.semfila.online`): exigem DNS wildcard e um certificado wildcard (validação DNS-01 na Cloudflare). Até lá, os eventos abrem em `https://bilhetemais.semfila.online/e/<evento>`.
- **Bases de teste no PostgreSQL do servidor.** Durante o desenvolvimento criei `bilheteplus_dev` e `bilheteplus_test` nesse servidor. Depois do deploy podem ser apagadas (`DROP DATABASE`).
- **E-mails**: sem `SMTP_*` ficam só registados na tabela `notifications`.

## Depois
- Cópias de segurança: `docs/04-backup-e-recuperacao.md` (`scripts/backup.sh` em cron).
- Actualizações futuras: `push.sh` + `deploy.sh`.
