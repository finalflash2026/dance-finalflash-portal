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

/// 小 (v1.42): 次の予定を1枚の色の面で大きく
private struct SmallView: View {
    let entry: Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(date: entry.date, count: entry.todayCount)
            if entry.digest == nil {
                Spacer(minLength: 0)
                EmptyMessage(text: "アプリを開いてログインしてください")
                Spacer(minLength: 0)
            } else if let item = entry.next {
                NextCard(item: item, now: entry.date, compact: true)
            } else {
                Spacer(minLength: 0)
                DoneMessage()
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// 中 (v1.42): 左に次の予定、右に締切と鍵
private struct MediumView: View {
    let entry: Entry

    var body: some View {
        if entry.digest == nil {
            EmptyMessage(text: "アプリを開いてログインしてください")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 8) {
                    Header(date: entry.date, count: entry.todayCount)
                    if let item = entry.next {
                        NextCard(item: item, now: entry.date, compact: true)
                    } else {
                        Spacer(minLength: 0)
                        DoneMessage()
                        Spacer(minLength: 0)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)

                VStack(spacing: 8) {
                    DeadlineTile(entry: entry)
                    if let keys = entry.digest?.dashboard?.keys {
                        KeysTile(keys: keys)
                    } else if let round = entry.digest?.dashboard?.round {
                        RoundTile(round: round, now: entry.date)
                    }
                }
                .frame(width: 112)
            }
        }
    }
}

/// 大 (v1.42): ホームの要約。次の予定を大きく、締切・鍵・日程調整を色の面で、このあとの予定
private struct LargeView: View {
    let entry: Entry

    var body: some View {
        if entry.digest == nil {
            EmptyMessage(text: "アプリを開いてログインしてください")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Header(date: entry.date, count: entry.todayCount)

                if let item = entry.next {
                    NextCard(item: item, now: entry.date, compact: false)
                } else {
                    DoneMessage().frame(maxWidth: .infinity, minHeight: 80)
                }

                HStack(spacing: 8) {
                    DeadlineTile(entry: entry)
                    if let keys = entry.digest?.dashboard?.keys { KeysTile(keys: keys) }
                    if let round = entry.digest?.dashboard?.round { RoundTile(round: round, now: entry.date) }
                }
                .frame(height: 74)

                let later = laterRows()
                if !later.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("このあと")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(Array(later.enumerated()), id: \.offset) { _, row in
                            LaterRow(item: row.item, header: row.header)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    /// 次の予定 (上の大きい面) より後の予定を3件
    private func laterRows() -> [(header: String?, item: Digest.Item)] {
        let rows = entry.upcomingRows(limit: 6)
        guard let next = entry.next, let index = rows.firstIndex(where: { $0.item == next }) else {
            return Array(rows.prefix(3))
        }
        var rest = Array(rows.dropFirst(index + 1).prefix(3))
        // 日の見出しが次の予定の側にあった場合は付け直す
        if let first = rest.first, first.header == nil, first.item.date != DateFormatter.ymd.string(from: entry.date),
           first.item.date != next.date {
            rest[0] = (dayLabel(first.item.date), first.item)
        }
        return rest
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
// MARK: - Parts

private func kindColor(_ kind: String) -> Color {
    switch kind {
    case "genre", "studio": return .orange
    case "number": return .purple
    case "event": return .blue
    case "deadline": return .red
    default: return .gray
    }
}

private struct Header: View {
    let date: Date
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(DateFormatter.dayLabel.string(from: date))
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.red)
                .widgetAccentable()
            Spacer(minLength: 0)
            if count > 0 {
                Text("今日 \(count)件")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// 次の予定の大きな面。種類の色を薄く敷き、左に色の帯
private struct NextCard: View {
    let item: Digest.Item
    let now: Date
    let compact: Bool

    var body: some View {
        let color = kindColor(item.kind)
        VStack(alignment: .leading, spacing: compact ? 3 : 5) {
            status
                .font(.caption2.weight(.semibold))
                .foregroundStyle(color)
                .widgetAccentable()
            Text(item.allDay ? "終日" : item.start)
                .font(.system(size: compact ? 24 : 32, weight: .bold, design: .rounded).monospacedDigit())
                .minimumScaleFactor(0.7)
            Text(item.title)
                .font(compact ? .footnote.weight(.semibold) : .headline)
                .lineLimit(compact ? 2 : 1)
            if !item.location.isEmpty {
                Label(item.location, systemImage: "mappin.and.ellipse")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(compact ? 10 : 14)
        .frame(maxWidth: .infinity, maxHeight: compact ? .infinity : nil, alignment: .topLeading)
        .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, style: .continuous)
                .fill(color)
                .frame(width: 4)
                .widgetAccentable()
        }
    }

    /// 「あと1:20」「〜21:30 まで」「明日」など。残り時間は OS が数え続ける
    @ViewBuilder private var status: some View {
        let today = DateFormatter.ymd.string(from: now)
        if item.date != today {
            Text(dayLabel(item.date))
        } else if item.allDay {
            Text("今日")
        } else if let interval = item.interval() {
            if interval.start <= now {
                Text("進行中・\(item.end)まで")
            } else {
                HStack(spacing: 2) {
                    Text("あと")
                    Text(interval.start, style: .relative)
                }
            }
        }
    }
}

/// 色の付いた小さな面。数字を大きく
private struct StatTile: View {
    let symbol: String
    let color: Color
    let value: String
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Image(systemName: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
                .widgetAccentable()
            Spacer(minLength: 0)
            Text(value)
                .font(.system(.title3, design: .rounded).weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(caption)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct DeadlineTile: View {
    let entry: Entry

    var body: some View {
        if let first = entry.digest?.dashboard?.deadlines.first {
            StatTile(symbol: "flag.fill", color: .red,
                     value: daysLeft(first.date, from: entry.date), caption: first.title)
        } else {
            StatTile(symbol: "flag", color: .gray, value: "なし", caption: "近い締切")
        }
    }
}

private struct KeysTile: View {
    let keys: Digest.Dashboard.Keys

    var body: some View {
        StatTile(symbol: "key.fill", color: keys.unlocked > 0 ? .green : .gray,
                 value: "\(keys.unlocked)部屋", caption: keys.unlocked > 0 ? "開錠中" : "施錠中")
    }
}

private struct RoundTile: View {
    let round: Digest.Dashboard.Round
    let now: Date

    var body: some View {
        StatTile(symbol: "calendar.badge.checkmark", color: .blue,
                 value: daysLeft(round.deadline, from: now), caption: round.title)
    }
}

private struct LaterRow: View {
    let item: Digest.Item
    let header: String?

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(kindColor(item.kind)).frame(width: 7, height: 7).widgetAccentable()
            Text(item.allDay ? "終日" : item.start)
                .font(.caption.monospacedDigit().weight(.semibold))
                .frame(width: 40, alignment: .leading)
            Text(item.title).font(.caption).lineLimit(1)
            Spacer(minLength: 4)
            if let header {
                Text(header).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

private struct DoneMessage: View {
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "checkmark.circle")
                .font(.title3)
                .foregroundStyle(.green)
            Text("このあとの予定はありません")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
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
