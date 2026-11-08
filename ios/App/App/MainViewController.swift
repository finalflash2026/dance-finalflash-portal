import Capacitor
import UIKit

/// 本番の Web を開く WebView と、その上に重ねるネイティブの部品 (SPEC.md §2.3 / §2.3.1)
final class MainViewController: CAPBridgeViewController {
    let tabBar = GlassTabBar()

    override func capacitorDidLoad() {
        // 左端からのスワイプで前の画面に戻る (Safari と同じ)
        webView?.allowsBackForwardNavigationGestures = true
        bridge?.registerPluginInstance(FFNativePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.setVisible(false, animated: false)
        view.addSubview(tabBar)
        let width = tabBar.widthAnchor.constraint(equalToConstant: GlassTabBar.maxWidth)
        width.priority = .defaultHigh
        NSLayoutConstraint.activate([
            tabBar.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            width,
            tabBar.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
            tabBar.heightAnchor.constraint(equalToConstant: GlassTabBar.height),
            tabBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
        ])
    }
}
