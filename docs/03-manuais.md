# Bilhete+ — Manuais de utilização

> Os ecrãs de operação (balcão, comerciante, portaria) foram pensados **para telemóvel primeiro**.
> **Câmara e NFC exigem HTTPS** (ou `localhost`). **NFC pelo navegador só funciona em Android com Chrome**; no iPhone use a câmara.

## 1. Administração Bilhete+
1. Entre em `/staff` com a conta da plataforma. Active a verificação em dois passos em «A minha conta».
2. **Criar uma empresa**: **Empresas → Nova empresa**. Preencha os dados e o administrador; a empresa fica **activa** e a palavra-passe inicial (gerada) é mostrada **uma única vez**: entregue-a ao responsável com o endereço de entrada da equipa.
3. *(Só se o registo público estiver ligado)* **Empresas → Pendentes**: abra cada pedido, confira NUIT e documentos (descarregue-os) e escolha **Aprovar**, **Rejeitar** ou **Suspender** (rejeitar/suspender pedem motivo). A empresa recebe um e-mail, se o SMTP estiver configurado.
3. Na ficha vê a equipa, os eventos e o endereço de entrada da empresa, só em leitura.

## 2. Organizador (administrador da empresa)
1. **Acesso**: a empresa é criada pela equipa Bilhete+, que lhe entrega o endereço `/company/<o-seu-nome>`, o e-mail e a palavra-passe inicial. Altere a palavra-passe em «A minha conta».
2. **Empresa**: complete os dados, anexe documentos e defina a **marca por omissão** (cores, logótipo).
3. **Equipa**: crie balcão, comerciantes e portaria; reponha palavras-passe; desactive quem sai. Partilhe o endereço de entrada da equipa.
4. **Eventos → Novo evento**. Pode começar do zero ou **basear noutro evento** (copia bilhetes, portas, comerciantes e herda parâmetros e aparência).
5. No evento: **Bilhetes** (um tipo ou várias categorias), **Comerciantes e produtos**, **Portas**, **Conteúdo** (local, mapa, galeria, programa), **Parâmetros** (carteira, limites, reembolso, reentrada, vendas), **Aparência**. **Publicar** quando estiver pronto.
6. **Resumo**: bilhetes, entradas, receita de bilhética, carregamentos, pagamentos, saldo em circulação e **reconciliação** (a diferença deve ser 0).
7. **Acertos**: veja vendas líquidas, comissão, valor devido e em dívida por comerciante; **Registar pagamento** (nunca acima do que se deve); exporte **CSV** de acertos, movimentos e bilhetes. A comissão define-se por evento (Parâmetros) ou por comerciante.
8. **Alertas** no Resumo (reconciliação, leituras repetidas, conflitos offline, reembolsos pendentes, dívidas). **Actividade** (menu) mostra o registo das operações sensíveis da empresa.
9. **Reembolsos**: aprove ou rejeite pedidos de saldo (só se o evento o permitir).

## 3. Balcão / caixa (telemóvel)
1. **Abrir caixa** no início do turno.
2. **Vender**: escolha os bilhetes, nome do comprador, formato (impresso com QR e código de barras, ou digital) e **receba em numerário**. Imprima os bilhetes.
3. **Carteira**: toque em **Ler com a câmara** (abre sozinha no telemóvel) ou **Ler pulseira NFC**, para identificar o participante. Veja o saldo e **carregue em numerário** (atalhos 100/200/500/1000 MT).
4. **Pulseira NFC** (Android): **Gravar pulseira NFC** cria a credencial e grava-a na pulseira encostada ao telemóvel. Se falhar, use «Tentar gravar de novo».
5. **Perdeu a pulseira/bilhete?** Leia a credencial e use **Substituir** (a antiga é revogada; o saldo e o histórico mantêm-se) ou **Bloquear**.
6. **Comprovativo**: no telemóvel do participante, toque num movimento da carteira para ver e imprimir o comprovativo.
7. **Caixa → Fechar**: conte o numerário e confirme; o sistema mostra a diferença.

## 4. Comerciante (POS, telemóvel)
1. Toque nos produtos para montar a conta. O total aparece em baixo.
2. **Cobrar** abre a câmara: leia o QR do bilhete (no telemóvel do cliente ou impresso), o código de barras ou encoste a pulseira NFC.
3. Ecrã **verde** = pago (mostra o saldo restante). **Vermelho** = recusado (saldo insuficiente, credencial bloqueada…). Se a rede falhar, repetir é seguro: o mesmo pedido não debita duas vezes.
4. **Vendas**: histórico e **Devolver** (uma só vez por venda).

## 5. Controlo de acessos (portaria, telemóvel)
1. Escolha o evento e a porta. A câmara abre sozinha e lê continuamente.
2. Resultado em ecrã inteiro: **verde** entrada válida; **laranja** já utilizado / expirado; **vermelho** revogado / não autorizado / erro. Há vibração e som.
3. Em eventos com **reentrada** permitida, o mesmo bilhete volta a ser aceite.

## 5.1 Portaria sem rede
1. **Antes do evento, com rede**, toque em **Preparar offline**: o telemóvel guarda a lista de bilhetes (só os hashes, não os códigos).
2. Se a rede cair, continue a ler normalmente: o resultado indica «Validado sem rede». As leituras ficam guardadas.
3. Quando a rede voltar, sincroniza sozinho (ou toque em **Sincronizar**). O servidor ignora reenvios.
4. **Limite**: duas portas offline não se vêem uma à outra. Se o mesmo bilhete entrar em duas portas sem rede, o conflito aparece como alerta no resumo do evento. Use **Actualizar lista** com frequência quando houver rede.
5. A lista fica guardada no navegador do telemóvel: não limpe os dados do navegador durante o evento.

## 6. Participante
1. Abra o link do bilhete que recebeu (ou leia o QR). **Instale no ecrã inicial** se quiser.
2. Mostra **saldo** e **QR**: o mesmo QR serve à porta e para pagar. O QR não contém o saldo.
3. **Carregar saldo** com os atalhos ou outro valor. O saldo só aparece depois de o prestador confirmar.
4. Sem smartphone: **bilhete impresso** (QR e código de barras) ou **pulseira/cartão NFC**, ambos ligados à mesma carteira; carregue e consulte o saldo no balcão.
5. **Reembolso do saldo**: peça no fim do evento, se o organizador o permitir.

## Problemas frequentes
- *A câmara não abre*: confirme a permissão no navegador e que o endereço é HTTPS.
- *NFC não aparece*: só em Android + Chrome, com NFC ligado.
- *«Credencial inválida»*: bilhete de outro evento, pulseira revogada ou bloqueada.
- *«Empresa a aguardar aprovação»*: ainda não pode criar eventos.
