import UIKit

/// 下のタブバー (SPEC.md §2.3.1 / v1.39)
///
/// **iOS 純正のタブバー** (`UITabBar`)。iOS 26 以降は OS がそのまま Liquid Glass で描き、
/// 押したときの手触りも OS と同じになる。
///
/// 画面は WebView 1枚なので、`UITabBarController` は使わず、UIKit の `UITabBar` を
/// WebView の上に直接置く (コントローラーにすると、空のタブの画面が WebView を覆う)。
/// 何を出すか・どれを選んでいるかは Web が `FFNative.setTabBar` で決め、
/// 押されたら Web に `tabSelect` を返して Web が画面を移す。
final class NativeTabBar: NSObject, UITabBarDelegate {
    struct Tab: Equatable {
        let id: String
        let label: String
        let symbol: String
    }

    let bar = UITabBar()
    var onSelect: ((Tab) -> Void)?
    private var webTabs: [Tab] = []
    private(set) var visible = false

    func install(in view: UIView) {
        bar.delegate = self
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.alpha = 0
        bar.isHidden = true
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            // 高さは UITabBar 自身がホームバーのぶんまで決める
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -49),
        ])
    }

    /// Web からの指示を反映する
    func update(tabs newTabs: [Tab], selectedId: String?, tint: UIColor?, dark: Bool) {
        bar.overrideUserInterfaceStyle = dark ? .dark : .light
        if let tint { bar.tintColor = tint }
        if newTabs != webTabs {
            webTabs = newTabs
            bar.setItems(newTabs.enumerated().map { index, tab in
                let item = UITabBarItem(title: tab.label, image: UIImage(systemName: tab.symbol), tag: index)
                item.accessibilityLabel = tab.label
                return item
            }, animated: false)
        }
        if let index = webTabs.firstIndex(where: { $0.id == selectedId }),
           let items = bar.items, items.indices.contains(index) {
            bar.selectedItem = items[index]
        }
    }

    /// 出し入れ (タブの画面でだけ出す)。下へ少し沈めながら消す
    func setVisible(_ visible: Bool, animated: Bool) {
        guard visible != self.visible else { return }
        self.visible = visible
        if visible { bar.isHidden = false }
        let changes = {
            self.bar.alpha = visible ? 1 : 0
            self.bar.transform = visible ? .identity : CGAffineTransform(translationX: 0, y: 16)
        }
        let done: (Bool) -> Void = { _ in if !self.visible { self.bar.isHidden = true } }
        if animated {
            UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 1,
                           initialSpringVelocity: 0, options: [.beginFromCurrentState],
                           animations: changes, completion: done)
        } else {
            changes()
            done(true)
        }
    }

    // MARK: UITabBarDelegate

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard webTabs.indices.contains(item.tag) else { return }
        onSelect?(webTabs[item.tag])
    }
}

extension UIColor {
    /// "#1f2933" / "#fff" / " rgb(31, 41, 51)" を読む。読めなければ nil
    convenience init?(css: String) {
        let value = css.trimmingCharacters(in: .whitespaces).lowercased()
        if value.hasPrefix("#") {
            var hex = String(value.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count == 6, let number = UInt32(hex, radix: 16) else { return nil }
            self.init(
                red: CGFloat((number >> 16) & 0xff) / 255,
                green: CGFloat((number >> 8) & 0xff) / 255,
                blue: CGFloat(number & 0xff) / 255,
                alpha: 1
            )
            return
        }
        if value.hasPrefix("rgb") {
            let numbers = value
                .components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
                .compactMap { Double($0) }
            guard numbers.count >= 3 else { return nil }
            self.init(red: numbers[0] / 255, green: numbers[1] / 255, blue: numbers[2] / 255,
                      alpha: numbers.count >= 4 ? numbers[3] : 1)
            return
        }
        return nil
    }
}
