// Teste de carga e de integridade financeira contra uma API a correr (com PAYMENT_SIMULATOR=true e dados de demonstração).
// uso: node scripts/loadtest.mjs [URL] [carteiras] [pedidos] [concorrência]
const API = process.argv[2] ?? 'http://localhost:4100';
const WALLETS = Number(process.argv[3] ?? 30), REQUESTS = Number(process.argv[4] ?? 300), CONC = Number(process.argv[5] ?? 20);
const EVENT = process.env.EVENT ?? 'festival-de-maputo', ORG = process.env.ORG ?? 'eventos-demo', PW = process.env.PW ?? (() => { throw new Error('defina PW (palavra-passe do organizador de demonstração)'); })();

const j = async (method, path, body, token) => {
  const t0 = performance.now();
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, ms: performance.now() - t0 };
};
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] ?? 0;
const pool = async (n, c, fn) => { let i = 0; const out = []; await Promise.all(Array.from({ length: c }, async () => { while (i < n) { const k = i++; out[k] = await fn(k); } })); return out; };
const MT = 100;

console.log(`API ${API} · ${WALLETS} carteiras · ${REQUESTS} pagamentos · concorrência ${CONC}`);
const ev = (await j('GET', `/public/events/${EVENT}`)).data;
const typeId = ev.ticketTypes[0].id;
const pos = (await j('POST', '/auth/login', { email: 'bar@bilheteplus.test', password: PW, org: ORG })).data.token;
const product = (await j('GET', '/pos/products', null, pos)).data.find((p) => BigInt(p.price_minor) === 5000n) ?? (await j('GET', '/pos/products', null, pos)).data[0];
const price = BigInt(product.price_minor);

// preparação: carteiras com 100 MT (bilhete online + pagamento simulado + carregamento simulado)
const tokens = await pool(WALLETS, 5, async () => {
  const o = (await j('POST', `/public/events/${EVENT}/orders`, { buyerName: 'Carga', items: [{ ticketTypeId: typeId, qty: 1 }] })).data;
  await j('POST', '/public/simulate-payment', { kind: 'ORDER', ref: o.orderId });
  const tk = (await j('GET', `/public/orders/${o.orderId}`)).data.tickets[0].token;
  const t = (await j('POST', `/public/tickets/${tk}/topup`, { provider: 'simulator', amountMinor: 100 * MT })).data;
  await j('POST', '/public/simulate-payment', { kind: 'TOPUP', ref: t.topupId });
  return tk;
});
const balance = async (tk) => BigInt((await j('GET', `/public/tickets/${tk}`)).data.balanceMinor);
const before = await Promise.all(tokens.map(balance));
console.log(`preparadas ${tokens.length} carteiras com ${Number(before[0]) / 100} MT cada`);

// 1) pagamentos concorrentes em carteiras diferentes
const lat = [], ok = [], declined = [];
const t0 = performance.now();
await pool(REQUESTS, CONC, async (k) => {
  const tk = tokens[k % tokens.length];
  const r = await j('POST', '/pos/pay', { token: tk, idempotencyKey: `lt-${Date.now()}-${k}`, items: [{ productId: product.id, qty: 1 }] }, pos);
  lat.push(r.ms);
  (r.status === 200 ? ok : declined).push(k % tokens.length);
});
const secs = (performance.now() - t0) / 1000;
console.log(`\n[1] ${REQUESTS} pagamentos: ${(REQUESTS / secs).toFixed(1)} pedidos/s · aceites ${ok.length} · recusados ${declined.length}`);
console.log(`    latência ms  p50 ${pct(lat, 50).toFixed(0)} · p95 ${pct(lat, 95).toFixed(0)} · p99 ${pct(lat, 99).toFixed(0)} · máx ${Math.max(...lat).toFixed(0)}`);

// invariante: saldo final = inicial − (pagamentos aceites × preço), nunca negativo
let bad = 0;
const after = await Promise.all(tokens.map(balance));
tokens.forEach((_, i) => { const paid = ok.filter((w) => w === i).length; if (after[i] !== before[i] - BigInt(paid) * price || after[i] < 0n) bad++; });
console.log(`    integridade dos saldos: ${bad === 0 ? 'OK' : `FALHOU em ${bad} carteiras`}`);

// 2) tentativa de gastar mais do que o saldo, em simultâneo, na mesma carteira
const victim = tokens[0];
const bal0 = await balance(victim);
const attempts = Number(bal0 / price) + 15;
const res = await pool(attempts, 15, (k) => j('POST', '/pos/pay', { token: victim, idempotencyKey: `over-${Date.now()}-${k}`, items: [{ productId: product.id, qty: 1 }] }, pos));
const accepted = res.filter((r) => r.status === 200).length, final = await balance(victim);
console.log(`\n[2] ${attempts} pagamentos simultâneos numa carteira com ${bal0 / 100n} MT: aceites ${accepted} (máx. possível ${bal0 / price}) · saldo final ${final / 100n} MT · ${final >= 0n && BigInt(accepted) <= bal0 / price ? 'OK, sem saldo negativo' : 'FALHOU'}`);

// 3) o mesmo pedido enviado 20 vezes em simultâneo (falha de rede / reenvio): um só débito
const w2 = tokens[1], b2 = await balance(w2), key = `dup-${Date.now()}`;
await pool(20, 20, () => j('POST', '/pos/pay', { token: w2, idempotencyKey: key, items: [{ productId: product.id, qty: 1 }] }, pos));
const a2 = await balance(w2);
console.log(`\n[3] 20 reenvios do mesmo pedido: débito total ${(b2 - a2) / 100n} MT (esperado ${price / 100n} MT) · ${b2 - a2 === price || b2 < price ? 'OK' : 'FALHOU'}`);

process.exit(bad === 0 ? 0 : 1);
