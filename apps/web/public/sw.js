// Cache do invólucro da aplicação. NUNCA se guarda a API (saldos, pagamentos).
// - /assets/* tem hash no nome: cache primeiro (nunca muda).
// - o resto (logótipo, ícones, manifesto): rede primeiro, com a cache só como recurso se não houver rede.
// - navegações: rede primeiro; offline mostra a última página guardada.
const SHELL = 'bilheteplus-shell-v5';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const API = /^\/(auth|public|events|orgs|org|users|pos|tickets|merchants|refund-requests|me|webhooks|account|platform|newsletter)(\/|$)/;
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || API.test(url.pathname)) return;
  const put = (r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; };
  if (e.request.mode === 'navigate') {
    // a app abre logo a partir da memória (o ecrã é sempre o mesmo) e a versão nova chega por trás
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match('/');
      const network = fetch(e.request).then((r) => { if (r.ok && r.headers.get('content-type')?.includes('text/html')) cache.put('/', r.clone()); return r; });
      if (cached) { e.waitUntil(network.catch(() => {})); return cached; }
      return network.catch(() => caches.match('/'));
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) { e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(put))); return; }
  e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request)));
});
