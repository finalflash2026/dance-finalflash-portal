/*
 * Service Worker (SPEC.md §6.6 / §12)
 *
 * **役割はプッシュ通知だけ。** push と notificationclick しか持たせない。
 *
 * オフライン対応 (アセットのキャッシュ) は意図的に入れていない:
 *   1. 中身はすべてサーバー上のデータで、通信できなければ意味のある表示に
 *      ならない。オフラインで開けても古い予定が出るだけで、むしろ誤解を生む
 *   2. **古いデプロイが端末に residual として残る事故**が起きやすい。
 *      キャッシュの捨て方を誤ると、修正を出したのに一部の端末だけ
 *      古い画面のままになる。不具合の復旧が届かないのは避けたい
 *
 * fetch ハンドラを持たないので、ページの読み込みはこれまで通り
 * ブラウザとネットワークだけで完結する。
 */

// 新しい版を出したらすぐ入れ替える。待機させても得が無い (中身が通知だけなので)
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
