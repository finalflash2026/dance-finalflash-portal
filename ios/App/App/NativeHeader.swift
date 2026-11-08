import UIKit

/// 右上の丸ボタン (ベル・?・歯車) と左上の戻る (SPEC.md §2.3.1 / v1.41)
///
/// iOS 26 以降は **本物の Liquid Glass のボタン** (`UIButton.Configuration.glass()`)。
/// それより前は iOS の灰色のボタン。何を出すかは Web が `FFNative.setHeader` で決め、
/// 押されたら Web の同じボタン (`[data-header-action]`) を押してもらう。
final class NativeHeader {
    struct Item: Equatable {
        let id: String
        let symbol: String
        let label: String
        let badge: Int
    }

    var onTap: ((String) -> Void)?

    private let backButton = UIButton(type: .system)
    private let rightStack = UIStackView()
    private var rightItems: [Item] = []
    private var backLabel: String?
    private(set) var visible = false

    func install(in view: UIView) {
        backButton.configuration = Self.glassConfiguration()
        backButton.translatesAutoresizingMaskIntoConstraints = false
        backButton.addAction(UIAction { [weak self] _ in self?.tap("back") }, for: .touchUpInside)
        view.addSubview(backButton)

        rightStack.axis = .horizontal
        rightStack.spacing = 8
        rightStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(rightStack)

        NSLayoutConstraint.activate([
            backButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            backButton.heightAnchor.constraint(equalToConstant: 44),
            rightStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            rightStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            rightStack.heightAnchor.constraint(equalToConstant: 44),
        ])
        setVisible(false, animated: false)
    }

    private static func glassConfiguration() -> UIButton.Configuration {
        var config: UIButton.Configuration
        if #available(iOS 26.0, *) {
            config = .glass()
        } else {
            config = .gray()
        }
        config.cornerStyle = .capsule
        return config
    }

    func update(back: String?, right: [Item], tint: UIColor?, dark: Bool) {
        let style: UIUserInterfaceStyle = dark ? .dark : .light
        backButton.overrideUserInterfaceStyle = style
        rightStack.overrideUserInterfaceStyle = style

        if back != backLabel {
            backLabel = back
            var config = Self.glassConfiguration()
            config.image = UIImage(systemName: "chevron.left",
                                   withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
            config.imagePadding = 4
            var title = AttributedString(back ?? "")
            title.font = .systemFont(ofSize: 16, weight: .semibold)
            config.attributedTitle = title
            config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 14)
            backButton.configuration = config
            backButton.accessibilityLabel = back
        }
        if let tint { backButton.tintColor = tint }
        backButton.isHidden = back == nil

        if right != rightItems {
            rightItems = right
            rightStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for item in right {
                rightStack.addArrangedSubview(makeRoundButton(item))
            }
        }
    }

    private func makeRoundButton(_ item: Item) -> UIButton {
        var config = Self.glassConfiguration()
        config.image = UIImage(systemName: item.symbol,
                               withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .medium))
        config.baseForegroundColor = .label
        config.contentInsets = .zero
        let button = UIButton(configuration: config)
        button.accessibilityLabel = item.label
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        button.addAction(UIAction { [weak self] _ in self?.tap(item.id) }, for: .touchUpInside)

        if item.badge > 0 {
            let badge = UILabel()
            badge.text = item.badge > 99 ? "99+" : String(item.badge)
            badge.font = .systemFont(ofSize: 11, weight: .bold)
            badge.textColor = .white
            badge.textAlignment = .center
            badge.backgroundColor = .systemRed
            badge.layer.cornerRadius = 9
            badge.layer.masksToBounds = true
            badge.translatesAutoresizingMaskIntoConstraints = false
            badge.isUserInteractionEnabled = false
            button.addSubview(badge)
            NSLayoutConstraint.activate([
                badge.heightAnchor.constraint(equalToConstant: 18),
                badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 18),
                badge.topAnchor.constraint(equalTo: button.topAnchor, constant: -2),
                badge.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: 2),
            ])
        }
        return button
    }

    private func tap(_ id: String) {
        UISelectionFeedbackGenerator().selectionChanged()
        onTap?(id)
    }

    /// Web の画面と一緒に上へ流す (Web のボタンはページと一緒に動くため。重ならないように)
    func follow(scrollOffset y: CGFloat) {
        let shift = CGAffineTransform(translationX: 0, y: -max(0, y))
        backButton.transform = shift
        rightStack.transform = shift
    }

    func setVisible(_ visible: Bool, animated: Bool) {
        guard visible != self.visible || !animated else { return }
        self.visible = visible
        let views: [UIView] = [backButton, rightStack]
        let changes = { views.forEach { $0.alpha = visible ? 1 : 0 } }
        views.forEach { $0.isUserInteractionEnabled = visible }
        if animated {
            UIView.animate(withDuration: 0.22, delay: 0, options: [.beginFromCurrentState, .curveEaseOut],
                           animations: changes)
        } else {
            changes()
        }
    }
}
