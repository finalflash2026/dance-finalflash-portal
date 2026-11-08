import Capacitor
import UIKit
import WidgetKit

/// Web からネイティブの部品を動かす窓口 (SPEC.md §2.3.1 / v1.38)。
/// JS 側は lib/native-plugin.ts。
@objc(FFNativePlugin)
final class FFNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "FFNativePlugin"
    let jsName = "FFNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setTabBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDigest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearDigest", returnType: CAPPluginReturnPromise),
    ]

    private var tabBar: GlassTabBar? {
        (bridge?.viewController as? MainViewController)?.tabBar
    }

    /// { visible, selected, tabs: [{ id, label, symbol }], accent, accentForeground, dark }
    @objc func setTabBar(_ call: CAPPluginCall) {
        let visible = call.getBool("visible", false)
        let tabs = (call.getArray("tabs", JSObject.self) ?? []).compactMap { object -> GlassTabBar.Tab? in
            guard let id = object["id"] as? String, let label = object["label"] as? String else { return nil }
            return GlassTabBar.Tab(id: id, label: label, symbol: object["symbol"] as? String ?? "circle")
        }
        let selected = call.getString("selected")
        let accent = call.getString("accent").flatMap(UIColor.init(css:))
        let accentForeground = call.getString("accentForeground").flatMap(UIColor.init(css:))
        let dark = call.getBool("dark", true)

        DispatchQueue.main.async { [weak self] in
            guard let self, let bar = self.tabBar else { return call.resolve() }
            bar.onSelect = { [weak self] tab in
                self?.notifyListeners("tabSelect", data: ["id": tab.id])
            }
            if !tabs.isEmpty {
                bar.update(tabs: tabs, selectedId: selected, accent: accent,
                           accentForeground: accentForeground, dark: dark)
            }
            bar.setVisible(visible && !tabs.isEmpty, animated: true)
            call.resolve()
        }
    }

    /// GET /api/app/digest の結果をウィジェットに渡す
    @objc func setDigest(_ call: CAPPluginCall) {
        guard let object = call.getObject("digest"),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let digest = try? JSONDecoder().decode(Digest.self, from: data)
        else {
            return call.reject("予定を読めませんでした")
        }
        DigestStore.save(digest)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /// ログアウトしたら消す (ウィジェットに前の人の予定を残さない)
    @objc func clearDigest(_ call: CAPPluginCall) {
        DigestStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
