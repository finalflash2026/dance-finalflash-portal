import Capacitor
import UIKit

/// 本番の Web を開く WebView と、その上に重ねる iOS 純正のタブバー (SPEC.md §2.3 / §2.3.1)
final class MainViewController: CAPBridgeViewController {
    let tabs = NativeTabBar()
    let header = NativeHeader()

    override func capacitorDidLoad() {
        // 左端からのスワイプで前の画面に戻る (Safari と同じ)
        webView?.allowsBackForwardNavigationGestures = true
        bridge?.registerPluginInstance(FFNativePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        tabs.install(in: view)
        header.install(in: view)
    }
}
