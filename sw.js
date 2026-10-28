/* =========================================================================
 * AI记账 · Service Worker
 * 作用：让「添加到桌面」后能离线启动、二次打开秒开。
 * 注意：本文件必须放在站点根目录（与 index.html 同级），作用域才是整个站点。
 * 更新：改完页面内容后，把下面的 CACHE_VERSION 数字 +1，手机端才会换新缓存。
 * ========================================================================= */

var CACHE_VERSION = 'v1';
var CACHE_PREFIX = 'aj-jizhang-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

/* 站点作用域的绝对地址（GitHub Pages 部署在 /仓库名/ 子路径下，必须用 scope 拼） */
var SCOPE = self.registration.scope;
function abs(path) { return new URL(path, SCOPE).href; }

var PRECACHE_PATHS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './vendor/workbuddy-cloud-sdk.js'
];

/* 安装：逐个预缓存。用独立的 cache.add 而不是 addAll，
   这样某个文件 404 时不会导致整批缓存全部失败。 */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        PRECACHE_PATHS.map(function (p) {
          return cache.add(abs(p)).catch(function () { /* 单个失败忽略 */ });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* 激活：清掉本应用的历史缓存版本，接管现有页面 */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME;
        }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* 请求拦截 */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* 只处理 GET */
  if (req.method !== 'GET') { return; }

  /* 只处理同源请求。跨域请求（WorkBuddy 云 AI、腾讯云 OCR、任何 CDN）
     一律交给浏览器直连，绝不缓存——否则会把 AI 接口的响应缓存成死数据。 */
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) { return; }

  /* 页面导航：先走网络拿最新版，失败（断网）才回退到缓存的 index.html */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) {
          c.put(abs('./index.html'), copy);
        }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(abs('./index.html')).then(function (hit) {
          return hit || caches.match(abs('./'));
        });
      })
    );
    return;
  }

  /* 静态资源：缓存优先，未命中再联网并顺手写入缓存 */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) { return hit; }
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) {
            c.put(req, copy);
          }).catch(function () {});
        }
        return res;
      });
    })
  );
});
