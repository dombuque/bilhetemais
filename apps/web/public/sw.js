// Cache do invólucro da aplicação. NUNCA se guarda a API (saldos, pagamentos).
// - /assets/* tem hash no nome: cache primeiro (nunca muda).
// - o resto (logótipo, ícones, manifesto): rede primeiro, com a cache só como recurso se não houver rede.
// - navegações: rede primeiro; offline mostra a última página guardada.
const SHELL = 'bilheteplus-shell-v4';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const API = /^\/(auth|public|events|orgs|org|users|pos|tickets|merchants|refund-requests|me|webhooks|account|platform|newsletter)(\/|$)/;
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || API.test(url.pathname)) return;
  const put = (r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; };
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request).then((h) => h || caches.match('/')))); return; }
  if (url.pathname.startsWith('/assets/')) { e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(put))); return; }
  e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request)));
});
