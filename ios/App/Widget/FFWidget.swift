import SwiftUI
import WidgetKit

/// ウィジェット (SPEC.md §2.3.1 / v1.38)
///
/// アプリが App Group に書いた「これからの予定」(Shared/Digest.swift) を出す。
/// ウィジェット自身はサーバーへ取りにいかない。
@main
struct FFWidgetBundle: WidgetBundle {
    var body: some Widget {
        ScheduleWidget()
    }
}

struct ScheduleWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ScheduleWidget", provider: Provider()) { entry in
            ScheduleView(entry: entry)
                .containerBackground(for: .widget) { Color("WidgetBackground") }
        }
        .configurationDisplayName("今日の予定")
        .description("今日と次の予定。大きいサイズは締切・日程調整・鍵も")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge,
            .accessoryRectangular, .accessoryInline, .accessoryCircular,
        ])
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let digest: Digest?

    /// この時刻の「今日」の、まだ終わっていない予定
    var todayRemaining: [Digest.Item] {
        let today = DateFormatter.ymd.string(from: date)
        return items(on: today).filter { item in
            guard let interval = item.interval() else { return true }
            return item.allDay || interval.end > date
        }
    }

    /// 今日の予定の数 (終わったものも含む)
    var todayCount: Int {
        items(on: DateFormatter.ymd.string(from: date)).count
    }

    /// いま進んでいる、または次に始まる時刻つきの予定 (今日に無ければ先の日から)
    var next: Digest.Item? {
        guard let digest else { return nil }
        let today = DateFormatter.ymd.string(from: date)
        for day in digest.days where day.date >= today {
            if let item = day.items.first(where: { item in
                guard !item.allDay, let interval = item.interval() else { return false }
                return interval.end > date
            }) {
                return item
            }
        }
        return nil
    }

    /// 中サイズの行: 今日の残り、続けて先の日の予定 (日が変わる所に日付の見出し)
    func upcomingRows(limit: Int) -> [(header: String?, item: Digest.Item)] {
        guard let digest else { return [] }
        let today = DateFormatter.ymd.string(from: date)
        var rows: [(header: String?, item: Digest.Item)] = []
        for item in todayRemaining where rows.count < limit {
            rows.append((nil, item))
        }
        for day in digest.days where day.date > today && rows.count < limit {
            for (index, item) in day.items.enumerated() where rows.count < limit {
                rows.append((index == 0 ? dayLabel(day.date) : nil, item))
            }
        }
        return rows
    }

    func items(on date: String) -> [Digest.Item] {
        digest?.days.first { $0.date == date }?.items ?? []
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), digest: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), digest: DigestStore.load() ?? (context.isPreview ? .sample : nil)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let now = Date()
        let digest = DigestStore.load()
        let calendar = Calendar.tokyo

        // 予定の始まりと終わり・日付の変わり目で表示を進める (2日ぶん)
        let horizon = calendar.date(byAdding: .day, value: 2, to: calendar.startOfDay(for: now))!
        var moments: Set<Date> = [now]
        for day in digest?.days ?? [] {
            for item in day.items {
                guard let interval = item.interval() else { continue }
                for moment in [interval.start, interval.end] where moment > now && moment < horizon {
                    moments.insert(moment)
                }
            }
        }
        var midnight = calendar.startOfDay(for: now)
        while let following = calendar.date(byAdding: .day, value: 1, to: midnight), following <= horizon {
            moments.insert(following)
            midnight = following
        }

        let entries = moments.sorted().prefix(60).map { Entry(date: $0, digest: digest) }
        completion(Timeline(entries: Array(entries), policy: .after(horizon)))
    }
}

// MARK: - Views

struct ScheduleView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        Group {
            switch family {
            case .accessoryInline: InlineView(entry: entry)
            case .accessoryCircular: CircularView(entry: entry)
            case .accessoryRectangular: RectangularView(entry: entry)
            case .systemMedium: MediumView(entry: entry)
            case .systemLarge, .systemExtraLarge: LargeView(entry: entry)
            default: SmallView(entry: entry)
            }
        }
        .widgetURL(openURL(for: entry))
    }

    private func openURL(for entry: Entry) -> URL? {
        let date = entry.next?.date ?? DateFormatter.ymd.string(from: entry.date)
        return URL(string: "ffcalendar://open?path=%2F%3Fdate%3D\(date)")
    }
}

