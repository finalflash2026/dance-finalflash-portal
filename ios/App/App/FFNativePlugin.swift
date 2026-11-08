import AuthenticationServices
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
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
    ]

    /// 進行中のログイン (終わるまで持っておかないと途中で消える)
    private var authSession: ASWebAuthenticationSession?

    private var tabController: NativeTabBar? {
        (bridge?.viewController as? MainViewController)?.tabs
    }

    /// { visible, selected, tabs: [{ id, label, symbol }], tint, dark }
    @objc func setTabBar(_ call: CAPPluginCall) {
        let visible = call.getBool("visible", false)
        let tabs = (call.getArray("tabs", JSObject.self) ?? []).compactMap { object -> NativeTabBar.Tab? in
            guard let id = object["id"] as? String, let label = object["label"] as? String else { return nil }
            return NativeTabBar.Tab(id: id, label: label, symbol: object["symbol"] as? String ?? "circle")
        }
        let selected = call.getString("selected")
        let tint = call.getString("tint").flatMap(UIColor.init(css:))
        let dark = call.getBool("dark", false)

        DispatchQueue.main.async { [weak self] in
            guard let self, let controller = self.tabController else { return call.resolve() }
            controller.onSelect = { [weak self] tab in
                self?.notifyListeners("tabSelect", data: ["id": tab.id])
            }
            if !tabs.isEmpty {
                controller.update(tabs: tabs, selectedId: selected, tint: tint, dark: dark)
            }
            controller.setVisible(visible && !tabs.isEmpty, animated: true)
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

    /// Google などでのログイン (SPEC.md §2.3 / §3.7 / v1.40)。
    ///
    /// iOS の OAuth 専用の画面 (ASWebAuthenticationSession) で開き、戻り先の
    /// `ffcalendar://` に来た時点で自動で閉じて、その URL を返す。
    /// アプリ内の Safari (SFSafariViewController) と違い、サーバーから
    /// アプリへの転送をブラウザが拒んで、ブラウザの中でサイトが開いてしまうことがない。
    @objc func authenticate(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = call.getString("callbackScheme") else {
            return call.reject("ログインの URL がありません")
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.authSession = nil
                if let callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                } else {
                    call.reject(error?.localizedDescription ?? "ログインできませんでした")
                }
            }
            session.presentationContextProvider = self
            // Safari の Google のログイン状態を使えるようにする
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() {
                self.authSession = nil
                call.reject("ログインの画面を開けませんでした")
            }
        }
    }
}

extension FFNativePlugin: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
