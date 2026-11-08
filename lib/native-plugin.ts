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
  addListener(
    event: "tabSelect",
    listener: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const FFNative = registerPlugin<FFNativePlugin>("FFNative");
