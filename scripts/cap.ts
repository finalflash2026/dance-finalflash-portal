/**
 * iOS アプリの同期と起動 (SPEC.md §2.3 / v1.37)
 *
 *   npm run ios:sync                    本番を開く設定で ios/ に反映
 *   npm run ios:dev                     手元の npm run dev をシミュレーターで開く
 *   npm run ios:dev -- --device         同じ Wi-Fi の実機から Mac の dev を開く
 *   npm run ios:dev -- --port 3001      dev のポートを変える
 *   npm run ios:dev -- --target <UDID>  起動するシミュレーター・実機を選ぶ
 *
 * 開く先は capacitor.config.ts が CAP_SERVER_URL → APP_BASE_URL → 本番の既定
 * の順に決める。ここではその値を決めて、オフラインのページにも渡す。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const root = join(__dirname, "..");
const [mode = "sync", ...rest] = process.argv.slice(2);

function option(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return undefined;
}

function cap(args: string[]) {
  const result = spawnSync("npx", ["cap", ...args], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === "dev") {
  const host = rest.includes("--device") ? lanAddress() : "localhost";
  if (!host) {
    console.error("Mac の IP アドレスが見つかりません。Wi-Fi につないでください。");
    process.exit(1);
  }
  process.env.CAP_SERVER_URL = `http://${host}:${option("port") ?? "3000"}`;
} else if (mode !== "sync") {
  console.error(`知らないモードです: ${mode} (sync / dev)`);
  process.exit(1);
}

async function main() {
  // env を決めてから読む (設定は読み込んだ時点の env で決まる)
  const { default: config } = await import("../capacitor.config");
  const serverUrl = config.server?.url ?? "/";

  // 開けなかったときのページの「再読み込み」が戻る先
  writeFileSync(
    join(root, "native/www/server.js"),
    `window.FF_SERVER_URL = ${JSON.stringify(serverUrl)};\n`,
  );

  console.log(`iOS アプリが開く先: ${serverUrl}`);
  cap(["sync", "ios"]);

  if (mode === "dev") {
    console.log("別のターミナルで npm run dev を動かしておいてください。");
    const target = option("target");
    cap(["run", "ios", ...(target ? ["--target", target] : [])]);
    console.log("終わったら npm run ios:sync で本番の設定に戻してください。");
  }
}

void main();
