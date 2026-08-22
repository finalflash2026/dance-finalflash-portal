/*
 * Service Worker (SPEC.md §6.6 / §12 / §13.1)
 *
 * 役割は2つだけ:
 *   1. プッシュ通知 (push / notificationclick)
 *   2. **`/_next/static/` のファイルだけ**を持っておく (v1.18)
 *
 * ---- なぜ静的ファイルだけなのか ----
 *
 * **ページ (HTML・RSC) は絶対にキャッシュしない。** ここを持つと、
 * 修正を出したのに一部の端末だけ古い画面のまま、という事故が起きる。
 * 不具合の復旧が届かないのが一番まずい。
 *
 * 一方 `/_next/static/` の中身は**ファイル名にビルドのハッシュが入る**。
 * 中身が変われば別の名前になるので、古いものが残っていても参照されない。
 * つまり「古い版が出続ける」事故が原理的に起こらない。
 *
 * ---- なぜ必要になったか ----
 *
 * これらには「1年キャッシュしてよい」と指定してあり、本来ブラウザが
 * 持っていてくれる。ところが **iOS はホーム画面アプリのキャッシュを
 * 容赦なく捨てる**ため、数日ぶりに開くと 800KB ほどを取り直していた。
 * Cache Storage は消されにくいので、ここに置くと起動が速くなる。
 */

/** 静的ファイルの置き場。名前にハッシュが入るので版管理は要らない */
const STATIC_CACHE = "ff-static-v1";

/**
 * 保持する上限。ハッシュ付きの名前は**デプロイのたびに増える**ので、
 * 放っておくと古い版のファイルが溜まり続ける。
 * 1デプロイあたり30〜40件ほどなので、2〜3世代ぶんを残す。
 */
const MAX_ENTRIES = 100;

// 新しい版を出したらすぐ入れ替える。待機させても得が無い (中身が通知だけなので)
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 名前を変えた古い置き場が残っていたら捨てる
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("ff-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * 静的ファイルの取り出し。
 *
 * **扱うのは `/_next/static/` の GET だけ。** それ以外は `respondWith` を
 * 呼ばずに素通りさせる — 呼ばなければブラウザが普段どおり取りに行くので、
 * ページも API も今までと1ミリも変わらない。
 *
 * 取り違えると全ページが壊れる場所なので、条件は厳しめにしてある
 * (同一オリジン / GET / パスが完全一致で始まる)。
 */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/_next/static/")) return;

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);

  // **壊れた応答を置かない。** 一度入れると名前が同じ限り出続けるので、
  // 途中で切れた中身をつかむとアプリが壊れたままになる
  if (response.ok && response.status === 200 && response.type === "basic") {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

/** 古いものから捨てる (keys() は入れた順に返る) */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  await Promise.all(
    keys.slice(0, keys.length - MAX_ENTRIES).map((key) => cache.delete(key)),
  );
}

/**
 * 通知の受信。
 *
 * 本文が壊れていても**必ず何かは出す**。無言で握り潰すと、届いていないのか
 * 出せていないのかが端末側から区別できなくなるため。
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "ff Calendar";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // 同じ話題は置き換える。鍵の開け閉めが往復しても積み上がらない
    tag: payload.tag || "ff-calendar",
    renotify: true,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * 通知をタップしたとき。
 *
 * **既に開いているタブがあればそれを使い回す。** 新しく開くと同じアプリが
 * 2つ並ぶことになり、iOS ではホーム画面から開いた窓と別扱いになってしまう。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ("focus" in client) {
            // 行き先が違えば、そのタブの中で移動させる
            if ("navigate" in client) {
              return client.focus().then((focused) => {
                const focusedClient = focused || client;
                return focusedClient.navigate
                  ? focusedClient.navigate(target)
                  : focusedClient;
              });
            }
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
