import UIKit

/// 下のタブバー (SPEC.md §2.3.1 / v1.38)
///
/// iOS 26 以降は Liquid Glass (`UIGlassEffect`)、それより前はすりガラス。
/// 形・幅・位置は Web のタブバー (components/TabBar.tsx) に揃える:
/// 画面から浮いた島型で、幅 260pt まで、ホームバーの上 10pt。
/// 何を出すかは Web が `FFNative.setTabBar` で決める。
final class GlassTabBar: UIView {
    struct Tab: Equatable {
        let id: String
        let label: String
        let symbol: String
    }

    var onSelect: ((Tab) -> Void)?

    private let background: UIVisualEffectView
    private let pill: UIVisualEffectView
    private let stack = UIStackView()
    private var tabs: [Tab] = []
    private var buttons: [UIButton] = []
    private var selectedIndex = 0
    private var accent: UIColor = .label
    private var accentForeground: UIColor = .systemBackground
    private let feedback = UISelectionFeedbackGenerator()

    static let height: CGFloat = 52
    static let maxWidth: CGFloat = 260

    override init(frame: CGRect) {
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = true
            background = UIVisualEffectView(effect: glass)
            pill = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
        } else {
            background = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
            pill = UIVisualEffectView(effect: nil)
        }
        super.init(frame: frame)

        background.translatesAutoresizingMaskIntoConstraints = false
        addSubview(background)
        NSLayoutConstraint.activate([
            background.topAnchor.constraint(equalTo: topAnchor),
            background.bottomAnchor.constraint(equalTo: bottomAnchor),
            background.leadingAnchor.constraint(equalTo: leadingAnchor),
            background.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])

        background.contentView.addSubview(pill)

        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        background.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: background.contentView.topAnchor, constant: 4),
            stack.bottomAnchor.constraint(equalTo: background.contentView.bottomAnchor, constant: -4),
            stack.leadingAnchor.constraint(equalTo: background.contentView.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: background.contentView.trailingAnchor, constant: -4),
        ])

        applyCapsule(background)
        applyCapsule(pill)
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.18
        layer.shadowRadius = 14
        layer.shadowOffset = CGSize(width: 0, height: 6)

        accessibilityTraits = .tabBar
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func applyCapsule(_ view: UIView) {
        if #available(iOS 26.0, *) {
            view.cornerConfiguration = .capsule()
        } else {
            view.layer.cornerCurve = .continuous
            view.clipsToBounds = true
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if #unavailable(iOS 26.0) {
            background.layer.cornerRadius = bounds.height / 2
        }
        layer.shadowPath = UIBezierPath(
            roundedRect: bounds, cornerRadius: bounds.height / 2
        ).cgPath
        movePill(animated: false)
    }

    /// Web からの指示を反映する
    func update(tabs newTabs: [Tab], selectedId: String?, accent: UIColor?, accentForeground: UIColor?, dark: Bool) {
        overrideUserInterfaceStyle = dark ? .dark : .light
        if let accent { self.accent = accent }
        if let accentForeground { self.accentForeground = accentForeground }
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.tintColor = self.accent
            pill.effect = glass
        } else {
            pill.backgroundColor = self.accent
        }

        if newTabs != tabs {
            tabs = newTabs
            rebuildButtons()
        }
        let index = tabs.firstIndex { $0.id == selectedId } ?? 0
        let changed = index != selectedIndex
        selectedIndex = index
        refreshButtonColors()
        layoutIfNeeded()
        movePill(animated: changed)
    }

    private func rebuildButtons() {
        buttons.forEach { $0.removeFromSuperview() }
        buttons = tabs.enumerated().map { index, tab in
            var config = UIButton.Configuration.plain()
            config.image = UIImage(systemName: tab.symbol)
            config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
            config.imagePadding = 6
            var title = AttributedString(tab.label)
            title.font = .systemFont(ofSize: 13, weight: .semibold)
            config.attributedTitle = title
            config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 8)
            let button = UIButton(configuration: config)
            button.tag = index
            button.accessibilityLabel = tab.label
            button.accessibilityTraits = .button
            button.addTarget(self, action: #selector(tapped(_:)), for: .touchUpInside)
            stack.addArrangedSubview(button)
            return button
        }
    }

    private func refreshButtonColors() {
        for (index, button) in buttons.enumerated() {
            let selected = index == selectedIndex
            button.configuration?.baseForegroundColor = selected ? accentForeground : .secondaryLabel
            button.accessibilityTraits = selected ? [.button, .selected] : .button
        }
    }

    private func movePill(animated: Bool) {
        guard buttons.indices.contains(selectedIndex) else {
            pill.isHidden = true
            return
        }
        pill.isHidden = false
        let target = buttons[selectedIndex].convert(buttons[selectedIndex].bounds, to: background.contentView)
        let apply = {
            self.pill.frame = target
            if #unavailable(iOS 26.0) { self.pill.layer.cornerRadius = target.height / 2 }
        }
        if animated {
            UIView.animate(
                withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.78,
                initialSpringVelocity: 0.4, options: [.beginFromCurrentState, .allowUserInteraction],
                animations: apply
            )
        } else {
            apply()
        }
    }

    @objc private func tapped(_ sender: UIButton) {
        guard tabs.indices.contains(sender.tag) else { return }
        feedback.selectionChanged()
        if sender.tag != selectedIndex {
            selectedIndex = sender.tag
            refreshButtonColors()
            movePill(animated: true)
        }
        onSelect?(tabs[sender.tag])
    }

    /// 出し入れ (タブの画面でだけ出す。§2.3.1)
    func setVisible(_ visible: Bool, animated: Bool) {
        let changes = {
            self.alpha = visible ? 1 : 0
            self.transform = visible ? .identity : CGAffineTransform(translationX: 0, y: 24).scaledBy(x: 0.92, y: 0.92)
        }
        isUserInteractionEnabled = visible
        if animated {
            UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.85,
                           initialSpringVelocity: 0, options: [.beginFromCurrentState], animations: changes)
        } else {
            changes()
        }
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