private struct SmallView: View {
    let entry: Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Header(date: entry.date)
            Spacer(minLength: 0)
            if entry.digest == nil {
                EmptyMessage(text: "アプリを開いてログインしてください")
            } else if let item = entry.next {
                if item.date != DateFormatter.ymd.string(from: entry.date) {
                    Text(dayLabel(item.date))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                ItemBlock(item: item, now: entry.date, large: true)
            } else {
                EmptyMessage(text: "予定はありません")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct MediumView: View {
    let entry: Entry

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(DateFormatter.weekday.string(from: entry.date))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.red)
                    .widgetAccentable()
                Text(DateFormatter.dayNumber.string(from: entry.date))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                Spacer(minLength: 0)
                if entry.todayCount > 0 {
                    Text("今日 \(entry.todayCount)件")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 64, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                if entry.digest == nil {
                    EmptyMessage(text: "アプリを開いてログインしてください")
                } else {
                    let rows = entry.upcomingRows(limit: 3)
                    if rows.isEmpty {
                        EmptyMessage(text: "予定はありません")
                    } else {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            if let header = row.header {
                                Text(header)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            ItemRow(item: row.item, now: entry.date)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct RectangularView: View {
    let entry: Entry

    var body: some View {
        if let item = entry.next {
            VStack(alignment: .leading, spacing: 1) {
                Text(prefix(item) + item.timeLabel)
                    .font(.caption.weight(.semibold))
                    .widgetAccentable()
                Text(item.title)
                    .font(.headline)
                    .lineLimit(1)
                if !item.location.isEmpty {
                    Text(item.location).font(.caption).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(entry.digest == nil ? "ログインしてください" : "予定はありません")
                .font(.caption)
        }
    }

    private func prefix(_ item: Digest.Item) -> String {
        item.date == DateFormatter.ymd.string(from: entry.date) ? "" : dayLabel(item.date) + " "
    }
}

private struct InlineView: View {
    let entry: Entry

    var body: some View {
        if let item = entry.next {
            Text("\(item.start) \(item.title)")
        } else {
            Text("予定はありません")
        }
    }
}

private struct CircularView: View {
    let entry: Entry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(entry.todayCount)")
                    .font(.title2.weight(.bold))
                    .widgetAccentable()
                Text("今日").font(.caption2)
            }
        }
    }
}


/// 大きいサイズ (v1.41)。ホームの要約: 今日の残り・次の日・近い締切・日程調整・鍵
private struct LargeView: View {
    let entry: Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(DateFormatter.dayLabel.string(from: entry.date))
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.red)
                    .widgetAccentable()
                Spacer()
                if entry.todayCount > 0 {
                    Text("今日 \(entry.todayCount)件")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if entry.digest == nil {
                Spacer()
                EmptyMessage(text: "アプリを開いてログインしてください")
                Spacer()
            } else {
                Section(title: "これから") {
                    let rows = entry.upcomingRows(limit: 4)
                    if rows.isEmpty {
                        EmptyMessage(text: "予定はありません")
                    } else {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            if let header = row.header {
                                Text(header)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            ItemRow(item: row.item, now: entry.date)
                        }
                    }
                }

                if let deadlines = entry.digest?.dashboard?.deadlines, !deadlines.isEmpty {
                    Section(title: "近い締切") {
                        ForEach(deadlines.prefix(2), id: \.self) { deadline in
                            HStack(spacing: 6) {
                                Text(daysLeft(deadline.date, from: entry.date))
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(.red)
                                    .frame(width: 44, alignment: .leading)
                                    .widgetAccentable()
                                Text(deadline.title)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                if deadline.important {
                                    Text("大事")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(.red)
                                }
                            }
                        }
                    }
                }

                Spacer(minLength: 0)

                HStack(spacing: 8) {
                    if let round = entry.digest?.dashboard?.round {
                        Chip(symbol: "calendar.badge.checkmark",
                             text: "\(round.title) \(daysLeft(round.deadline, from: entry.date))")
                    }
                    if let keys = entry.digest?.dashboard?.keys {
                        Chip(symbol: "key.fill", text: keysText(keys))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func keysText(_ keys: Digest.Dashboard.Keys) -> String {
        var text = "開錠 \(keys.unlocked)部屋"
        if let holder = keys.holder { text += "・部室 \(holder)" }
        if let saved = entry.digest?.savedAt {
            text += " (\(DateFormatter.hourMinute.string(from: saved))時点)"
        }
        return text
    }
}

private struct Section<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            content
        }
    }
}

private struct Chip: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.caption2)
            Text(text).font(.caption2.weight(.medium)).lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(.fill.tertiary, in: Capsule())
    }
}

/// "今日" / "明日" / "あと5日"
private func daysLeft(_ ymd: String, from now: Date) -> String {
    guard let date = DateFormatter.ymd.date(from: ymd) else { return "" }
    let calendar = Calendar.tokyo
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: date).day ?? 0
    switch days {
    case ..<1: return "今日"
    case 1: return "明日"
    default: return "あと\(days)日"
    }
}

// MARK: - Parts

private struct Header: View {
    let date: Date

    var body: some View {
        HStack(spacing: 4) {
            Text(DateFormatter.dayLabel.string(from: date))
                .font(.caption.weight(.bold))
                .foregroundStyle(.red)
                .widgetAccentable()
            Spacer(minLength: 0)
            Image(systemName: "calendar")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ItemBlock: View {
    let item: Digest.Item
    let now: Date
    let large: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            KindBar(kind: item.kind)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(large ? .subheadline.weight(.bold) : .caption.weight(.semibold))
                    .lineLimit(2)
                Text(item.timeLabel)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                if !item.location.isEmpty {
                    Text(item.location)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        // 色の帯を文字の高さで止める (伸ばすとウィジェットの下まで届く)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ItemRow: View {
    let item: Digest.Item
    let now: Date

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            KindBar(kind: item.kind).frame(height: 14)
            Text(item.allDay ? "終日" : item.start)
                .font(.caption.monospacedDigit().weight(.semibold))
                .frame(width: 38, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                Text(item.title).font(.caption.weight(.semibold)).lineLimit(1)
                if !item.location.isEmpty {
                    Text(item.location).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
    }
}

private struct KindBar: View {
    let kind: String

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(color)
            .frame(width: 4)
            .widgetAccentable()
    }

    private var color: Color {
        switch kind {
        case "genre", "studio": return .orange
        case "number": return .purple
        case "event": return .blue
        case "deadline": return .red
        default: return .gray
        }
    }
}

private struct EmptyMessage: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
    }
}

private func dayLabel(_ ymd: String) -> String {
    guard let date = DateFormatter.ymd.date(from: ymd) else { return ymd }
    return DateFormatter.dayLabel.string(from: date)
}

private extension DateFormatter {
    static let weekday: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = .tokyo
        formatter.timeZone = Calendar.tokyo.timeZone
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "EEEE"
        return formatter
    }()

    static let hourMinute: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = .tokyo
        formatter.timeZone = Calendar.tokyo.timeZone
        formatter.dateFormat = "H:mm"
        return formatter
    }()

    static let dayNumber: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = .tokyo
        formatter.timeZone = Calendar.tokyo.timeZone
        formatter.dateFormat = "d"
        return formatter
    }()
}

private extension Digest {
    static var sample: Digest {
        let today = DateFormatter.ymd.string(from: Date())
        return Digest(
            today: today,
            days: [
                Day(date: today, items: [
                    Item(id: "1", kind: "genre", date: today, start: "18:00", end: "20:00", allDay: false,
                         title: "BREAK 公式練", location: "控室136", important: false),
                    Item(id: "2", kind: "number", date: today, start: "20:30", end: "22:00", allDay: false,
                         title: "秋ナンバー", location: "アリーナB", important: false),
                ]),
            ],
            dashboard: Dashboard(
                round: Dashboard.Round(title: "1月の日程調整", deadline: today),
                keys: Dashboard.Keys(unlocked: 1, holder: "22BREAKたろう"),
                deadlines: [Dashboard.Deadline(title: "合宿費の集金", date: today, dueTime: nil, important: true)]
            ),
            savedAt: nil
        )
    }
}
