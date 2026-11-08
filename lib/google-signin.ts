"use client";

/**
 * Google でのログインを ID トークンで渡す形の道具 (SPEC.md §3.7 / v1.41)
 *
 * Google には SHA-256 した nonce を、Supabase には元の nonce を渡す。
 * Supabase は ID トークンの nonce が「元の値の SHA-256」と一致するかを確かめる
 * (同じトークンを別のところで使い回させない)。
 */

export interface Nonce {
  raw: string;
  hashed: string;
}

export async function createNonce(): Promise<Nonce> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

/** Google Identity Services のうち、ここで使うところだけ */
export interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        nonce?: string;
        ux_mode?: "popup" | "redirect";
        auto_select?: boolean;
        use_fedcm_for_button?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
          locale?: string;
        },
      ): void;
    };
  };
}

let loading: Promise<GoogleIdentity> | null = null;

/** Google Identity Services の読み込み (1回だけ) */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const existing = (window as Window & { google?: GoogleIdentity }).google;
  if (existing?.accounts?.id) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const google = (window as Window & { google?: GoogleIdentity }).google;
      if (google?.accounts?.id) resolve(google);
      else reject(new Error("Google のログインを読み込めませんでした"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Google のログインを読み込めませんでした"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
