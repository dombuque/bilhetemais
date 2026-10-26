# Bilhete+ — Fase 1: Arquitectura, fluxos, dados, segurança, riscos

## 1. Arquitectura proposta

Monólito modular (sem microserviços na v1), um deploy por ambiente.

```
 Browsers/PWA ─┐                         ┌─ PostgreSQL (fonte de verdade, ledger)
 POS / Acessos ─┼─► Next.js (web) ─► NestJS API (REST/OpenAPI) ─┤
 Webhooks PSP ──┘   *.bilheteplus.co.mz      módulos: iam, orgs, events,  └─ Redis (filas, rate-limit, cache)
                    (resolução por Host)     ticketing, wallet, payments,
                                             merchants, access, reports, audit
```

- **apps/web** (Next.js + TS): site público por evento (subdomínio resolvido pelo header `Host` em middleware), PWA do participante, backoffices (admin global, organizador, comerciante/POS, balcão, controlo de acessos).
- **apps/api** (NestJS + TS): módulos acima; cada módulo expõe serviços e não acede às tabelas de outro módulo directamente.
- **packages/ledger**: núcleo financeiro puro (SQL + TS), sem dependência de framework, testado isoladamente.
- **Multi-tenant**: coluna `organization_id` em todas as tabelas de negócio + Row-Level Security no PostgreSQL (`SET LOCAL app.org_id`) como segunda barreira além do RBAC na aplicação.
- **Subdomínios**: DNS wildcard `*.bilheteplus.co.mz` + certificado wildcard (ACME DNS-01); tabela `event_domains` mapeia host → evento; lista de nomes reservados (`www`, `api`, `admin`…).
- **Credenciais**: `wallet_credentials` (QR de pagamento, bilhete físico, NFC) apontam todas para **uma** `wallets`. O saldo nunca é guardado como campo editável: é derivado de `wallet_ledger_entries`.

## 2. Fluxos críticos

**Pagamento (QR/código de barras/NFC)** — uma transacção SQL:
1. Resolver credencial (hash do token) → carteira; rejeitar se credencial revogada/bloqueada ou carteira bloqueada.
2. `SELECT … FOR UPDATE` na linha da carteira (serializa concorrência por carteira).
3. Verificar idempotência (`UNIQUE(wallet_id, idempotency_key)`): repetição devolve o resultado original.
4. Calcular saldo (soma de lançamentos posted); se `saldo < valor` → recusar (sem saldo negativo).
5. Inserir lançamento `PAYMENT` (valor negativo) + venda do comerciante; commit.

**Carregamento digital**: pedido `PENDING` → PSP → webhook assinado e verificado (idempotente por `provider_event_id`) → só então lançamento `TOPUP`. O regresso do utilizador à página nunca credita.

**Carregamento em numerário**: sessão de caixa aberta → `cash_movement` + lançamento `TOPUP` na mesma transacção → fecho de caixa compara esperado vs. contado.

**Substituição de credencial**: revoga a antiga, emite a nova na mesma carteira; ledger intacto.

**Entrada**: token → bilhete → estado (válido/usado/expirado/revogado/não autorizado) com `UPDATE … WHERE status='ISSUED'` atómico para impedir dupla entrada.

## 3. Modelo de dados

Ver `apps/api/migrations/001_core.sql` (executável). Entidades núcleo implementadas já: organizations, events, event_domains, wallets, wallet_credentials, wallet_ledger_entries, merchants. As restantes da secção 16 do prompt entram por fase.

Invariantes impostas pela BD: ledger append-only (trigger bloqueia UPDATE/DELETE), `amount_minor` em inteiros (centavos, nunca float), idempotência única por carteira, tokens guardados só como hash.

## 4. Plano de segurança (resumo)

RBAC por organização/evento; MFA (TOTP) para admins; TLS; RLS; tokens de credencial aleatórios de 128 bits+ (QR sem saldo/PII); NFC com cartões que suportam autenticação criptográfica (ex.: DESFire EV2/EV3 ou NTAG 424 DNA com SUN/CMAC) — **UID sozinho nunca autentica**; webhooks com HMAC; rate limiting; auditoria de operações financeiras e administrativas; segredos fora do repositório; sem PAN de cartões (delegado ao PSP); backups com teste de restauro.

## 5. Dependências externas (bloqueiam produção, não o desenvolvimento)

| Dependência | Estado | Mitigação |
|---|---|---|
| APIs M-Pesa / e-Mola / mKesh / cartões, contratos e credenciais | Por obter | Interface `PaymentProvider` + simulador isolado |
| Domínio `bilheteplus.co.mz` | Não confirmado | Domínio base configurável |
| Hardware NFC e leitores (modelo, SDK) | Por seleccionar | Camada `CredentialReader` abstracta |
| Licença/enquadramento Banco de Moçambique para custódia de fundos | Por apurar | Parecer jurídico antes de operar |
| Facturação/IVA (AT), Lei de protecção de dados | Por apurar | Parecer jurídico |

## 6. Riscos

- **Legal/financeiro (crítico)**: guardar saldos de terceiros pode ser actividade regulada (instituição de moeda electrónica/pagamentos). Solução possível: conta de custódia/parceiro licenciado. Decisão antes do lançamento.
- **Técnico**: clonagem de NFC/QR (mitigar com crypto e revogação); pagamentos offline (fora do âmbito v1; só validação de entradas offline); concorrência (mitigada por lock por carteira).
- **Operacional**: rede instável no recinto (idempotência + retentativas); fecho de caixa e reconciliação; reembolsos de saldo remanescente.

## 7. Fases

Conforme secção 20 do prompt. Ordem aplicada: **ledger/carteira primeiro** (núcleo de maior risco) → empresas/eventos/subdomínios → bilhética → POS/carregamentos → NFC/balcões → segurança/produção.

## Estado actual

| Item | Estado |
|---|---|
| Documento de arquitectura | Feito (este) |
| Schema núcleo + ledger | Implementado, ver testes |
| Serviço de carteira (carregar, pagar, idempotência, saldo insuficiente, bloqueio, substituição) | Implementado, ver testes |
| NestJS, Next.js, PWA, POS, acessos, integrações PSP, NFC real | **Não iniciado** |
