"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import logoImage from "@/assets/splash-logo.webp";

/**
 * 起動アニメーション (SPEC.md §6.7.10 / v1.31)
 *
 * 読み込みが終わるまでは黒地にロゴが静止して見えている (HTML に最初から入っている)。
 * ページが開けると分かったら、ロゴが脈打ち、閃光とともにその裏 (中心) から色の光線が
 * 噴き出して、アプリの画面へ溶ける (約1.6秒)。原画と同じく、文字の後ろにも光線が見える。
 *
 * **起動したときだけ** (タブを閉じるまで1回)。画面の移動では出さない。
 * 2回目以降の表示を止めるのは、最初のペイント前に走る SPLASH_INIT_SCRIPT。
 * サーバーが返す HTML に最初から黒い幕が入っているので、後から幕を
 * かぶせる形と違って一瞬アプリの画面が見えることが無い。
 *
 * - 触れば飛ばせる
 * - 「視差効果を減らす」の人には動きを付けず、ロゴを一瞬出して消すだけ
 * - **ロゴは元のものに忠実に** (v1.31)。Adobe の背景削除で原画からロゴだけを切り出した
 *   `assets/logo/logo-cutout.png` を、**縮めも変換もせずに**そのまま出す。
 *   Blender で立体化した版も試したが、質感が元と変わるため採らなかった。
 *   ロゴの上を走る光の帯も外した (Mac の Safari で正方形の縁に紫の線が出たため)
 */

export const SPLASH_SESSION_KEY = "splash-shown";

/**
 * 幕が消えたときに window へ流す合図 (v1.32.6)。初回ツアーはこれを待って始める。
 * 消えた後は `<html data-splash="done">` も立てるので、後から見る側も分かる
 */
export const SPLASH_DONE_EVENT = "splash-done";

/** 起動の幕がもう出ていない (この起動では出さない / 出し終えた) か */
export function isSplashOver(): boolean {
  const state = document.documentElement.dataset.splash;
  return state === "off" || state === "done";
}

/**
 * 最初のペイント前に走らせる (app/layout.tsx の head に埋め込む)。
 * この起動で既に出していたら `<html data-splash="off">` を立てて幕を消す。
 * sessionStorage が使えない環境では出さない (毎回出ると邪魔になるため)。
 * URL に `?splash` を付けると、表示済みでももう一度流す (見た目の確認用)。
 */
export const SPLASH_INIT_SCRIPT = `try{if(!/[?&]splash(=|&|$)/.test(location.search)&&sessionStorage.getItem(${JSON.stringify(
  SPLASH_SESSION_KEY,
)})){document.documentElement.dataset.splash="off"}}catch(e){document.documentElement.dataset.splash="off"}`;

const DURATION_MS = 1600;
const REDUCED_DURATION_MS = 500;
/** 読み込みが長引いても、この時間で必ず動き出す */
const START_TIMEOUT_MS = 6000;
/**
 * 光線の色。**原画から測った割合に合わせて並べる** (v1.31.2)。
 * 白 35% / ローズ 21% / 金茶 17% / 黄 9% / ピンク 8% / 青紫 4% / 水色 3% / 緑 2%。
 * 色は原画の光線の色相ごとの平均を、芯の明るさと濃さまで持ち上げたもの
 * (平均を取ると粒子と黒で濁り、そのままでは原画より淡く白っぽく見えた)。
 * 配列からの抜き出しは等確率なので、要素の数で割合を表す (全20)
 */
const COLORS = [
  ...Array(7).fill("#ece8e8"), // 白
  ...Array(4).fill("#ff5f7e"), // ローズ
  ...Array(3).fill("#f5b25e"), // 金茶
  ...Array(2).fill("#f0e070"), // 黄
  ...Array(2).fill("#ff74ab"), // ピンク
  "#6f76ff", // 青紫
  "#5fe3ee", // 水色
  "#72e58a", // 緑
] as string[];

