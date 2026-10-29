# Bilhete+ — Operação, permissões e segurança

## Matriz de permissões (implementada na API)

| Acção | Plataforma | Org. admin | Balcão | Comerciante | Portaria | Público (token do bilhete) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Registar/activar empresas | ✔ | | | | | |
| Criar eventos, bilhetes, portas, comerciantes, produtos, utilizadores | | ✔ (só a sua empresa) | | | | |
| Relatórios e reconciliação | | ✔ | | | | |
| Revogar bilhete; decidir reembolsos de saldo | | ✔ | | | | |
| Abrir/fechar caixa, vender bilhetes, carregar em numerário | | | ✔ | | | |
| Consultar saldo assistido, associar/substituir/bloquear credenciais | | (bloquear) | ✔ | | | |
| Cobrar, devolver venda | | (devolver) | | ✔ (só o seu comerciante) | | |
| Validar entradas | | | | | ✔ | |
| Ver bilhete/saldo, carregar, pedir reembolso | | | | | | ✔ |

Todas as rotas de evento verificam que o evento pertence à empresa do utilizador (404 caso contrário). Um comerciante só cobra carteiras do seu evento.

## Registo de empresas (self-service) e aprovação
As empresas **registam-se sozinhas** em `/register` (denominação, nome comercial, NUIT de 9 dígitos, responsável, e-mail, palavra-passe, termos) e **só operam depois de aprovadas pela Bilhete+**. O interruptor `SELF_REGISTRATION=true` liga o registo (em produção está ligado; sem ele `/public/register` responde 404). A administração também pode criar empresas já activas em `/platform → Empresas → Nova empresa`.

1. Limite de registos por minuto e IP (`REGISTER_RATE_LIMIT`). Quem se regista recebe, uma só vez, o endereço da área da sua empresa (`/company/<identificador>`); esse endereço **não é divulgado** em nenhuma página pública.
2. A empresa fica **PENDENTE**. O responsável pode entrar, completar o perfil, anexar documentos (PDF/PNG/JPEG até 3 MB) e escolher a marca, mas **não pode criar eventos nem operar** até ser aprovada.
3. A administração Bilhete+ revê (documentos descarregados como anexo), aprova, rejeita ou suspende, com motivo obrigatório para rejeitar/suspender. A empresa rejeitada pode corrigir e voltar a submeter.
4. Os e-mails de aprovação/rejeição são registados e só são enviados se o SMTP estiver configurado.

## Dois backoffices separados
- **Bilhete+ (plataforma):** `https://platform.bilhetemais.live`. Só contas `PLATFORM_ADMIN` entram (o servidor recusa as restantes com a mesma mensagem genérica). Empresas, todos os eventos (cartões com receita), newsletter. Etiqueta «Bilhete+ · Plataforma» no menu.
- **Empresa (tenant):** `/company/<identificador>`. Só a equipa dessa empresa entra. Etiqueta «Empresa · nome» no menu.
- Os endereços das áreas privadas **não aparecem** em nenhuma página pública, não são indexáveis (`X-Robots-Tag: noindex`) e um identificador que não existe responde como um que existe. O antigo `/staff` já não existe (reencaminha para a página inicial).
- Travões: limite por IP no login (`LOGIN_RATE_LIMIT`) e pausa de 15 minutos após 8 palavras-passe erradas seguidas para o mesmo e-mail.

## Área própria, equipa e isolamento por empresa
- Cada empresa tem um endereço de entrada próprio, `/company/<identificador>`, com o nome, as cores e o logótipo dela. O identificador é gerado a partir do nome comercial e é único.
- Só os utilizadores dessa empresa entram por esse endereço: credenciais certas de outra empresa (ou da administração Bilhete+) são recusadas com a mesma mensagem genérica. Quem já tem sessão de outra empresa e abre o endereço é desligado e volta a ver a entrada.
- A empresa gere a sua **equipa** (criar, desactivar/activar, repor palavra-passe; repor ou desactivar termina as sessões abertas). Só vê os seus utilizadores, comerciantes e eventos; os pedidos a recursos de outra empresa respondem «não encontrado».
- Cada utilizador pode alterar a própria palavra-passe. Um administrador não se pode desactivar a si próprio.
- A administração Bilhete+ vê, em modo de leitura, a equipa e os eventos de cada empresa na ficha de revisão, mas não opera dentro delas.
- Os endereços de e-mail são únicos em toda a plataforma (uma pessoa, uma conta).

## Personalização e herança por evento
- **Aparência** (cores principal e de destaque com contraste verificado, tipo de letra, frase de apresentação, texto do botão, estilo do cabeçalho, logótipo e capa): definida na empresa (valores por omissão) e substituível em cada evento.
- **Parâmetros** por evento: categorias de bilhete (vários tipos ou bilhete único), máximo por compra, venda online/balcão, carteira cashless activa, carregamento mínimo/máximo, saldo máximo, reembolso de saldo, reentrada.
- **Herança viva**: um evento pode herdar parâmetros e aparência de outro evento da mesma empresa (cadeia sem ciclos). Cada parâmetro pode ser substituído; a interface mostra se vem do próprio evento, de um evento-pai ou do valor padrão, e permite «repor herança».
- Ao criar um evento a partir de outro, pode-se também **copiar** tipos de bilhete, portas e comerciantes/produtos.
- **Conteúdo**: local e ligação do mapa, galeria (até 12 imagens com legenda e ordem), programa por palco com «adicionar ao calendário» (.ics), contagem decrescente e partilha. Todas as imagens e documentos ficam **na base de dados** (`bytea`), nunca em pastas do servidor; limite de 1 MB por imagem (reduzidas no navegador antes do envio).

