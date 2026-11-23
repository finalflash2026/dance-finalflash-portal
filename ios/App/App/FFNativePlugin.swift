import AuthenticationServices
import Capacitor
import CryptoKit
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
        CAPPluginMethod(name: "setHeader", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDigest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearDigest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "googleSignIn", returnType: CAPPluginReturnPromise),
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

    /// 右上の丸ボタンと戻る (本物の Liquid Glass のボタン。v1.41)
    /// { visible, back: { label } | null, right: [{ id, symbol, label, badge }], dark, tint }
    @objc func setHeader(_ call: CAPPluginCall) {
        let visible = call.getBool("visible", false)
        let back = call.getObject("back")?["label"] as? String
        let right = (call.getArray("right", JSObject.self) ?? []).compactMap { object -> NativeHeader.Item? in
            guard let id = object["id"] as? String else { return nil }
            return NativeHeader.Item(
                id: id,
                symbol: object["symbol"] as? String ?? "circle",
                label: object["label"] as? String ?? id,
                badge: (object["badge"] as? NSNumber)?.intValue ?? 0
            )
        }
        let tint = call.getString("tint").flatMap(UIColor.init(css:))
        let dark = call.getBool("dark", false)
        DispatchQueue.main.async { [weak self] in
            guard let self, let header = (self.bridge?.viewController as? MainViewController)?.header else {
                return call.resolve()
            }
            header.onTap = { [weak self] id in
                self?.notifyListeners("headerTap", data: ["id": id])
            }
            header.update(back: back, right: right, tint: tint, dark: dark)
            header.setVisible(visible && (back != nil || !right.isEmpty), animated: true)
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

    /// Google にログインして ID トークンを返す (SPEC.md §3.7 / v1.41)。
    ///
    /// iOS 用の OAuth クライアント (秘密の鍵が無い) で、OAuth 専用の画面から
    /// Google に直接聞く。コードと ID トークンの引き換えは PKCE で行う。
    /// Google の画面に出るのは同意画面のアプリ名で、Supabase の名前は出ない。
    @objc func googleSignIn(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), let nonce = call.getString("nonce") else {
            return call.reject("Google のクライアント ID がありません")
        }
        // "123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc"
        let scheme = clientId.split(separator: ".").reversed().joined(separator: ".")
        let redirect = "\(scheme):/oauth2redirect"
        let verifier = Self.randomURLSafe(bytes: 48)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        guard let url = components.url else { return call.reject("ログインの URL を作れませんでした") }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.authSession = nil
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    return call.resolve(["cancelled": true])
                }
                guard let callbackURL,
                      let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "code" })?.value
                else {
                    return call.reject(error?.localizedDescription ?? "Google でログインできませんでした")
                }
                Self.exchange(code: code, clientId: clientId, redirect: redirect, verifier: verifier) { idToken in
                    if let idToken {
                        call.resolve(["idToken": idToken])
                    } else {
                        call.reject("Google でログインできませんでした")
                    }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() {
                self.authSession = nil
                call.reject("ログインの画面を開けませんでした")
            }
        }
    }

    /// 認可コードを ID トークンに引き換える (PKCE。秘密の鍵は使わない)
    private static func exchange(code: String, clientId: String, redirect: String, verifier: String,
                                 completion: @escaping (String?) -> Void) {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code_verifier", value: verifier),
        ]
        request.httpBody = body.percentEncodedQuery?.data(using: .utf8)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            completion(json?["id_token"] as? String)
        }.resume()
    }

    private static func randomURLSafe(bytes count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension FFNativePlugin: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
