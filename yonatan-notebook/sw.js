// Offline cache: after the first visit the app works with no internet at all.
const VERSION = 'yonatan-v2';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/util.js', './js/celebrate.js', './js/parser.js', './js/imgproc.js', './js/pdfgen.js', './js/geo.js', './js/geo-data.js', './js/geo-fig.js', './js/exam.js', './js/exam-data.js', './js/exam-alg.js', './js/exam-ana2.js', './js/exam-svg.js', './js/packs.js', './js/xp.js', './js/english.js', './js/python.js', './js/python-data.js', './js/focus.js', './js/planner.js', './js/handwriting.js',
  ...['314-4', '314-5', '314-6', '314-7', '314-8', '315-9', '315-10', '315-11', '316-12', '316-13', '316-14', '316-15', 'example'].map(n => `./geo/${n}.jpg`),
  './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs', './lib/pdf-lib.min.js',
  './icons/icon-192.png', './icons/icon-512.png',
  ...['FoxitDingbats.pfb', 'FoxitFixed.pfb', 'FoxitFixedBold.pfb', 'FoxitFixedBoldItalic.pfb', 'FoxitFixedItalic.pfb',
    'FoxitSerif.pfb', 'FoxitSerifBold.pfb', 'FoxitSerifBoldItalic.pfb', 'FoxitSerifItalic.pfb', 'FoxitSymbol.pfb',
    'LiberationSans-Bold.ttf', 'LiberationSans-BoldItalic.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-Regular.ttf']
    .map(f => './lib/standard_fonts/' + f),
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('yonatan-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return; // API calls, links: straight to network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
