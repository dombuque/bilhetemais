# Backup, recuperação e operação

## O que proteger
Toda a informação (ledger, bilhetes, imagens, documentos) está na base PostgreSQL `bilheteplus`. **O ledger é a fonte de verdade financeira**: perder a base é perder os saldos dos participantes.

## Backups
- **Diário** (e **de hora a hora durante eventos**): `scripts/backup.sh` (usa `pg_dump -Fc`, formato comprimido). Guardar **fora do servidor** (outro fornecedor ou disco) e manter 14 dias diários + 6 mensais.
- Como as imagens e documentos estão na base, o backup da base já os inclui.
- Para RPO menor que 1 h, activar arquivo contínuo de WAL (PITR) no PostgreSQL.

```
# exemplo de cron (diário às 03:00)
0 3 * * *  PGPASSWORD=... /opt/bilheteplus/scripts/backup.sh /var/backups/bilheteplus
```

## Recuperação (testar todos os meses)
1. Criar uma base vazia: `createdb bilheteplus_restore`.
2. `scripts/restore.sh <ficheiro.dump> bilheteplus_restore`.
3. Validar: contar carteiras e lançamentos; para cada evento, **somar o ledger e comparar com o relatório de reconciliação** (diferença 0).
4. Para repor produção: parar a API, restaurar para a base definitiva, correr `npm run migrate`, arrancar a API.

Metas a validar antes de produção: **RPO ≤ 1 h**, **RTO ≤ 1 h** (a confirmar com o teste mensal).

## Operação
- Serviço: `npm start` em `apps/api` sob systemd/pm2, atrás de Nginx com HTTPS. A API serve também a interface (`apps/web/dist`).
- Variáveis: ver `apps/api/.env.example`. Produção: `PAYMENT_SIMULATOR` ausente, `TOKEN_SECRET`/`WEBHOOK_SECRET` longos e aleatórios, `PUBLIC_URL`, `BASE_DOMAIN`, SMTP.
- **Rodar `TOKEN_SECRET` invalida os códigos dos bilhetes já emitidos** (derivam dele) — só em caso de comprometimento, e com plano.
- Logs: saída padrão do processo; auditoria de operações sensíveis na tabela `audit_logs`; e-mails na tabela `notifications`.
- Monitorizar: erros 5xx, latência de `/pos/pay`, falhas de webhook, diferença de reconciliação ≠ 0, espaço da base.

## Resposta a incidentes (resumo)
1. Conter: suspender a empresa afectada (`SUSPENDED`) ou desactivar utilizadores; rodar segredos se houver fuga.
2. Preservar: copiar `audit_logs` e logs antes de alterar.
3. Reconciliar: relatório do evento e comparação com o prestador de pagamentos.
4. Comunicar: empresas afectadas e, se houver dados pessoais, a autoridade competente (a confirmar com parecer jurídico).
