const SHELL_CACHE = 'vina-supervision-shell-20261008-mvp05-v1';
const SHELL_FILES = ['./', './api.js', './manifest.webmanifest', './assets/app-icon-180.png', './assets/app-icon-192.png', './assets/app-icon-512.png', './js/00-tep-ngoai-tuyen.js', './js/01-core.js', './js/02-quyen.js', './js/03-cong-trinh.js', './js/04-tien-do.js', './js/05-nhat-ky.js', './js/06-ho-so.js', './js/07-bao-cao.js', './js/08-chat-luong.js', './js/09-nhan-su.js', './js/10-tai-khoan.js', './js/11-duyet.js', './js/12-thung-rac.js', './js/13-tong-quan.js', './js/14-dang-nhap.js', './js/glue-1-core.js', './js/00-khoi-dong.js', './js/02-glue-sau-api.js', './js/03-font-fix.js', './js/glue-4-tinh-nang-2.js', './js/05-glue-cuoi.js', './js/glue-6-tinh-nang-3.js', './js/15-cai-dat-ung-dung.js', './js/16-the-dien-thoai.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('vina-supervision-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!['/', '/api.js', '/manifest.webmanifest'].includes(url.pathname) && !url.pathname.startsWith('/js/') && !url.pathname.startsWith('/assets/app-icon-')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(SHELL_CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
