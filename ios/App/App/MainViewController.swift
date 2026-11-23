import Capacitor
import UIKit

/// 本番の Web を開く WebView と、その上に重ねる iOS 純正のタブバー (SPEC.md §2.3 / §2.3.1)
final class MainViewController: CAPBridgeViewController {
    let tabs = NativeTabBar()
    let header = NativeHeader()
    private var scrollObservation: NSKeyValueObservation?

    override func capacitorDidLoad() {
        // 左端からのスワイプで前の画面に戻る (Safari と同じ)
        webView?.allowsBackForwardNavigationGestures = true
        // リンクの長押しで出るプレビューを止める (押すと Safari で開いてしまう。v1.42)
        webView?.allowsLinkPreview = false
        bridge?.registerPluginInstance(FFNativePlugin())
        // 右上のボタンをページのスクロールに合わせて動かす (v1.42)
        scrollObservation = webView?.scrollView.observe(\.contentOffset, options: [.new]) { [weak self] scrollView, _ in
            let y = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
            DispatchQueue.main.async { self?.header.follow(scrollOffset: y) }
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        tabs.install(in: view)
        header.install(in: view)
    }
}
