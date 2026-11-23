import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * iOS アプリの中の自前の部品 (SPEC.md §2.3.1 / v1.38)。
 * ネイティブ側は ios/App/App/FFNativePlugin.swift。
 * **アプリの中でだけ呼ぶこと** (isNativeApp() で確かめてから)。
 */
export interface NativeTab {
  id: string;
  label: string;
  /** SF Symbols の名前 */
  symbol: string;
}

/** 右上の丸ボタン (v1.41) */
export interface NativeHeaderButton {
  id: string;
  /** SF Symbols の名前 */
  symbol: string;
  /** 読み上げの名前 */
  label: string;
  /** 右上に出す数 (お知らせの未読)。0 なら出さない */
  badge: number;
}

export interface FFNativePlugin {
  setTabBar(options: {
    visible: boolean;
    selected?: string;
    tabs?: NativeTab[];
    /** 選んでいるタブの色 (CSS の色) */
    tint?: string;
    dark?: boolean;
  }): Promise<void>;
  /** 右上の丸ボタンと戻る (本物の Liquid Glass のボタン。v1.41) */
  setHeader(options: {
    visible: boolean;
    back: { label: string } | null;
    right: NativeHeaderButton[];
    dark?: boolean;
    tint?: string;
  }): Promise<void>;
  setDigest(options: { digest: unknown }): Promise<void>;
  clearDigest(): Promise<void>;
  /** OAuth の画面を開き、戻り先 (callbackScheme://…) の URL を返す。閉じられたら cancelled */
  authenticate(options: {
    url: string;
    callbackScheme: string;
  }): Promise<{ url?: string; cancelled?: boolean }>;
  /**
   * iOS 用の OAuth クライアントで Google にログインし、ID トークンを返す (v1.41)。
   * nonce は SHA-256 した値を渡す。閉じられたら cancelled
   */
  googleSignIn(options: {
    clientId: string;
    nonce: string;
  }): Promise<{ idToken?: string; cancelled?: boolean }>;
  addListener(
    event: "tabSelect" | "headerTap",
    listener: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const FFNative = registerPlugin<FFNativePlugin>("FFNative");
