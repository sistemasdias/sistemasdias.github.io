// ═══════════════════════════════════════════════════════════════
// Service Worker — Sistema de Gestão Clínica (multi-clínica)
// cache p/ offline + notificações + instalação PWA
// ═══════════════════════════════════════════════════════════════
// Arquivos do app usam NETWORK FIRST: com internet, sempre vem o código
// novo do servidor (um deploy chega em todo mundo sem precisar mudar o
// CACHE_NAME); sem internet, cai no cache. Mudar o CACHE_NAME continua
// servindo pra forçar limpeza geral de cache antigo em todos os aparelhos.

const CACHE_NAME = 'clinica-cache-v68';

// Arquivos do app que ficam em cache (shell do app)
const APP_SHELL = [
  './index.html',
  './login.html',
  './config.js',
  './manifest.json',
  './paciente.html',
  './gestao.html',
  './pdf.html',
  './backup.html',
  './configuracoes.html',
  './estoque.html',
  './auditoria.html',
  './custohora.html',
  './documentos.html',
  './relatorio.html',
  './financeiro.html',
  './ficha-tecnica.html',
  './dre.html',
];

// ── Instalação: pré-cachear o shell do app ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Tenta cachear cada arquivo individualmente (falha silenciosa)
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Ativação: limpar caches antigos ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network First para arquivos do app, cache só como fallback offline ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. API do Supabase sempre direto para a rede — o SW ignora
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  // 2. Requisições externas fora do domínio (ex: Google Fonts, CDN) — ignora
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Arquivos do app: rede primeiro; se vier ok, atualiza o cache;
  //    se falhar (offline), usa o cache; navegação offline cai no index.html.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      })
    )
  );
});

// ── Notificações push locais ──
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url } = data;
    self.registration.showNotification(title || 'Clínica', {
      body: body || '',
      tag: tag || 'clinica-notif',
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: { url: url || './index.html' },
      requireInteraction: false,
      vibrate: [200, 100, 200],
    });
  }

  // Forçar atualização do cache (chamado ao salvar novo deploy)
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Clique na notificação ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
