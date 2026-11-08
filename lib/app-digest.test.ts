import assert from "node:assert/strict";
import { test } from "node:test";

import { DIGEST_DAYS, buildAppDigest, notificationId } from "./app-digest";
import type { MyEvent } from "./types";

function event(partial: Partial<MyEvent> & Pick<MyEvent, "kind" | "date">): MyEvent {
  return {
    sourceId: `${partial.kind}-${partial.date}-${partial.startTime ?? ""}`,
    sourceIds: [],
    startTime: "18:00",
    endTime: "20:00",
    title: "BREAK 公式練",
    location: "控室136",
    numberId: null,
    genreCode: null,
    ...partial,
  };
}

const TODAY = "2026-11-08";

test("14日ぶんの日を並べ、その日の予定を時刻順に入れる", () => {
  const digest = buildAppDigest(
    [
      event({ kind: "genre", date: "2026-11-09", startTime: "20:00", endTime: "22:00" }),
      event({ kind: "number", date: "2026-11-09", startTime: "10:00", endTime: "12:00", title: "ナンバー練" }),
    ],
    TODAY,
    `${TODAY}T08:00`,
  );
  assert.equal(digest.days.length, DIGEST_DAYS);
  assert.equal(digest.days[0].date, TODAY);
  assert.deepEqual(
    digest.days[1].items.map((item) => item.start),
    ["10:00", "20:00"],
  );
});

test("予定のある日の朝7時に「今日の予定」を予約し、過ぎた時刻は作らない", () => {
  const digest = buildAppDigest(
    [
      event({ kind: "genre", date: TODAY }),
      event({ kind: "genre", date: "2026-11-10" }),
    ],
    TODAY,
    `${TODAY}T08:00`,
  );
  const reminders = digest.notifications.filter((n) => n.category === "reminder");
  assert.deepEqual(
    reminders.map((n) => n.at),
    ["2026-11-10T07:00:00+09:00"],
  );
  assert.equal(reminders[0].path, "/?date=2026-11-10");
});

test("締切は当日と、大事なものは1週間前にも知らせる", () => {
  const digest = buildAppDigest(
    [
      event({
        kind: "deadline",
        date: "2026-11-16",
        title: "締切: 合宿費の集金",
        allDay: true,
        important: true,
        dueTime: null,
      }),
    ],
    TODAY,
    `${TODAY}T06:00`,
  );
  const deadline = digest.notifications.filter((n) => n.category === "deadline");
  assert.deepEqual(
    deadline.map((n) => [n.at.slice(0, 10), n.title, n.body]),
    [
      ["2026-11-09", "1週間後に締切 11/16(月)", "合宿費の集金"],
      ["2026-11-16", "今日締切", "合宿費の集金"],
    ],
  );
});

test("通知の ID は同じ tag なら同じ正の整数", () => {
  assert.equal(notificationId("today-2026-11-09"), notificationId("today-2026-11-09"));
  assert.notEqual(notificationId("today-2026-11-09"), notificationId("today-2026-11-10"));
  assert.ok(notificationId("x") > 0 && notificationId("x") <= 0x7fffffff);
});