## Garantias financeiras (testadas)
- Ledger só de acrescentar (trigger na BD recusa UPDATE/DELETE); saldo = soma dos lançamentos.
- Débito sob bloqueio da linha da carteira + chave de idempotência única por carteira: repetições e pedidos simultâneos não duplicam.
- Saldo nunca negativo. Credenciais revogadas/bloqueadas e carteiras de outro evento são rejeitadas.
- Carregamento digital só após webhook assinado (HMAC) e idempotente; voltar à página não credita.
- Fecho de caixa compara numerário esperado e contado; reconciliação: carregamentos no ledger = digitais confirmados + numerário.

## Configuração (`apps/api/.env`)
`PGHOST, PGPORT, PGUSER, PGPASSWORD, PG_DATABASE, PORT, TOKEN_SECRET, WEBHOOK_SECRET, BASE_DOMAIN, PUBLIC_URL`,
`SELF_REGISTRATION`, `LOGIN_RATE_LIMIT`, `REGISTER_RATE_LIMIT`, `PUBLIC_RATE_LIMIT`;
M-Pesa: `MPESA_BASE_URL, MPESA_API_KEY, MPESA_PUBLIC_KEY, MPESA_SERVICE_PROVIDER_CODE, MPESA_ORIGIN`;
Google: `GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET`; e-mail: `SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM`.
`PAYMENT_SIMULATOR=true` **apenas em desenvolvimento**: em produção o simulador tem de estar desligado.

## Comandos
```
cd apps/api && npm run migrate                    # cria a base (se faltar) e aplica migrações
cd apps/api && npm run create-admin -- email "Nome" password
cd apps/web && npm run build                      # gera apps/web/dist (servido pela API)
cd apps/api && npm start                          # API + interface na porta 4100
PG_DATABASE=bilheteplus_dev npm run seed-demo     # dados de demonstração (precisa da API a correr com o simulador)
cd apps/api && npm test                           # testes contra PostgreSQL real
```

## Publicação (Nginx + Cloudflare, como o Nucleus/semfila)
1. Processo: `npm start` em `apps/api` sob systemd/pm2 (porta 4100), com `NODE_ENV=production`, sem `PAYMENT_SIMULATOR`.
2. DNS: registo A `bilhete.<dominio>` e wildcard `*.bilhete.<dominio>` → IP do servidor (Cloudflare, sem proxy se o certificado for emitido no servidor).
3. Nginx: `server_name bilhete.<dominio> *.bilhete.<dominio>;` com `proxy_pass http://127.0.0.1:4100;` e cabeçalhos `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`.
4. TLS: certificado wildcard via Certbot DNS-01 (Cloudflare), renovação automática.
5. `BASE_DOMAIN=bilhete.<dominio>` para que `<evento>.bilhete.<dominio>` abra a página pública do evento.
6. Backups: `pg_dump` diário da base `bilheteplus` + teste de restauro mensal.

## Segurança — estado
Feito: palavras-passe com scrypt, sessões com token aleatório guardado só como hash, RBAC + isolamento por empresa, limite de tentativas de login, cabeçalhos de segurança (CSP, nosniff, anti-framing), validação de montantes (inteiros em centavos), tokens de bilhete/credencial só guardados em hash, auditoria de operações sensíveis, webhooks assinados.

**Por fazer antes de produção real:** MFA para administradores; Row-Level Security na BD; limite de pedidos nas rotas públicas; rotação/expiração de tokens de bilhete; testes de carga e de penetração; política de retenção de dados; parecer jurídico (Banco de Moçambique, protecção de dados, facturação).

## Limitações conhecidas
- Limites de carregamento e saldo máximo validam-se ao **pedir** o carregamento; um pagamento já confirmado pelo prestador não é recusado depois.
- Imagens na base de dados aumentam o seu tamanho e o tempo de resposta (servidas com cache de 5 minutos). Para muito tráfego, considerar uma CDN à frente da API.
- Prestadores M-Pesa/e-Mola/mKesh/cartões: só existe o simulador; falta integração real (contratos e credenciais).
- NFC: o sistema recebe o código lido pelo leitor (leitor "teclado" USB ou colado). A autenticação criptográfica do cartão (DESFire/NTAG 424) depende do hardware escolhido; um UID simples não é seguro.
- Bilhete impresso com QR; **código de barras ainda não é gerado** (scanners 2D leem o QR).
- **Portaria offline**: implementada (lista de hashes no telemóvel, fila de leituras, sincronização idempotente, conflitos sinalizados). Limites: portas offline não se vêem entre si (um bilhete pode entrar em duas portas; fica sinalizado); a lista guarda-se em `localStorage` (adequado até algumas dezenas de milhares de bilhetes). **Pagamentos offline não existem** (fora do âmbito, por risco financeiro).
- Teste de carga (`node apps/api/scripts/loadtest.mjs`): integridade verificada (saldos exactos, sem saldo negativo com pagamentos simultâneos, reenvios sem duplicar). A latência medida com a base remota por túnel não é representativa; medir contra um PostgreSQL local/no servidor.
- Domínios personalizados por evento: não implementado.
- A interface está só em português (sem camada de internacionalização).
