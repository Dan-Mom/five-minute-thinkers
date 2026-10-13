/* 5 分钟科学课 · 离线支持
 *
 * 分两个仓库放东西：
 *   SHELL  —— 课文本身 + 图标 + 16 段答题配音，装 app 的时候就存好（约 2.5MB，很快）
 *   MEDIA  —— 两个视频，默认不存；用户在页面上点「下载课程」才存（约 38MB）
 *
 * 视频那一段为什么要特殊处理：
 *   iPad 的 Safari 放视频时不会一次把整个文件要过去，而是「先给我第 0 到 100 万字节」
 *   这样一段一段地要（叫 Range 请求）。如果我们把整个文件原样丢回去，Safari 会拒绝播放。
 *   所以下面 serveVideoFromCache() 专门做这件事：从存好的整个文件里切出它要的那一段，
 *   再按 206（部分内容）这个规格回给它。少了这一步，离线视频在 iPad 上就是黑屏。
 */

const SHELL_CACHE = 'splinter-shell-v2';
const MEDIA_CACHE = 'splinter-media-v1';

const QUIZ_KEYS = ['q1', 'q2', 'q3', 'right1', 'right2', 'right3', 'wrong', 'done'];

const SHELL_ASSETS = [
  'Splinter.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
  'out/bio-01-splinter-poster.jpg',
].concat(
  ['zh', 'en'].reduce(
    (list, lang) => list.concat(QUIZ_KEYS.map((k) => 'out/quiz-voice/' + lang + '-' + k + '.mp3')),
    []
  )
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 一个一个存。某一个文件万一少了，不能让整个安装失败——
      // 那样会变成「装不上，但也不告诉你为什么」。
      await Promise.all(
        SHELL_ASSETS.map(async (path) => {
          try {
            const res = await fetch(path, { cache: 'reload' });
            if (res.ok) await cache.put(path, res);
          } catch (e) {
            /* 少一个就少一个，不挡安装 */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, MEDIA_CACHE];
      const names = await caches.keys();
      await Promise.all(names.map((n) => (keep.includes(n) ? null : caches.delete(n))));
      await self.clients.claim();
    })()
  );
});

/* 从存好的视频里切出 Safari 要的那一段 */
async function serveVideoFromCache(request, cached) {
  const range = request.headers.get('range');
  const buffer = await cached.arrayBuffer();
  const total = buffer.byteLength;

  if (!range) {
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  if (isNaN(start) || start < 0) start = 0;
  if (isNaN(end) || end >= total) end = total - 1;
  if (start > end) start = 0;

  const chunk = buffer.slice(start, end + 1);
  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
      'Content-Length': String(chunk.byteLength),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 视频：存过就从本地切片给它，没存过就照常走网络
  if (url.pathname.endsWith('.mp4')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(url.pathname);
        if (cached) return serveVideoFromCache(request, cached);
        return fetch(request);
      })()
    );
    return;
  }

  // 其余：先看本地有没有，没有再走网络；网络拿到了顺手存起来
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok && res.type === 'basic') {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, res.clone());
        }
        return res;
      } catch (e) {
        // 没网又没存过：如果要的是一个页面，就把课文本身给它
        if (request.mode === 'navigate') {
          const fallback = await caches.match('Splinter.html');
          if (fallback) return fallback;
        }
        throw e;
      }
    })()
  );
});
