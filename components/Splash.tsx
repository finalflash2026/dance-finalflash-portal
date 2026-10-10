"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import logoMask from "@/assets/splash-logo-mask.png";
import logoImage from "@/assets/splash-logo.png";
import logo3dImage from "@/assets/splash-logo-3d.png";

/**
 * 起動アニメーション (SPEC.md §6.7.10 / v1.30)
 *
 * 黒地の中心から光線が走り、閃光の中でロゴ (原画) が現れて、アプリの画面へ溶ける。
 * 全体で約1.6秒。試作は prototypes/splash/。
 *
 * **起動したときだけ** (タブを閉じるまで1回)。画面の移動では出さない。
 * 2回目以降の表示を止めるのは、最初のペイント前に走る SPLASH_INIT_SCRIPT。
 * サーバーが返す HTML に最初から黒い幕が入っているので、後から幕を
 * かぶせる形と違って一瞬アプリの画面が見えることが無い。
 *
 * - 触れば飛ばせる
 * - 「視差効果を減らす」の人には動きを付けず、ロゴを一瞬出して消すだけ
 * - **ロゴは背景を抜いた透過画像** (v1.31。Adobe の背景削除で原画から切り出した
 *   `assets/logo/logo-cutout.png` を縮めたもの)。以前は光線ごと焼き込まれた原画を
 *   重ねていたため、原画の四角い縁と外の光線の間に段差が出ていた。ロゴだけを
 *   乗せれば、光線は画面いっぱいでひと続きのまま動き続ける
 */

export const SPLASH_SESSION_KEY = "splash-shown";

/**
 * 最初のペイント前に走らせる (app/layout.tsx の head に埋め込む)。
 * この起動で既に出していたら `<html data-splash="off">` を立てて幕を消す。
 * sessionStorage が使えない環境では出さない (毎回出ると邪魔になるため)。
 * URL に `?splash` を付けると、表示済みでももう一度流す (見た目の確認用)。
 */
export const SPLASH_INIT_SCRIPT = `try{if(!/[?&]splash(=|&|$)/.test(location.search)&&sessionStorage.getItem(${JSON.stringify(
  SPLASH_SESSION_KEY,
)})){document.documentElement.dataset.splash="off"}}catch(e){document.documentElement.dataset.splash="off"}`;

/**
 * ロゴの出し方 (v1.31 で比べている途中。`?splash=still|video|flat` で切り替えて見られる)
 *   still … Blender で立体化した銀のロゴ (静止画) の上を、光の帯が横切る
 *   video … Blender で書き出した映像。ロゴが数度だけ傾きながら光が走る (約0.4MB)
 *   flat  … 背景を抜いた元のロゴ (平面)
 */
type Variant = "still" | "video" | "flat";
const DEFAULT_VARIANT: Variant = "still";

function readVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get("splash");
  return value === "video" || value === "flat" || value === "still" ? value : DEFAULT_VARIANT;
}

