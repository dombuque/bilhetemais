# Domínio `bilhetemais.live` — um subdomínio por evento, automático

**Resultado:** cada evento criado na plataforma passa a ter o seu endereço `https://<evento>.bilhetemais.live`
(por exemplo `feira-de-maputo.bilhetemais.live`), sem fazer mais nada: o DNS e o certificado são **curinga**
(`*.bilhetemais.live`) e o nome do subdomínio é o identificador do evento.

## Como funciona
- O nome do subdomínio é o identificador do evento (gerado do nome, único em toda a plataforma). Nomes reservados
  (`www`, `api`, `admin`, `platform`, `company`, `account`, `staff`, `mail`…) nunca são atribuídos a eventos.
- O endereço principal `https://bilhetemais.live` fica com a página inicial, `/events` (descoberta e mapa), `/account`,
  o registo de empresas e as áreas privadas (`/platform`, `/company/<empresa>`). **As áreas privadas só abrem no endereço
  principal**: num subdomínio de evento são reencaminhadas para lá.
- Cada subdomínio é uma origem própria para o navegador: a sessão de participante é guardada por subdomínio. O login com
  Google passa pelo endereço principal e **regressa ao subdomínio do evento** (só a subdomínios de `bilhetemais.live`).
- Em `https://bilhetemais.live/e/<evento>` a mesma página continua a abrir (compatibilidade e partilha antiga).

## Passos (uma vez)

### 1. DNS do domínio `bilhetemais.live`
No fornecedor do DNS (por exemplo Cloudflare, ou onde o domínio foi registado) crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | IP do servidor |
| A | `*` | IP do servidor |

Se usar a Cloudflare, deixe os dois registos em **«só DNS» (nuvem cinzenta)** até o certificado estar emitido.

### 2. Certificado curinga (Let's Encrypt, validação DNS-01)
Um certificado curinga só se emite por DNS. Duas formas:

**a) Automática (recomendada, renova-se sozinha) — Cloudflare**
1. Na Cloudflare crie um *API Token* com a permissão **Zone → DNS → Edit** **apenas para a zona `bilhetemais.live`**.
2. No servidor (como root):
   ```bash
   apt install -y python3-certbot-dns-cloudflare
   install -m 600 /dev/null /root/.secrets-bilhetemais-cf.ini
   echo "dns_cloudflare_api_token = <o-seu-token>" > /root/.secrets-bilhetemais-cf.ini
   certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets-bilhetemais-cf.ini \
     -d bilhetemais.live -d '*.bilhetemais.live'
   ```
   O token fica só nesse ficheiro (permissões 600); não o ponha no código nem em conversas.

**b) Manual (não se renova sozinha; serve para arrancar)**
```bash
certbot certonly --manual --preferred-challenges dns -d bilhetemais.live -d '*.bilhetemais.live'
```
O certbot pede para criar um registo `TXT` (`_acme-challenge`) no DNS; crie-o, espere um minuto e continue.

### 3. Nginx
```bash
cp /var/www/bilheteplus/deploy/nginx_bilhetemais_live.conf /etc/nginx/sites-available/bilhetemais_live
ln -s /etc/nginx/sites-available/bilhetemais_live /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 4. Aplicação (`apps/api/.env`) e Google
```
BASE_DOMAIN=bilhetemais.live
PUBLIC_URL=https://bilhetemais.live
```
Depois `systemctl restart bilheteplus`. Na consola da Google (credenciais OAuth) acrescente:
- Origem JavaScript autorizada: `https://bilhetemais.live`
- URI de redirecionamento: `https://bilhetemais.live/account/google/callback`

### 5. Verificar
`https://bilhetemais.live` abre a página inicial; crie/publique um evento e abra `https://<evento>.bilhetemais.live`.

## Notas
- Eventos **não publicados** (rascunho) respondem «não encontrado» no seu subdomínio.
- O domínio antigo `bilhetemais.semfila.online` pode continuar a funcionar em paralelo durante a transição (sem subdomínios por evento).
- Os e-mails (bilhetes, newsletter) usam `PUBLIC_URL` nas ligações: mude-o só quando `bilhetemais.live` estiver a responder.

## Estado (29/10/2026)
- DNS (`@` e `*`) na Cloudflare, só DNS; certificado curinga emitido por DNS-01 (válido até 27/01/2027, renovação automática com recarga do nginx);
  token da Cloudflare restrito à zona `bilhetemais.live` em `/root/.secrets-bilhetemais-cf.ini` (permissões 600) — serve só para renovar.
- `BASE_DOMAIN=bilhetemais.live` e `PUBLIC_URL=https://bilhetemais.live` em produção; nginx em `/etc/nginx/sites-available/bilhetemais_live`.
- Verificado: `https://<evento>.bilhetemais.live` abre a página do evento com o seu tema; o domínio antigo `bilhetemais.semfila.online` continua a responder.