interface Ray {
  angle: number;
  width: number;
  color: string;
  speed: number;
  delay: number;
  alpha: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

export function Splash() {
  /**
   * 終わったら React に外させる。DOM を直接消すと、あとで router.refresh() などで
   * 親が描き直されたときに React が消えた要素を探しに行ってしまう。
   */
  const [gone, setGone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const sparkRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    if (document.documentElement.dataset.splash === "off") {
      setGone(true);
      return;
    }
    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {}

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 原画のような太さの揃わない帯。細い線と、にじんだ太い帯が混ざる
    const rays: Ray[] = Array.from({ length: 96 }, () => ({
      angle: Math.random() * Math.PI * 2,
      width: Math.random() < 0.3 ? 8 + Math.random() * 14 : 1.5 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      speed: 0.7 + Math.random() * 0.8,
      delay: Math.random() * 0.22,
      alpha: 0.35 + Math.random() * 0.6,
    }));

    let raf = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      setGone(true);
      document.documentElement.dataset.splash = "done";
      window.dispatchEvent(new Event(SPLASH_DONE_EVENT));
    };
    root.addEventListener("pointerdown", finish);

    function drawRays(p: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height * 0.46;
      const reach = Math.hypot(width, height) * 0.7;
      ctx.globalCompositeOperation = "lighter";
      /*
       * **光線はロゴの裏 (中心) から伸ばし、中心を空けない** (v1.31)。
       * 以前は中心の周りを空けていたので、ロゴの裏が真っ暗で、原画のように
       * 文字のすき間から色の線が見えなかった。ロゴはこの上に乗るので、
       * 中心から出る根元はロゴに隠れ、「裏から光が噴き出す」見え方になる
       */
      for (const ray of rays) {
        const k = clamp((p - ray.delay) * ray.speed * 2.0);
        if (k <= 0) continue;
        const e = easeOut(k);
        const r1 = reach * e;
        const x1 = cx + Math.cos(ray.angle) * r1;
        const y1 = cy + Math.sin(ray.angle) * r1;
        // 根元 (ロゴの裏) は控えめに。全部の線が中心に集まるので、
        // 根元まで濃くすると中心が白く飛ぶ
        const gradient = ctx.createLinearGradient(cx, cy, x1, y1);
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(0.12, ray.color);
        gradient.addColorStop(0.6, ray.color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.strokeStyle = gradient;
        ctx.lineCap = "round";
        // 太い帯はにじませる (原画の光線は輪郭がぼけている)
        ctx.shadowColor = ray.color;
        ctx.shadowBlur = ray.width > 7 ? 18 : 6;
        // 重なりで白く飛ばないよう、原画のように光線の間の黒を残す濃さに
        ctx.globalAlpha = ray.alpha * (ray.width > 7 ? 0.26 : 0.6);
        ctx.lineWidth = ray.width * (0.5 + 0.5 * e);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    const logo = logoRef.current!;
    const flash = flashRef.current!;
    const sparks = sparkRefs.current;

    function frame(t: number) {
      if (reduce) {
        // 動きを減らす設定: 静止したロゴのまま、ふっと消えるだけ
        root!.style.opacity = String(1 - seg(t, 0.2, 1));
        return;
      }
      /*
       * 読み込みが終わるまでは静止していたロゴが (v1.31.3)、
       * 小さく脈打ち、閃光とともにその裏から光線が噴き出す
       */
      drawRays(seg(t, 0.06, 0.62));
      const f = seg(t, 0.02, 0.1);
      const fo = seg(t, 0.1, 0.36);
      flash.style.opacity = (f * (1 - fo)).toFixed(3);
      const pulse = Math.sin(Math.PI * seg(t, 0, 0.28));
      const bright = 1 + 1.1 * Math.sin(Math.PI * seg(t, 0.02, 0.34));
      /*
       * **途中で filter を "none" に切り替えない** (v1.31.2)。切り替えた瞬間に
       * Safari がロゴの層を描き直し、ロゴの範囲が白い四角 (Mac では紫の線) で
       * 一瞬覆われた。最初から最後まで同じ形の指定のまま動かす
       */
      logo.style.filter = `blur(0px) brightness(${bright.toFixed(3)})`;
      logo.style.transform = `translate(-50%,-50%) scale(${(1 + 0.05 * pulse).toFixed(4)})`;
      sparks.forEach((spark, i) => {
        if (!spark) return;
        const s = seg(t, 0.45 + i * 0.07, 0.63 + i * 0.07);
        const v = Math.sin(s * Math.PI);
        spark.style.opacity = v.toFixed(3);
        spark.style.transform = `scale(${(v * 1.3).toFixed(3)}) rotate(${s * 90}deg)`;
      });
      const x = easeOut(seg(t, 0.8, 1));
      root!.style.opacity = (1 - x).toFixed(3);
      root!.style.transform = `scale(${1 + x * 0.08})`;
    }

    const duration = reduce ? REDUCED_DURATION_MS : DURATION_MS;
    const begin = () => {
      if (raf || finished) return;
      const start = performance.now();
      const tick = (now: number) => {
        const t = (now - start) / duration;
        frame(t);
        if (t < 1) raf = requestAnimationFrame(tick);
        else finish();
      };
      raf = requestAnimationFrame(tick);
    };

    /*
     * **ページが開けると分かってから動かす** (v1.31.3)。
     * ここに来た時点で画面の準備 (ハイドレーション) は済んでいる。あとは
     * 画像などを含むページの読み込み (`load`) が終われば、溶けた先の画面は描き終わっている。
     * 長引いても START_TIMEOUT_MS で動かす (幕が残り続けないように)
     */
    const onLoad = () => begin();
    if (document.readyState === "complete") {
      begin();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
    const startTimeout = window.setTimeout(begin, START_TIMEOUT_MS);

    // 何かあっても幕が残り続けないよう、上限で必ず外す
    const safety = window.setTimeout(finish, START_TIMEOUT_MS + duration + 1000);
    return () => {
      window.clearTimeout(safety);
      window.clearTimeout(startTimeout);
      window.removeEventListener("load", onLoad);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      ref={rootRef}
      id="app-splash"
      aria-hidden
      className="fixed inset-0 z-[100] overflow-hidden bg-black"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* 原画のざらっとした粒子感。光線の上にだけ薄く重ねる (黒い地は黒のまま) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      <div
        ref={flashRef}
        className="pointer-events-none absolute inset-0 opacity-0"
        style={{
          background:
            "radial-gradient(circle at 50% 46%, #fff 0%, rgba(255,255,255,.85) 18%, rgba(255,255,255,0) 60%)",
        }}
      />
      <div
        ref={logoRef}
        className="absolute left-1/2 top-[46%] aspect-square w-full max-w-[520px]"
        // **最初から静止した状態で見せる** (v1.31.3)。読み込み中はこのまま動かない
        style={{
          transform: "translate(-50%,-50%) scale(1)",
          filter: "blur(0px) brightness(1)",
          // 動いている間は同じ層のまま保たせる (描き直しの乱れを防ぐ)
          willChange: "transform, filter, opacity",
        }}
      >
        {/*
          **元のロゴをそのまま出す。** unoptimized で Next の変換を挟まない (既定の画質だと
          細かな質感が崩れる)。画像は画質 90 の WebP を自分で作って置いている
          (v1.31.9。PNG 905KB → 約250KB、並べて見比べても差が分からない)。
          ファイル名にハッシュが付くので Service Worker が端末に持つ (public/sw.js)。
          影も付けない(文字のすき間が暗く埋まり、後ろの色の光線が見えなくなる)
        */}
        <Image
          src={logoImage}
          alt=""
          priority
          unoptimized
          className="h-full w-full"
        />
        {[
          { left: "78%", top: "32%" },
          { left: "12.5%", top: "77%" },
        ].map((position, i) => (
          <span
            key={i}
            ref={(el) => {
              sparkRefs.current[i] = el;
            }}
            className="splash-spark absolute h-[22px] w-[22px] opacity-0"
            style={position}
          />
        ))}
      </div>
    </div>
  );
}
