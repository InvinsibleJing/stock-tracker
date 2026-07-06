/**
 * Service Worker - 股票交易记录 PWA
 * 缓存策略：Network First（优先网络，离线时用缓存）
 */

var CACHE_NAME = 'stock-tracker-v5';
var CACHE_URLS = [
  './index.html',
  './manifest.json',
  './stock_tracker_main.js',
  './stock_tracker.css',
  './stock_tracker_toolbox.js',
  './stock_tracker_calendar.js',
  './stock_dict.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4'
];

// 安装：预缓存核心文件
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// 请求拦截：Network First 策略
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Google Sheets API 请求不缓存（总是走网络）
  if (url.hostname.indexOf('script.google.com') !== -1) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({success: false, error: '离线状态，无法同步数据'}), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 其他请求：Network First
  event.respondWith(
    fetch(event.request).then(function(response) {
      // 缓存成功的响应
      if (response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // 网络失败，返回缓存
      return caches.match(event.request);
    })
  );
});
