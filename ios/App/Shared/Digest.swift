import Foundation

/// アプリとウィジェットで共有する「これからの予定」(SPEC.md §2.3.1 / v1.38)
///
/// 形は `GET /api/app/digest` (lib/app-digest.ts) の `days` と同じ。
/// アプリが App Group に書き、ウィジェットが読む。
struct Digest: Codable {
    struct Item: Codable, Hashable {
        let id: String
        let kind: String
        let date: String
        let start: String
        let end: String
        let allDay: Bool
        let title: String
        let location: String
        let important: Bool
    }

    struct Day: Codable {
        let date: String
        let items: [Item]
    }

    let today: String
    let days: [Day]
    /// アプリが受け取った時刻
    var savedAt: Date?
}

enum DigestStore {
    static let appGroup = "group.com.finalflash.ffcalendar"
    private static let key = "digest"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func save(_ digest: Digest) {
        var copy = digest
        copy.savedAt = Date()
        guard let data = try? JSONEncoder().encode(copy) else { return }
        defaults?.set(data, forKey: key)
    }

    static func load() -> Digest? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(Digest.self, from: data)
    }

    static func clear() {
        defaults?.removeObject(forKey: key)
    }
}

extension Digest.Item {
    /// 予定の始まりと終わり (日本時間)。"24:00" は翌日の 0:00
    func interval(calendar: Calendar = .tokyo) -> (start: Date, end: Date)? {
        guard let day = DateFormatter.ymd.date(from: date) else { return nil }
        let s = Self.minutes(start), e = Self.minutes(end)
        let startDate = day.addingTimeInterval(TimeInterval(s * 60))
        // 終わりが始まり以前なら日をまたぐ深夜練
        let endMinutes = e <= s && !allDay ? e + 24 * 60 : e
        return (startDate, day.addingTimeInterval(TimeInterval(endMinutes * 60)))
    }

    private static func minutes(_ hhmm: String) -> Int {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return 0 }
        return parts[0] * 60 + parts[1]
    }

    /// 表示用の時刻 ("18:00〜20:00" / "終日")
    var timeLabel: String {
        allDay ? "終日" : "\(start)〜\(end == "24:00" ? "24:00" : end)"
    }
}

extension Calendar {
    static let tokyo: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        calendar.locale = Locale(identifier: "ja_JP")
        return calendar
    }()
}

extension DateFormatter {
    static let ymd: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = .tokyo
        formatter.timeZone = Calendar.tokyo.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// "11/8(日)"
    static let dayLabel: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = .tokyo
        formatter.timeZone = Calendar.tokyo.timeZone
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M/d(E)"
        return formatter
    }()
}
