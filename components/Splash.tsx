"use client";

import { useEffect, useRef, useState } from "react";

import poster from "@/assets/splash-poster.jpg";

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
 * - ロゴの原画は光線とロゴが元から一体の絵。切り抜いて重ねると縁に溝が出たので、
 *   原画をそのまま使い、閃光の中で差し替える
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

const DURATION_MS = 1700;
const REDUCED_DURATION_MS = 900;
const COLORS = ["#ff3b6b", "#ff6fa0", "#ffd23f", "#f7b733", "#3fe0ff", "#4cff8a", "#ffffff", "#a98bff"];

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

    const rays: Ray[] = Array.from({ length: 120 }, () => ({
      angle: Math.random() * Math.PI * 2,
      width: 1 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      speed: 0.6 + Math.random() * 0.9,
      delay: Math.random() * 0.18,
      alpha: 0.35 + Math.random() * 0.65,
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
      for (const ray of rays) {
        const k = clamp((p - ray.delay) * ray.speed * 2.2);
        if (k <= 0) continue;
        const e = easeOut(k);
        const r1 = reach * e;
        const r0 = reach * Math.max(0, e - 0.82) + 18;
        const x0 = cx + Math.cos(ray.angle) * r0;
        const y0 = cy + Math.sin(ray.angle) * r0;
        const x1 = cx + Math.cos(ray.angle) * r1;
        const y1 = cy + Math.sin(ray.angle) * r1;
        const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(0.35, ray.color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.strokeStyle = gradient;
        ctx.globalAlpha = ray.alpha * (0.55 + 0.45 * e);
        ctx.lineWidth = ray.width * (0.4 + e);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
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
      drawRays(seg(t, 0.02, 0.6));
      const f = seg(t, 0.28, 0.36);
      const fo = seg(t, 0.36, 0.6);
      flash.style.opacity = (f * (1 - fo)).toFixed(3);
      const l = seg(t, 0.3, 0.62);
      logo.style.opacity = easeOut(l).toFixed(3);
      logo.style.filter = `blur(${(14 * (1 - easeOut(l))).toFixed(2)}px)`;
      logo.style.transform = `translate(-50%,-50%) scale(${(1.3 - 0.3 * backOut(l)).toFixed(4)})`;
      // 原画の光線と二重にならないよう、外の光線は少し引く (消しはしない)
      canvas!.style.opacity = (1 - 0.45 * easeOut(l)).toFixed(3);
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

    const duration = reduce ? REDUCED_DURATION_MS : DURATION_MS;
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
    const image = logo.querySelector("img");
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
        style={{
          transform: "translate(-50%,-50%) scale(1.3)",
          filter: "blur(14px)",
          /*
           * **スクリーンで重ねる。** 原画は黒地の上に光線とロゴが描かれた四角い絵で、
           * 普通に重ねると黒地が外の光線を四角く隠し、境目に段差ができていた。
           * スクリーンなら黒は透けて明るい部分 (ロゴ・光線) だけが乗るので、
           * 外側で動く光線と原画の光線がひと続きになる
           */
          mixBlendMode: "screen",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 最初のペイントに要るので最適化の遅延を挟まない */}
        <img
          src={poster.src}
          alt=""
          className="h-full w-full"
          style={{
            WebkitMaskImage:
              "radial-gradient(closest-side, #000 72%, transparent 100%)",
            maskImage:
              "radial-gradient(closest-side, #000 72%, transparent 100%)",
          }}
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
