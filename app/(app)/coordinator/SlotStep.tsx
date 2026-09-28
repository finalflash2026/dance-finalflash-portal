"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorMessage, buttonClass, secondaryButtonClass } from "@/components/ui";
import { useRoomById, useRooms } from "@/lib/rooms";
import { GENRES, GENRE_BY_ID, PRACTICE_WEEKDAYS } from "@/lib/constants";
import { findSplitReservations } from "@/lib/reservations";
import {
  cellKey,
  nextPeriod,
  practiceDatesOfMonth,
  renumber,
} from "@/lib/slot-grid";
import {
  SLOT_PRESET_MINUTES,
  SLOT_STATUS_LABELS,
  applySlotPreset,
  deriveMonthGenerations,
  generationsKey,
  invalidatedClaims,
  validateSlot,
  type SlotClaimInfo,
  type SlotDraft,
  type SlotInfo,
} from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import {
  finalizeTimeInput,
  formatDateLabel,
  formatTimeRange,
  getWeekday,
  normalizeTimeInput,
  startOfMonth,
  toMinutes,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

import { MonthNav } from "./MonthNav";
import { PeriodPanel } from "./PeriodPanel";
import {
  SlotGrid,
  type Brush,
  type PaintTarget,
  type PeriodEdit,
} from "./SlotGrid";
import { SlotTimeline } from "./SlotTimeline";
import {
  useMonthReservations,
  type ReservationInfo,
} from "./useMonthReservations";
import { useSlotPeriods } from "./useSlotPeriods";

/**
 * Step2: コマ割りエディタ (SPEC.md §6.2 Step2 / v1.9)
 *
 * 予約枠(第1層)を公式練・空き・使用不可のコマ(第2層)に割る。
 *
 * 表示は2つ (v1.28):
 *   **表** … 折衝係が Excel で作っているコマ割り表と同じ形 (SlotGrid)。
 *            列=練習場所 / 行=日にち×コマ。普段はこちらで進める。
 *   タイムライン … 縦=日付×部屋 / 横=時刻 (SlotTimeline)。
 *            基準のコマに合わない半端な時間のコマは、表では扱えないのでこちら。
 *
 * 書き込みはブラウザから RLS 経由で直接行う (mod_slots が coordinator 以上を
 * 許可しているため)。検証は lib/slots.ts と DB の制約の二段構え。
 */

export function SlotStep() {
  const roomById = useRoomById();
  const [month, setMonth] = useState<DateString>(() =>
    startOfMonth(todayInTokyo()),
  );
  const {
    reservations,
    generations,
    loading,
    error,
    reload,
    setError,
    applySlot,
    dropSlot,
  } = useMonthReservations(month);
  const rooms = useRooms();
  const periods = useSlotPeriods(month);
  const sectionNames = useMemo(
    () => [...new Set(rooms.map((room) => room.section))],
    [rooms],
  );
  const [view, setView] = useState<"grid" | "timeline">("grid");
  /** 同じセルへの二重書き込みを止める。連打すると重なり制約に当たるため */
  const painting = useRef(new Set<string>());
  const [editing, setEditing] = useState<{
    reservation: ReservationInfo;
    draft: SlotDraft;
    /** 新規作成時に押した未割当区間。時刻欄は空で開くので、
     *  プリセットの起点と「この範囲で入力してください」の案内に使う */
    gap: { startTime: string; endTime: string };
  } | null>(null);
  const [pending, setPending] = useState(false);

  // 公式練は月・水・木にしか入らないので既定でその3曜日だけ出す。
  // ただし他の曜日の枠にも「空き」コマを置きたい場合があるため隠しきらない
  const [practiceDaysOnly, setPracticeDaysOnly] = useState(true);
  const visibleReservations = practiceDaysOnly
    ? reservations.filter((r) => PRACTICE_WEEKDAYS.includes(getWeekday(r.date)))
    : reservations;
  const hiddenCount = reservations.length - visibleReservations.length;

  /**
   * 表の行になる日にち。
   *
   * 月・水・木は**予約が無くても出す** — Excel でも空の列を残しておき、
   * 「この日は取れなかった」ことが見えるようにしているため。
   * 「すべての曜日」では、それに加えて予約のある日を足す
   * (予約が無い日にコマは作れないので、空の行を30日ぶん並べても意味がない)。
   */
  const gridDates = useMemo(() => {
    const practice = practiceDatesOfMonth(month, PRACTICE_WEEKDAYS);
    if (practiceDaysOnly) return practice;
    const withReservations = reservations.map((r) => r.date);
    return [...new Set([...practice, ...withReservations])].sort();
  }, [month, practiceDaysOnly, reservations]);

  /**
   * 時間がつながっているのに分かれている予約枠 (v1.29.1)。
   *
   * 施設の予約ページが続きの枠を別行で出すことがあり、そのまま取り込むと
   * **境目をまたぐコマを置けなくなる** (どちらの枠にも収まらないため)。
   * 取込時にはまとめるようにしたが、既に入っているものはここから直す。
   */
  const splitGroups = useMemo(
    () => findSplitReservations(reservations),
    [reservations],
  );

  const derived = deriveMonthGenerations(
    reservations.flatMap((r) => r.slots),
  );
  const [monthGenerations, setMonthGenerations] = useState<number[] | null>(
    null,
  );

  // 月を切り替えたときと、保存後の再読込のたびに DB の値へ揃える。
  // 画面の選択が DB と食い違ったまま新規コマに使われるのを防ぐ
  const derivedKey = `${month}|${generationsKey(derived.value)}|${derived.mixed}`;
  useEffect(() => {
    setMonthGenerations(derived.value);
    // derivedKey に derived.value の内容が畳み込まれている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedKey]);

  const supabase = createClient();

  /**
   * この月の対象期を変える (SPEC §6.2 Step2-2 / v1.9)。
   * **その月の公式練コマすべてに即時反映する。** 対象期は月単位で決まるため。
   */
  async function toggleMonthGeneration(generation: number) {
    const current = monthGenerations ?? [];
    const next = current.includes(generation)
      ? current.filter((g) => g !== generation)
      : [...current, generation].sort((a, b) => b - a);
    const value = next.length > 0 ? next : null;

    setMonthGenerations(value);

    const ids = reservations
      .flatMap((r) => r.slots)
      .filter((s) => s.status === "genre")
      .map((s) => s.id);
    if (ids.length === 0) return; // まだコマが無い月。新規作成時に使われる

    setPending(true);
    setError(null);
    const { error: writeError } = await supabase
      .from("slots")
      .update({ target_generations: value })
      .in("id", ids);
    setPending(false);

    if (writeError) {
      setError(`対象期を保存できませんでした: ${writeError.message}`);
      return;
    }
    reload();
  }

  /**
   * 予約枠の取消 (SPEC §6.2 Step2-6 / v1.8.1)
   *
   * **コマを先に消してから status を変える。** 逆順だと、途中で失敗したときに
   * 「取消済なのに公開コマが残っている」= カレンダーに幽霊の練習が出続ける
   * 状態になる。コマを先に消せば、最悪でも「枠が active のまま」で済み、
   * もう一度取り消せば回復できる。
   */
  async function cancelReservation(reservation: ReservationInfo) {
    const claims = reservation.slots.flatMap((slot) => slot.claims);
    const lines = [
      `${formatDateLabel(reservation.date)} ${roomById.get(reservation.roomId)?.name ?? ""}`,
      `${formatTimeRange(reservation.startTime, reservation.endTime)} の予約枠を取り消します。`,
    ];
    if (reservation.slots.length > 0) {
      lines.push(`\nこの枠のコマ ${reservation.slots.length}件も削除されます。`);
    }
    if (claims.length > 0) {
      lines.push(
        `\n以下の空き申請も取り消されます。本人に連絡してください:\n${formatClaimList(claims)}`,
      );
    }
    if (!window.confirm(lines.join("\n"))) return;

    setPending(true);
    setError(null);

    const { error: slotsError } = await supabase
      .from("slots")
      .delete()
      .eq("reservation_id", reservation.id);
    if (slotsError) {
      setPending(false);
      setError(`コマを削除できませんでした: ${slotsError.message}`);
      return;
    }

    const { error: resvError } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", reservation.id);

    setPending(false);
    if (resvError) {
      setError(
        `予約枠を取り消せませんでした (コマは削除済みです): ${resvError.message}`,
      );
      return;
    }
    reload();
  }

  async function saveSlot(reservation: ReservationInfo, draft: SlotDraft) {
    const check = validateSlot(reservation, reservation.slots, draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    // 公開済の空きコマを変更するときは、成り立たなくなる申請を先に知らせる
    const existing = reservation.slots.find((s) => s.id === draft.id) ?? null;
    const doomed = existing
      ? invalidatedClaims(existing, {
          status: draft.status,
          startTime: draft.startTime,
          endTime: draft.endTime,
        })
      : [];
    if (doomed.length > 0 && !confirmClaimLoss(doomed)) return;

    setPending(true);
    setError(null);

    const payload = {
      start_time: draft.startTime,
      end_time: draft.endTime,
      status: draft.status,
      genre_id: draft.status === "genre" ? draft.genreId : null,
      // 対象期は月単位 (v1.9)。公式練にはこの月の設定を必ず入れ、
      // 公式練でなくなったら消す。コマ個別には選ばせない
      target_generations: draft.status === "genre" ? monthGenerations : null,
    };

    const { error: writeError } = draft.id
      ? await supabase.from("slots").update(payload).eq("id", draft.id)
      : await supabase.from("slots").insert({
          ...payload,
          reservation_id: reservation.id,
          // date / room_id は予約枠から複製する (slots は表示のため非正規化して持つ)
          date: reservation.date,
          room_id: reservation.roomId,
        });

    setPending(false);
    if (writeError) {
      setError(describeSlotError(writeError));
      return;
    }
    setEditing(null);
    reload();
  }

  async function deleteSlot(slot: SlotInfo) {
    const doomed = invalidatedClaims(slot, null);
    if (doomed.length > 0 && !confirmClaimLoss(doomed)) return;
    if (
      doomed.length === 0 &&
      !window.confirm(
        `${formatTimeRange(slot.startTime, slot.endTime)} のコマを削除しますか?`,
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    const { error: deleteError } = await supabase
      .from("slots")
      .delete()
      .eq("id", slot.id);
    setPending(false);

    if (deleteError) {
      setError(`コマを削除できませんでした: ${deleteError.message}`);
      return;
    }
    setEditing(null);
    reload();
  }

  /**
   * 分かれている予約枠を1本につなげる (v1.29.1)。
   *
   * **コマを先に移してから枠を消す。** `slots.reservation_id` は
   * `on delete cascade` なので、先に枠を消すとぶら下がっているコマと
   * 空き申請まで消える。
   */
  async function mergeSplitReservations() {
    const lines = splitGroups.map((group) => {
      const last = group.reduce(
        (latest, r) =>
          toMinutes(r.endTime) > toMinutes(latest) ? r.endTime : latest,
        group[0].endTime,
      );
      return `・${formatDateLabel(group[0].date)} ${roomById.get(group[0].roomId)?.name ?? ""} ${formatTimeRange(group[0].startTime, last)}`;
    });
    if (
      !window.confirm(
        `次の予約枠を1本につなげます。\n\n${lines.join("\n")}\n\n入っているコマと空き申請はそのまま残ります。`,
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);

    for (const group of splitGroups) {
      const sorted = [...group].sort(
        (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
      );
      const survivor = sorted[0];
      const others = sorted.slice(1);
      const endTime = sorted.reduce(
        (latest, r) =>
          toMinutes(r.endTime) > toMinutes(latest) ? r.endTime : latest,
        survivor.endTime,
      );
      const otherIds = others.map((r) => r.id);

      const { error: moveError } = await supabase
        .from("slots")
        .update({ reservation_id: survivor.id })
        .in("reservation_id", otherIds);
      if (moveError) {
        setPending(false);
        setError(`コマを移せませんでした: ${moveError.message}`);
        reload();
        return;
      }

      const { error: growError } = await supabase
        .from("reservations")
        .update({ end_time: endTime })
        .eq("id", survivor.id);
      if (growError) {
        setPending(false);
        setError(`予約枠を伸ばせませんでした: ${growError.message}`);
        reload();
        return;
      }

      const { error: dropError } = await supabase
        .from("reservations")
        .delete()
        .in("id", otherIds);
      if (dropError) {
        setPending(false);
        setError(
          `分かれていた枠を消せませんでした (つなぎ自体は済んでいます): ${dropError.message}`,
        );
        reload();
        return;
      }
    }

    setPending(false);
    reload();
  }

  /**
   * 表のセルを1つ書き換える (SPEC §6.2 Step2 / v1.28)。
   *
   * コマの時間は表の行が決めているので、時刻の入力は要らない。
   * **押した瞬間に保存する。** 1か月ぶんで数十セル触るので、
   * セルごとに窓を開いて「保存」を押させると手数が倍以上になる。
   *
   * 失敗したときだけ月ぶんを読み直す。成功時は手元の1コマだけ差し替える。
   */
  async function paint(targets: PaintTarget[], brush: Brush) {
    // 横に結合したセルは複数の部屋を指す。**順に片付ける** —
    // 同時に投げると、失敗したときにどこまで進んだのか分からなくなる
    for (const target of targets) {
      await paintOne(target, brush);
    }
  }

  /**
   * 区切りの合わない古いコマを片付ける (v1.29.2)。
   *
   * コマの時間を後から変えると必ず出る。**黙って消さない** —
   * 中身は折衝係が置いた公式練で、空き申請がぶら下がっていることもある。
   */
  async function clearLeftovers(
    leftovers: SlotInfo[],
    key: string,
  ): Promise<boolean> {
    if (leftovers.length === 0) return true;

    const claims = leftovers.flatMap((slot) => slot.claims);
    const lines = leftovers.map((slot) => `・${describeSlot(slot)}`).join("\n");
    const message =
      claims.length > 0
        ? `この時間には区切りの合わない古いコマが${leftovers.length}件あります。\n\n${lines}\n\n置き換えると次の空き申請も取り消されます。本人に連絡してください:\n${formatClaimList(claims)}`
        : `この時間には区切りの合わない古いコマが${leftovers.length}件あります。\n\n${lines}\n\n消して置き換えますか?`;
    if (!window.confirm(message)) return false;

    painting.current.add(key);
    const { error: deleteError } = await supabase
      .from("slots")
      .delete()
      .in(
        "id",
        leftovers.map((slot) => slot.id),
      );
    painting.current.delete(key);

    if (deleteError) {
      setError(`古いコマを消せませんでした: ${deleteError.message}`);
      reload();
      return false;
    }
    setError(null);
    for (const slot of leftovers) dropSlot(slot.id);
    return true;
  }

  async function paintOne(target: PaintTarget, brush: Brush) {
    const { date, room, period, cell } = target;
    const key = cellKey(date, room.id, period.position);
    if (painting.current.has(key)) return;

    // 消す
    if (brush.kind === "clear") {
      // ぴったりのコマが無くても、重なっている古いコマがあれば片付ける
      if (!cell.slot) {
        await clearLeftovers(cell.overlapping, key);
        return;
      }
      const doomed = invalidatedClaims(cell.slot, null);
      if (doomed.length > 0 && !confirmClaimLoss(doomed)) return;

      painting.current.add(key);
      const { error: deleteError } = await supabase
        .from("slots")
        .delete()
        .eq("id", cell.slot.id);
      painting.current.delete(key);

      if (deleteError) {
        setError(`コマを削除できませんでした: ${deleteError.message}`);
        reload();
        return;
      }
      setError(null);
      dropSlot(cell.slot.id);
      return;
    }

    const status: SlotStatus = brush.kind === "genre" ? "genre" : brush.kind;
    const genreId = brush.kind === "genre" ? brush.genreId : null;

    // 同じ内容なら触らない。塗り重ねても書き込みが走らないように
    if (
      cell.slot &&
      cell.slot.status === status &&
      cell.slot.genreId === genreId
    ) {
      return;
    }

    const payload = {
      start_time: period.startTime,
      end_time: period.endTime,
      status,
      genre_id: genreId,
      // 対象期は月単位 (v1.9)。公式練でなくなったら消す
      target_generations: status === "genre" ? monthGenerations : null,
    };

    if (cell.slot) {
      const doomed = invalidatedClaims(cell.slot, {
        status,
        startTime: period.startTime,
        endTime: period.endTime,
      });
      if (doomed.length > 0 && !confirmClaimLoss(doomed)) return;

      const slotId = cell.slot.id;
      const reservationId = reservations.find((r) =>
        r.slots.some((slot) => slot.id === slotId),
      )?.id;
      if (!reservationId) {
        reload();
        return;
      }

      painting.current.add(key);
      const { error: writeError } = await supabase
        .from("slots")
        .update(payload)
        .eq("id", slotId);
      painting.current.delete(key);

      if (writeError) {
        setError(describeSlotError(writeError));
        reload();
        return;
      }
      setError(null);
      applySlot(reservationId, {
        ...cell.slot,
        startTime: period.startTime,
        endTime: period.endTime,
        status,
        genreId,
        targetGenerations: payload.target_generations,
      });
      return;
    }

    if (!cell.reservationId) return; // 予約が無いセルは押せない

    // **重なっている古いコマを先に片付ける。** 残したまま insert すると
    // 排他制約に当たって「重なっています」とだけ言われ、何が邪魔なのか
    // 分からない (コマの時間を変えた月では必ず起きる)
    if (!(await clearLeftovers(cell.overlapping, key))) return;

    painting.current.add(key);
    const { data, error: writeError } = await supabase
      .from("slots")
      .insert({
        ...payload,
        reservation_id: cell.reservationId,
        // date / room_id は予約枠から複製する (slots は表示のため非正規化して持つ)
        date,
        room_id: room.id,
      })
      .select("id")
      .single();
    painting.current.delete(key);

    if (writeError || !data) {
      setError(
        writeError ? describeSlotError(writeError) : "コマを作れませんでした",
      );
      reload();
      return;
    }
    setError(null);
    applySlot(cell.reservationId, {
      id: (data as { id: string }).id,
      startTime: period.startTime,
      endTime: period.endTime,
      status,
      genreId,
      targetGenerations: payload.target_generations,
      published: false,
      claims: [],
    });
  }

  return (
    <div className="space-y-4">
      <MonthNav month={month} onChange={setMonth} disabled={pending} />

      <ViewToggle view={view} onChange={setView} disabled={pending} />

      <MonthGenerationPicker
        candidates={generations}
        value={monthGenerations}
        genreSlotCount={derived.count}
        mixed={derived.mixed}
        disabled={pending || loading}
        onToggle={toggleMonthGeneration}
      />

      <ErrorMessage>{error ?? periods.error}</ErrorMessage>

      <SplitReservationNotice
        groups={splitGroups}
        roomName={(roomId) => roomById.get(roomId)?.name ?? "?"}
        disabled={pending}
        onMerge={mergeSplitReservations}
      />

      <WeekdayFilter
        practiceDaysOnly={practiceDaysOnly}
        hiddenCount={hiddenCount}
        onChange={setPracticeDaysOnly}
        disabled={pending}
      />

      {view === "grid" ? (
        <>
          <PeriodPanel
            month={month}
            base={periods.table.base}
            snapshot={periods.snapshot}
            onChange={(base) =>
              periods.setTable((current) => ({ ...current, base }))
            }
            onSave={(base) => {
              void periods.saveBase(base);
            }}
            disabled={pending}
          />

          {reservations.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] px-4 py-3 text-center text-sm text-[var(--muted)]">
              {loading
                ? "読み込み中…"
                : "この月の予約枠はありません。①CSV取込 から登録すると ○ が付きます"}
            </p>
          ) : null}

          <SlotGrid
            dates={gridDates}
            rooms={rooms}
            table={periods.table}
            reservations={reservations}
            disabled={pending}
            onPaint={paint}
            onSavePeriods={(edits: PeriodEdit[]) => {
              void periods.saveOverrides(edits, periods.table.base);
            }}
            onChangeRowCount={(date, delta) => {
              void periods.changeRowCount(date, sectionNames, (list) =>
                delta > 0
                  ? [...list, nextPeriod(list)]
                  : renumber(list.slice(0, Math.max(list.length - 1, 1))),
              );
            }}
          />
        </>
      ) : /* 保存のたびに一覧が消えるとスクロール位置が飛ぶので、
            「読み込み中」に差し替えるのは月を切り替えた直後だけにする */
      visibleReservations.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          {loading
            ? "読み込み中…"
            : reservations.length > 0
              ? "月・水・木の予約枠はありません。他の曜日は「すべての曜日」で見られます"
              : "この月の予約枠はありません。①CSV取込 から登録してください"}
        </p>
      ) : (
        <>
          <SlotTimeline
            reservations={visibleReservations}
            disabled={pending}
            onSelectSlot={(reservation, slot) => {
              setError(null);
              setEditing({
                reservation,
                gap: { startTime: slot.startTime, endTime: slot.endTime },
                draft: {
                  id: slot.id,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  status: slot.status,
                  genreId: slot.genreId,
                },
              });
            }}
            onSelectGap={(reservation, gap) => {
              setError(null);
              setEditing({
                reservation,
                gap,
                // 時刻欄は空で開く。予約枠の時間が入ったままだと、
                // 打ち直すのに一度消す手間がかかるため
                draft: {
                  id: null,
                  startTime: "",
                  endTime: "",
                  status: "genre",
                  genreId: null,
                },
              });
            }}
            onCancelReservation={cancelReservation}
          />
          <Legend />
        </>
      )}

      {editing ? (
        <SlotEditor
          reservation={editing.reservation}
          initial={editing.draft}
          gap={editing.gap}
          monthGenerations={monthGenerations}
          disabled={pending}
          onSave={(draft) => saveSlot(editing.reservation, draft)}
          onDelete={() => {
            const slot = editing.reservation.slots.find(
              (s) => s.id === editing.draft.id,
            );
            if (slot) deleteSlot(slot);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 分かれている予約枠の知らせ (SPEC §6.2 Step2 / v1.29.1)
 *
 * **黙ってつながない。** 予約枠は「施設から借りた事実」で、勝手に形を
 * 変えてよいものではない。ただ、分かれたままだと境目をまたぐコマを
 * 置けないので、理由と直し方をその場に出す。
 */
function SplitReservationNotice({
  groups,
  roomName,
  disabled,
  onMerge,
}: {
  groups: ReservationInfo[][];
  roomName: (roomId: number) => string;
  disabled: boolean;
  onMerge: () => void;
}) {
  if (groups.length === 0) return null;

  return (
    <section className="space-y-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-fg)]">
      <p className="font-bold">
        時間がつながっているのに分かれている予約枠が {groups.length}件あります
      </p>
      <p>
        施設の予約ページが続きの枠を別の行で出すことがあります。
        このままだと<strong>境目をまたぐコマ (例 18:50〜20:00) を置けません</strong>
        (△ になります)。
      </p>
      <ul className="space-y-0.5">
        {groups.slice(0, 8).map((group, index) => (
          <li key={index}>
            {formatDateLabel(group[0].date)} {roomName(group[0].roomId)}{" "}
            {group
              .map((r) => formatTimeRange(r.startTime, r.endTime))
              .join(" + ")}
          </li>
        ))}
        {groups.length > 8 ? <li>…ほか {groups.length - 8}件</li> : null}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={onMerge}
        className="rounded-lg border border-[var(--danger-border)] bg-[var(--background)] px-3 py-1.5 font-bold disabled:opacity-50"
      >
        1本につなげる
      </button>
    </section>
  );
}

/**
 * 表示の切り替え (SPEC §6.2 Step2 / v1.28)
 *
 * 普段は**表**。折衝の手順そのものが「この表を埋める」作業なので、
 * 開いた直後からその形になっている必要がある。
 * タイムラインは、基準のコマに合わない時間のコマを直すときの逃げ道として残す。
 */
function ViewToggle({
  view,
  onChange,
  disabled,
}: {
  view: "grid" | "timeline";
  onChange: (view: "grid" | "timeline") => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      {(
        [
          { value: "grid", label: "表 (コマ割り)" },
          { value: "timeline", label: "タイムライン" },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          aria-pressed={view === option.value}
          className={`rounded-full border px-3 py-1 text-sm disabled:opacity-50 ${
            view === option.value
              ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
              : "border-[var(--border)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 曜日の絞り込み (SPEC §6.2 Step2-1 / v1.9.1)
 *
 * 公式練は月・水・木にしか入らないので既定でその3曜日だけ出す。
 * ただし**隠している件数を必ず出す**こと。金土日の予約枠にも「空き」コマを
 * 置いて個人練に開放できるので、「無い」のではなく「隠れている」と分かる
 * 必要がある。
 */
function WeekdayFilter({
  practiceDaysOnly,
  hiddenCount,
  onChange,
  disabled,
}: {
  practiceDaysOnly: boolean;
  hiddenCount: number;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          { value: true, label: "月・水・木" },
          { value: false, label: "すべての曜日" },
        ] as const
      ).map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          aria-pressed={practiceDaysOnly === option.value}
          className={`rounded-full border px-3 py-1 text-sm disabled:opacity-50 ${
            practiceDaysOnly === option.value
              ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
              : "border-[var(--border)]"
          }`}
        >
          {option.label}
        </button>
      ))}
      {practiceDaysOnly && hiddenCount > 0 ? (
        <span className="text-xs text-[var(--muted)]">
          他の曜日の予約枠 {hiddenCount}件を隠しています
        </span>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <p className="text-xs text-[var(--muted)]">
      ＋ の破線が未割当です。タップするとその時刻からコマを作れます。
      枠線が破線のブロックは下書き(未公開)です。●の数字は空き申請の件数、
      行末の ✕ は予約枠の取消です。
    </p>
  );
}

/**
 * この月の対象期 (SPEC §6.2 Step2-2 / v1.9)
 *
 * 選び直すとその月の公式練コマすべてに即時反映される。
 * 何件に効くのかを必ず出す (押してから気付くのでは遅いため)。
 */
function MonthGenerationPicker({
  candidates,
  value,
  genreSlotCount,
  mixed,
  disabled,
  onToggle,
}: {
  candidates: number[];
  value: number[] | null;
  genreSlotCount: number;
  mixed: boolean;
  disabled: boolean;
  onToggle: (generation: number) => void;
}) {
  const selected = value ?? [];

  return (
    <section className="space-y-2 rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">この月の対象期</h3>
        <span className="text-xs text-[var(--muted)]">
          {selected.length === 0 ? "全期" : `${selected.join("・")}期`}
        </span>
      </div>

      {candidates.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">登録者がいません</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidates.map((generation) => {
            const on = selected.includes(generation);
            return (
              <button
                key={generation}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(generation)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-sm disabled:opacity-50 ${
                  on
                    ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
                    : "border-[var(--border)]"
                }`}
              >
                {generation}期
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">
        未選択=全期。変更するとこの月の公式練コマ {genreSlotCount}件に
        すぐ反映され、新しく作るコマにも入ります。
      </p>

      {mixed ? (
        <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">
          この月にはコマごとに異なる対象期が設定されています。
          上で選び直すと全部が揃います。
        </p>
      ) : null}
    </section>
  );
}

/** 確認ダイアログに出すコマの説明。「18:50〜19:30 LOCK」 */
function describeSlot(slot: SlotInfo): string {
  const genre = slot.genreId != null ? GENRE_BY_ID.get(slot.genreId)?.code : null;
  return `${formatTimeRange(slot.startTime, slot.endTime)} ${genre ?? SLOT_STATUS_LABELS[slot.status]}`;
}

function formatClaimList(claims: SlotClaimInfo[]): string {
  return claims
    .map((c) => `・${c.username} ${formatTimeRange(c.startTime, c.endTime)}`)
    .join("\n");
}

/** SPEC §6.2 Step3: 続行時は申請者名を表示して手動連絡を促す */
function confirmClaimLoss(claims: SlotClaimInfo[]): boolean {
  return window.confirm(
    `この変更で次の空き申請が取り消されます。本人に連絡してください:\n\n${formatClaimList(claims)}`,
  );
}

/** DB 側の制約に当たったときに、原因の分かる日本語にする */
function describeSlotError(error: { code?: string; message: string }): string {
  if (error.code === "23P01") {
    return "同じ予約枠の中でコマの時間が重なっています。画面を再読み込みして確認してください";
  }
  if (error.code === "23514") {
    return "コマの内容が不正です (時刻の前後、または公式練のジャンル未設定)";
  }
  return `保存できませんでした: ${error.message}`;
}

function SlotEditor({
  reservation,
  initial,
  gap,
  monthGenerations,
  disabled,
  onSave,
  onDelete,
  onClose,
}: {
  reservation: ReservationInfo;
  initial: SlotDraft;
  /** 押した未割当区間 (既存コマの編集ならそのコマの範囲) */
  gap: { startTime: string; endTime: string };
  monthGenerations: number[] | null;
  disabled: boolean;
  onSave: (draft: SlotDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const roomById = useRoomById();
  const [draft, setDraft] = useState<SlotDraft>(initial);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const check = validateSlot(reservation, reservation.slots, draft);
  const cell =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--foreground)]";

  function applyPreset(minutes: number) {
    setDraft((prev) => ({
      ...prev,
      ...applySlotPreset(
        reservation,
        reservation.slots,
        prev,
        gap.startTime,
        minutes,
      ),
    }));
  }

  return (
    <div
      data-no-swipe
      className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-in safe-bottom relative z-10 max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-[var(--background)] p-4 sm:rounded-2xl"
      >
        <div>
          <h3 className="text-base font-bold">
            {draft.id ? "コマを編集" : "コマを作る"}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {formatDateLabel(reservation.date)}{" "}
            {roomById.get(reservation.roomId)?.name} / 予約枠{" "}
            {formatTimeRange(reservation.startTime, reservation.endTime)}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              aria-label="開始時刻"
              value={draft.startTime}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  startTime: normalizeTimeInput(e.target.value),
                }))
              }
              onBlur={(e) =>
                setDraft((p) => ({
                  ...p,
                  startTime: finalizeTimeInput(e.target.value),
                }))
              }
              className={cell}
            />
            <span className="text-sm">〜</span>
            <input
              aria-label="終了時刻"
              value={draft.endTime}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  endTime: normalizeTimeInput(e.target.value),
                }))
              }
              onBlur={(e) =>
                setDraft((p) => ({
                  ...p,
                  endTime: finalizeTimeInput(e.target.value),
                }))
              }
              className={cell}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {SLOT_PRESET_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={disabled}
                onClick={() => applyPreset(minutes)}
                className="rounded border border-[var(--border)] px-3 py-1 text-xs"
              >
                {minutes}分
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)]">
            {draft.id
              ? "数字だけでも入力できます (1700 → 17:00)"
              : `${formatTimeRange(gap.startTime, gap.endTime)} が空いています。プリセットを押すと ${gap.startTime} から入ります (1700 のように数字だけでも入力できます)`}
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">状態</p>
          <div className="flex gap-2">
            {(Object.keys(SLOT_STATUS_LABELS) as SlotStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                disabled={disabled}
                onClick={() => setDraft((p) => ({ ...p, status }))}
                aria-pressed={draft.status === status}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm ${
                  draft.status === status
                    ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
                    : "border-[var(--border)]"
                }`}
              >
                {SLOT_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        {draft.status === "genre" ? (
          <>
            <label className="block">
              <span className="text-sm font-medium">ジャンル</span>
              <select
                className={`${cell} mt-1`}
                value={draft.genreId ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    genreId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              >
                <option value="">選んでください</option>
                {GENRES.map((genre) => (
                  <option key={genre.id} value={genre.id}>
                    {genre.code}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-[var(--muted)]">
              対象期は{" "}
              <strong>
                {monthGenerations && monthGenerations.length > 0
                  ? `${monthGenerations.join("・")}期`
                  : "全期"}
              </strong>{" "}
              になります (この月の設定。変更は画面上部から)
            </p>
          </>
        ) : null}

        {/* 開いた直後の空欄で赤字を出さない。片方でも空なら「まだ入力途中」
            とみなし、両方埋まってから検証結果を見せる */}
        {draft.startTime.trim() && draft.endTime.trim() && !check.ok ? (
          <p role="alert" className="text-sm font-medium text-[var(--danger-fg)]">
            {check.message}
          </p>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            disabled={disabled || !check.ok}
            onClick={() => onSave(draft)}
            className={buttonClass}
          >
            保存する
          </button>
          {draft.id ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onDelete}
              className={`${secondaryButtonClass} text-[var(--danger-fg)]`}
            >
              このコマを削除する
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
