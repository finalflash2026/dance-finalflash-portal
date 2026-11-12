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

/**
 * 光線が出きった瞬間の絵を1枚描く (v1.40)。原画のような太さの揃わない帯
 * (細い線と、にじんだ太い帯) と、ざらっとした粒子感。描くのは起動時の1回だけ
 */
function paintBurst(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  /*
   * **画面より大きい正方形に描き、ふちを丸くぼかす。** 拡大していく途中で
   * 絵の四角い端が見えないように (小さいうちは丸い光、最後は端が画面の外)
   */
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = Math.ceil(Math.hypot(width, height) * 1.15);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.left = `${width / 2 - size / 2}px`;
  canvas.style.top = `${height * 0.46 - size / 2}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const c = size / 2;
  const reach = c * 0.98;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 0; i < 96; i++) {
    const angle = Math.random() * Math.PI * 2;
    const wide = Math.random() < 0.3;
    const lineWidth = wide ? 8 + Math.random() * 14 : 1.5 + Math.random() * 5;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const alpha = 0.35 + Math.random() * 0.6;
    const r = reach * (0.75 + Math.random() * 0.25);
    const x1 = c + Math.cos(angle) * r;
    const y1 = c + Math.sin(angle) * r;
    /*
     * **光線はロゴの裏 (中心) から伸ばし、中心を空けない** (v1.31)。
     * 根元 (ロゴの裏) は控えめに。全部の線が中心に集まるので、根元まで濃くすると白く飛ぶ
     */
    const gradient = ctx.createLinearGradient(c, c, x1, y1);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.12, color);
    gradient.addColorStop(0.6, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = gradient;
    // 太い帯はにじませる (原画の光線は輪郭がぼけている)
    ctx.shadowColor = color;
    ctx.shadowBlur = wide ? 18 : 6;
    // 重なりで白く飛ばないよう、原画のように光線の間の黒を残す濃さに
    ctx.globalAlpha = alpha * (wide ? 0.26 : 0.6);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // 原画のざらっとした粒子感。光線の上にだけ乗るよう、光線のある所だけに重ねる
  const tile = document.createElement("canvas");
  tile.width = tile.height = 128;
  const tctx = tile.getContext("2d");
  if (tctx) {
    const image = tctx.createImageData(128, 128);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = Math.random() * 255;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    tctx.putImageData(image, 0, 0);
    const pattern = ctx.createPattern(tile, "repeat");
    if (pattern) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, size, size);
    }
  }

  // ふちを丸くぼかす (中心から外へ透明に)
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
}

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
    const logo = logoRef.current!;
    const flash = flashRef.current!;
    const sparks = sparkRefs.current;

    /*
     * **光線は最初に1枚の絵として描き、あとは絵ごと拡大して噴き出させる** (v1.40)。
     * 以前は毎フレーム96本をぼかし (shadowBlur) 付きで描き直していて、
     * 端末によってはカクついた。動かすのは transform と opacity だけにし、
     * Web Animations API に任せる (読み込み中で JS が忙しくても止まらない)
     */
    if (!reduce) paintBurst(canvas);

    let finished = false;
    const animations: Animation[] = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      animations.forEach((animation) => animation.cancel());
      setGone(true);
      document.documentElement.dataset.splash = "done";
      window.dispatchEvent(new Event(SPLASH_DONE_EVENT));
    };
    root.addEventListener("pointerdown", finish);

    const duration = reduce ? REDUCED_DURATION_MS : DURATION_MS;
    let started = false;
    const begin = () => {
      if (started || finished) return;
      started = true;
      const play = (
        el: Element,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions = {},
      ) => {
        const animation = el.animate(keyframes, { duration, fill: "both", ...options });
        animations.push(animation);
        return animation;
      };

      if (reduce) {
        // 動きを減らす設定: 静止したロゴのまま、ふっと消えるだけ
        play(root, [{ opacity: 1, offset: 0.2 }, { opacity: 0 }]).onfinish = finish;
        return;
      }

      // 閃光 (ロゴの裏が一瞬白く光る)
      play(flash, [
        { opacity: 0 },
        { opacity: 1, offset: 0.08 },
        { opacity: 0, offset: 0.34 },
        { opacity: 0 },
      ]);
      // ロゴが小さく脈打つ
      play(logo, [
        { transform: "translate(-50%,-50%) scale(1)" },
        { transform: "translate(-50%,-50%) scale(1.05)", offset: 0.14, easing: "ease-in" },
        { transform: "translate(-50%,-50%) scale(1)", offset: 0.3 },
        { transform: "translate(-50%,-50%) scale(1)" },
      ], { easing: "ease-out" });
      // 光線が中心から噴き出す (絵ごと拡大)。少しだけ回して止まった絵に見せない
      play(canvas, [
        { transform: "scale(0.12) rotate(-4deg)", opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: "scale(1) rotate(0deg)", opacity: 1, offset: 0.62 },
        { transform: "scale(1.06) rotate(1deg)", opacity: 1 },
      ], { easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      // きらめき
      sparks.forEach((spark, i) => {
        if (!spark) return;
        const from = 0.45 + i * 0.07;
        play(spark, [
          { opacity: 0, transform: "scale(0) rotate(0deg)" },
          { opacity: 0, transform: "scale(0) rotate(0deg)", offset: from },
          { opacity: 1, transform: "scale(1.3) rotate(45deg)", offset: from + 0.09 },
          { opacity: 0, transform: "scale(0) rotate(90deg)", offset: from + 0.18 },
          { opacity: 0, transform: "scale(0) rotate(90deg)" },
        ]);
      });
      // 最後にアプリの画面へ溶ける
      play(root, [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 1, transform: "scale(1)", offset: 0.8 },
        { opacity: 0, transform: "scale(1.08)" },
      ], { easing: "ease-out" }).onfinish = finish;
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
      animations.forEach((animation) => animation.cancel());
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
      {/* 光線と粒子感は最初に1枚に描いておき、絵ごと動かす (v1.40) */}
      <canvas
        ref={canvasRef}
        // 大きさと位置は描くときに決める (画面より大きい正方形。paintBurst)
        className="absolute left-0 top-0 opacity-0"
        style={{ transformOrigin: "50% 50%", willChange: "transform, opacity" }}
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
          // 動いている間は同じ層のまま保たせる (描き直しの乱れを防ぐ)。
          // filter は動かさない (v1.40。毎フレーム大きな画像を描き直してカクついた)
          willChange: "transform",
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
