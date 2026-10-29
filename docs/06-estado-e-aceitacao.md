# Bilhete+ — Estado do sistema e aceitação

Produção: https://bilhetemais.semfila.online · Código: https://github.com/dombuque/bilhetemais · Testes automáticos: **32 testes da API** (PostgreSQL real, a correr por esquema isolado) + testes do M-Pesa, da carteira e da portaria.

## 1. O que está feito e verificado

| Área | Entregue | Verificação |
|---|---|---|
| Empresas (tenants) | Registo próprio, aprovação pela Bilhete+, só operam depois de aprovadas; área própria `/company/<id>`; isolamento total entre empresas | testes de isolamento, aprovação e áreas |
| Backoffices | `/platform` (Bilhete+) e `/company/<id>` (empresas), separados e identificados; endereços privados, sem indexação, sem enumeração | testes de áreas e de travão |
| Eventos | Criação, herança de parâmetros/aparência, capa e galeria (guardadas na base), programa, mapa (MapLibre), pesquisa e descoberta | testes + verificação no browser |
| Bilhetes | Categorias opcionais, QR assinado, código de barras, **código curto**, bilhetes impressos, NFC, e-mail automático | testes |
| Controlo de bilhetes | Pesquisa, **bloquear/desbloquear/cancelar com motivo**, registo de auditoria, efeito na porta (também offline) | teste dedicado |
| Portaria | Leitura por câmara/NFC/código, nome do titular, offline com sincronização idempotente, conflitos entre portas | testes |
| Carteira cashless | Saldo por bilhete, carregamento, pagamento a comerciantes (POS), reembolso, ledger só de acrescentar, idempotência | testes da carteira |
| Pagamentos | **M-Pesa directo (Vodacom)**: recarga e compra de bilhetes, confirmação idempotente, recusa, resposta perdida, expiração, duplo clique | testes com M-Pesa simulado |
| Contas de participantes | Registo/entrada, **Google**, «Os meus bilhetes», dados, palavra-passe, apagar conta; comprar exige sessão | testes (Google com fornecedor simulado) |
| Newsletter | Subscrita por omissão, desligável no perfil e por ligação; envio pela plataforma | teste dedicado |
| Idiomas | PT/EN com botão; rotas em inglês | verificação no browser |
| Acertos e relatórios | Comissões, devido a comerciantes, CSV seguro, comprovativos, reconciliação | testes |
| Segurança | RBAC, MFA TOTP, sessões com hash, scrypt, limites de pedidos, travão por e-mail, auditoria, CSP | testes |
| Operação | Hospedagem (systemd + nginx + TLS), **cópia de segurança e restauro testados** (restauro numa base à parte: contagens idênticas) | verificado em produção |

## 2. O que falta e de quem depende

| Item | Depende de | Estado |
|---|---|---|
| **M-Pesa em funcionamento real** | O sandbox da Vodacom respondeu com tempo esgotado (INS-9) nos testes; confirmar com o portal M-Pesa (IP do servidor autorizado?) e depois credenciais de produção | **Bloqueio principal** |
| E-mails a chegar (bilhetes, newsletter, aprovações) | Dados SMTP (servidor, porta, utilizador, palavra-passe, remetente) | Código pronto; sem SMTP as mensagens ficam registadas |
| Login com Facebook | Conta de programador Meta | Não feito |
| Recuperar palavra-passe por e-mail | SMTP | Não feito |
| Logótipo definitivo | Escolha em `/logo-options` | Variantes por fundo feitas |
| Cloudflare (proxy) | Acção do proprietário do domínio | Recomendado |
| Rodar segredos que passaram pelo chat | Proprietário (chave Google, API M-Pesa, token Cloudflare, SMTP do Nucleus) | Recomendado antes de uso real |
| Repositório público → privado | Proprietário | Quando quiser |

## 3. Limitações conhecidas
- Inglês: toda a interface está traduzida por dicionário; nomes de eventos e locais (dados) não se traduzem e textos novos podem ficar em português até serem acrescentados.
- Newsletter: envio de uma só vez; para muitos subscritores convém um serviço de e-mail com limite de envio.
- Isolamento entre empresas feito na aplicação (não ao nível da base de dados, RLS).
- NFC sem criptografia própria (a credencial é um código assinado, como no QR).
- Câmara e NFC só testadas no computador e em simulação; confirmar em telemóveis reais antes do primeiro evento.
- Os testes de interface (Playwright) não foram escritos; a verificação de ecrã foi manual.

## 4. Antes do primeiro evento (lista curta)
1. Configurar o SMTP e fazer um envio de teste (`/platform → Newsletter → Enviar teste`).
2. Resolver o acesso ao M-Pesa e fazer **um carregamento e uma compra reais de valor mínimo**.
3. Rodar as credenciais referidas acima e activar o segundo fator nas contas de administração.
4. Ensaio na porta com dois telemóveis (um com rede, outro sem) e uma pulseira NFC.
5. Cópia de segurança diária agendada (`scripts/backup.sh`) e um restauro de teste mensal.
