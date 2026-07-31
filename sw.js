// ═══════════════════════════════════════════════════════════════
// Service Worker — Clínica Dra. Anna Carolina Dias
// v3 — cache inteligente + notificações + instalação PWA
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'clinica-cache-v34';

// Arquivos do app que ficam em cache (shell do app)
const APP_SHELL = [
  './index.html',
  './login.html',
  './config.js',
  './manifest.json',
  './logo.jpg',
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

// ── Fetch: Network First para dados, Cache First para assets ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

 // 1. REGRA DE OURO: API do Supabase sempre direto para a rede
  // O Service Worker ignora essas requisições
  if (url.hostname.includes('supabase.co')) {
    return; 
  }

  // 2. Requisições externas que não fazem parte do seu domínio (ex: Google Fonts)
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Arquivos do app: Cache First com fallback para rede
  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Se encontrou no cache, retorna
      if (cached) return cached;
      
      // Se não, busca na rede
      return fetch(event.request).then((response) => {
        // Cachear resposta válida apenas se for um asset (tipo 'basic')
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: retorna index.html para navegação
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── Notificações push locais ──
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url } = data;
    self.registration.showNotification(title || 'Clínica Anna Carolina', {
      body: body || '',
      tag: tag || 'clinica-notif',
      icon: './logo.jpg',
      badge: './logo.jpg',
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
        if (client.url.includes('clinicaannacarolina') && 'focus' in client) {
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