const DURATION_MS = 1700;
/** 映像 (1.4秒) を最後まで見せるため、映像のときだけ少し長くする */
const VIDEO_DURATION_MS = 2300;
const REDUCED_DURATION_MS = 900;
/** 原画の光線の色 (ピンク・黄・水色・緑・白・紫が多い) */
const COLORS = ["#ff3d7f", "#ff6aa8", "#ff4d4d", "#ffd84a", "#ffb547", "#45d9ff", "#6dff9a", "#ffffff", "#ffffff", "#9a7bff"];

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
const backOut = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

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
  const flatRef = useRef<HTMLDivElement>(null);
  const stillRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
    // 動きを減らす設定の人には映像を使わない (静止画のまま一瞬出して消す)
    const variant: Variant = reduce && readVariant() === "video" ? "still" : readVariant();
    flatRef.current!.style.display = variant === "flat" ? "block" : "none";
    stillRef.current!.style.display = variant === "still" ? "block" : "none";
    const video = videoRef.current!;
    video.style.display = variant === "video" ? "block" : "none";
    if (variant === "video") {
      // 透過付きの映像。iPhone/Mac の Safari は HEVC、それ以外は VP9 (WebM) で持っている
      video.src = video.canPlayType('video/mp4; codecs="hvc1"')
        ? "/splash/logo-3d-alpha.mov"
        : "/splash/logo-3d-alpha.webm";
      video.load();
    }
    let videoStarted = false;
    // 映像は透過付きなので普通に重ねる (v1.31)。黒地の映像をスクリーンで重ねていた
    // ときは、明るい光線の上で文字まで透けてしまった
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
        ctx.globalAlpha = ray.alpha * (ray.width > 7 ? 0.32 : 0.7);
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
        logo.style.opacity = String(seg(t, 0, 0.25));
        logo.style.filter = "none";
        logo.style.transform = "translate(-50%,-50%) scale(1)";
        root!.style.opacity = String(1 - seg(t, 0.7, 1));
        return;
      }
      // 先にロゴが閃光とともに現れ、その裏から光線が噴き出す
      drawRays(seg(t, 0.12, 0.66));
      const f = seg(t, 0.02, 0.1);
      const fo = seg(t, 0.1, 0.36);
      flash.style.opacity = (f * (1 - fo)).toFixed(3);
      const l = seg(t, 0.04, 0.34);
      logo.style.opacity = easeOut(l).toFixed(3);
      // 閃光の中で白く飛んだ状態から、銀の質感へ落ち着く。
      // 映像は自分で光が走るので、明るさはいじらずぼかしだけ
      logo.style.filter =
        variant === "video"
          ? `blur(${(10 * (1 - easeOut(l))).toFixed(2)}px)`
          : `blur(${(14 * (1 - easeOut(l))).toFixed(2)}px) brightness(${(
              1 + 1.4 * (1 - easeOut(seg(t, 0.06, 0.5)))
            ).toFixed(3)})`;
      if (variant === "video" && !videoStarted && t >= 0.04) {
        videoStarted = true;
        void video.play().catch(() => {});
      }
      // 静止画の立体ロゴの上を、光の帯が左上から右下へ横切る
      if (variant === "still" && shineRef.current) {
        const sweep = easeOut(seg(t, 0.4, 0.8));
        shineRef.current.style.backgroundPosition = `${(160 - 220 * sweep).toFixed(1)}% 0`;
      }
      // 小さく弾むように前へ出る
      logo.style.transform = `translate(-50%,-50%) scale(${(0.82 + 0.18 * backOut(l)).toFixed(4)})`;
      sparks.forEach((spark, i) => {
        if (!spark) return;
        const s = seg(t, 0.55 + i * 0.07, 0.73 + i * 0.07);
        const v = Math.sin(s * Math.PI);
        spark.style.opacity = v.toFixed(3);
        spark.style.transform = `scale(${(v * 1.3).toFixed(3)}) rotate(${s * 90}deg)`;
      });
      const x = easeOut(seg(t, 0.82, 1));
      root!.style.opacity = (1 - x).toFixed(3);
      root!.style.transform = `scale(${1 + x * 0.08})`;
    }

    const duration = reduce
      ? REDUCED_DURATION_MS
      : variant === "video"
        ? VIDEO_DURATION_MS
        : DURATION_MS;
    const begin = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = (now - start) / duration;
        frame(t);
        if (t < 1) raf = requestAnimationFrame(tick);
        else finish();
      };
      raf = requestAnimationFrame(tick);
    };

    // 原画が読めるまで少しだけ待つ (間に合わなければ光線だけで進める)。
    // 2回目以降は端末に持っているので待たずに始まる
    const image =
      variant === "flat"
        ? flatRef.current!.querySelector("img")
        : variant === "still"
          ? stillRef.current!.querySelector("img")
          : null;
    if (image && !image.complete) {
      const timeout = window.setTimeout(begin, 600);
      image.addEventListener(
        "load",
        () => {
          window.clearTimeout(timeout);
          if (!raf && !finished) begin();
        },
        { once: true },
      );
    } else {
      begin();
    }

    // 何かあっても幕が残り続けないよう、上限で必ず外す
    const safety = window.setTimeout(finish, 4000);
    return () => {
      window.clearTimeout(safety);
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
      {/* 原画のざらっとした粒子感。光線の上にだけ薄く重ねる */}
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
        className="absolute left-1/2 top-[46%] aspect-square w-full max-w-[520px] opacity-0"
        style={{ transform: "translate(-50%,-50%) scale(0.82)", filter: "blur(14px)" }}
      >
        {/*
          ロゴのまわりの影はごく薄くする。濃くすると文字のすき間が暗く埋まり、
          原画のように後ろの色の光線が見えなくなる
        */}
        {/* 立体化したロゴ (既定)。next/image で端末に合わせた小さな形式で届く */}
        <div ref={stillRef} className="absolute inset-0">
          <Image
            src={logo3dImage}
            alt=""
            priority
            sizes="(max-width: 520px) 100vw, 520px"
            className="h-full w-full"
            style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,0.6))" }}
          />
          {/* 光の帯。ロゴの形で切り抜いて、ロゴの上だけを走らせる */}
          <div
            ref={shineRef}
            className="pointer-events-none absolute inset-0"
            style={{
              mixBlendMode: "screen",
              background:
                "linear-gradient(115deg, transparent 38%, rgba(255,255,255,0.85) 48%, rgba(200,225,255,0.6) 52%, transparent 62%)",
              backgroundSize: "300% 100%",
              backgroundPosition: "160% 0",
              WebkitMaskImage: `url(${logoMask.src})`,
              maskImage: `url(${logoMask.src})`,
              WebkitMaskSize: "100% 100%",
              maskSize: "100% 100%",
            }}
          />
        </div>
        {/* 平面のロゴ (比較用) */}
        <div ref={flatRef} className="absolute inset-0" style={{ display: "none" }}>
          <Image
            src={logoImage}
            alt=""
            sizes="(max-width: 520px) 100vw, 520px"
            className="h-full w-full"
            style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,0.6))" }}
          />
        </div>
        {/* 映像 (比較用)。透過付きで、使うときだけ読み込む (preload="none") */}
        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full"
          style={{ display: "none" }}
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
