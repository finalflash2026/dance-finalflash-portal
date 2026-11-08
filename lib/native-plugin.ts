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

export interface FFNativePlugin {
  setTabBar(options: {
    visible: boolean;
    selected?: string;
    tabs?: NativeTab[];
    /** 選んでいるタブの色 (CSS の色) */
    tint?: string;
    dark?: boolean;
  }): Promise<void>;
  setDigest(options: { digest: unknown }): Promise<void>;
  clearDigest(): Promise<void>;
  /** OAuth の画面を開き、戻り先 (callbackScheme://…) の URL を返す。閉じられたら cancelled */
  authenticate(options: {
    url: string;
    callbackScheme: string;
  }): Promise<{ url?: string; cancelled?: boolean }>;
  addListener(
    event: "tabSelect",
    listener: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const FFNative = registerPlugin<FFNativePlugin>("FFNative");
