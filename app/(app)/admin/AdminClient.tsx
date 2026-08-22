"use client";

import Link from "next/link";
import { useState } from "react";

import { ErrorMessage, Field, inputClass, secondaryButtonClass } from "@/components/ui";
import { buildUsernameFromGenreId } from "@/lib/auth/username";
import { GENRES, GENRE_BY_ID, ROLE_LABELS } from "@/lib/constants";
import type { Role } from "@/lib/types";

/**
 * 管理者画面の操作部 (SPEC.md §6.5 / §6.5.1 / §3.6)
 *
 * 変更はすべて `/api/admin/**` (service role) 経由で行う。
 * profiles の role には RLS の更新ポリシーが無いため、ブラウザから直接は書けない。
 *
 * **保存しても一覧を引き直さない** (router.refresh を使わない)。
 * 数十人の一覧で開いた行と読んでいた位置が毎回先頭に戻るのは操作として苦しいので、
 * 返ってきた値で手元の行だけ差し替える。
 */

export interface AdminUser {
  userId: string;
  username: string;
  generation: number;
  mainGenreId: number;
  displayName: string;
  role: Role;
}

/** 在籍の絞り込み。既定は「現役のみ」(SPEC §3.6: 名簿検索の既定) */
type Enrollment = "active" | "ob" | "all";

const ENROLLMENT_LABELS: Record<Enrollment, string> = {
  active: "現役のみ",
  ob: "OBのみ",
  all: "全員",
};

export function AdminClient({
  currentUserId,
  initialUsers,
  loadError,
}: {
  currentUserId: string;
  initialUsers: AdminUser[];
  loadError: string | null;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [error, setError] = useState<string | null>(loadError);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState<number | null>(null);
  const [genreId, setGenreId] = useState<number | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment>("active");
  const [expanded, setExpanded] = useState<string | null>(null);

  const generations = [...new Set(users.map((u) => u.generation))].sort(
    (a, b) => b - a,
  );

  const filtered = users
    .filter((u) =>
      enrollment === "all"
        ? true
        : enrollment === "ob"
          ? u.role === "ob"
          : u.role !== "ob",
    )
    .filter((u) => generation === null || u.generation === generation)
    .filter((u) => genreId === null || u.mainGenreId === genreId)
    .filter((u) => query.trim() === "" || u.username.includes(query.trim()));

  /** 保存後に手元の行だけ差し替える */
  function replaceUser(next: AdminUser) {
    setUsers((prev) =>
      prev.map((u) => (u.userId === next.userId ? next : u)),
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">管理者</h1>
        <Link href="/settings" className="text-sm text-[var(--muted)] underline">
          設定へ戻る
        </Link>
      </div>

      <ErrorMessage>{error}</ErrorMessage>
      {notice ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      <BulkGraduateSection
        users={users}
        currentUserId={currentUserId}
        onError={setError}
        onNotice={setNotice}
        onGraduated={(ids) =>
          setUsers((prev) =>
            prev.map((u) =>
              ids.includes(u.userId) ? { ...u, role: "ob" } : u,
            ),
          )
        }
      />

      <section className="space-y-3">
        <h2 className="text-base font-bold">
          ユーザー一覧
          <span className="ml-2 text-xs font-normal text-[var(--muted)]">
            {filtered.length} / {users.length}人
          </span>
        </h2>

        <input
          type="search"
          value={query}
          placeholder="ユーザーIDで検索 (例: 22BREAK)"
          onChange={(e) => setQuery(e.target.value)}
          className={inputClass}
        />

        <ChipRow
          label="在籍"
          items={(["active", "ob", "all"] as const).map((value) => ({
            key: value,
            label: ENROLLMENT_LABELS[value],
            on: enrollment === value,
            onClick: () => setEnrollment(value),
          }))}
        />
        <ChipRow
          label="期"
          items={[
            {
              key: "all",
              label: "すべて",
              on: generation === null,
              onClick: () => setGeneration(null),
            },
            ...generations.map((g) => ({
              key: String(g),
              label: `${g}期`,
              on: generation === g,
              onClick: () => setGeneration(g),
            })),
          ]}
        />
        <ChipRow
          label="1ジャン"
          items={[
            {
              key: "all",
              label: "すべて",
              on: genreId === null,
              onClick: () => setGenreId(null),
            },
            ...GENRES.map((g) => ({
              key: g.code,
              label: g.code,
              on: genreId === g.id,
              onClick: () => setGenreId(g.id),
            })),
          ]}
        />

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            該当するユーザーがいません
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {filtered.map((user) => (
              <li key={user.userId}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) =>
                      prev === user.userId ? null : user.userId,
                    )
                  }
                  aria-expanded={expanded === user.userId}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {user.username}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {user.generation}期 /{" "}
                      {GENRE_BY_ID.get(user.mainGenreId)?.code ?? "-"}
                    </span>
                  </span>
                  <RoleBadge role={user.role} />
                  {user.userId === currentUserId ? (
                    <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px]">
                      自分
                    </span>
                  ) : null}
                  <span aria-hidden className="shrink-0 text-xs text-[var(--muted)]">
                    {expanded === user.userId ? "▲" : "▼"}
                  </span>
                </button>

                {expanded === user.userId ? (
                  <EditPanel
                    user={user}
                    isSelf={user.userId === currentUserId}
                    onError={setError}
                    onNotice={setNotice}
                    onSaved={(next) => {
                      replaceUser(next);
                      setExpanded(null);
                    }}
                    onDeleted={() => {
                      setUsers((prev) =>
                        prev.filter((u) => u.userId !== user.userId),
                      );
                      setExpanded(null);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PassphraseSection onError={setError} onNotice={setNotice} />
    </main>
  );
}

/**
 * 合言葉の変更 (SPEC §6.5 / §3.5)
 *
 * 3種すべてを毎回入れさせない。1つだけ変える場面のほうが多いため、
 * 空欄は「変更しない」として扱う。
 */
function PassphraseSection({
  onError,
  onNotice,
}: {
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [values, setValues] = useState({
    signupPass: "",
    coordinatorPass: "",
    adminPass: "",
  });
  const [pending, setPending] = useState(false);

  const entries = [
    { field: "signupPass" as const, label: "サークル生合言葉", hint: "サインアップ時に必要" },
    { field: "coordinatorPass" as const, label: "折衝パスワード", hint: "折衝の権限を追加するとき" },
    { field: "adminPass" as const, label: "管理者パスワード", hint: "3役(管理者)の権限を追加するとき" },
  ];

  const filled = entries.filter((e) => values[e.field].trim() !== "");

  async function save() {
    if (
      !window.confirm(
        `${filled.map((e) => e.label).join("・")} を変更します。\n` +
          "変更後は、新しい合言葉を知っている人しか登録・権限の追加ができません。",
      )
    ) {
      return;
    }

    setPending(true);
    onError(null);
    onNotice(null);
    try {
      const body: Record<string, string> = {};
      for (const entry of filled) body[entry.field] = values[entry.field].trim();

      const res = await fetch("/api/admin/passphrases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(json.error ?? "合言葉を変更できませんでした");
        return;
      }
      setValues({ signupPass: "", coordinatorPass: "", adminPass: "" });
      onNotice(`${(json.updated ?? []).join("・")} を変更しました`);
      if (json.warning) onError(json.warning);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <h2 className="text-base font-bold">合言葉</h2>
      <p className="text-xs text-[var(--muted)]">
        <strong>代替わり・卒業の時期には必ず変更してください</strong>
        (SPEC §3.5)。空欄の項目は変更しません。変更しても、今の権限は取り消されません。
      </p>

      {entries.map((entry) => (
        <Field key={entry.field} label={entry.label} hint={entry.hint}>
          <input
            type="password"
            value={values[entry.field]}
            autoComplete="new-password"
            placeholder="変更しない"
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [entry.field]: e.target.value }))
            }
            className={inputClass}
          />
        </Field>
      ))}

      <button
        type="button"
        onClick={save}
        disabled={pending || filled.length === 0}
        className={secondaryButtonClass}
      >
        {filled.length === 0 ? "変更する項目を入力" : `${filled.length}件を変更する`}
      </button>
    </section>
  );
}

function RoleBadge({ role }: { role: Role }) {
  // OB は名簿に残り続けるので、現役と一目で区別が付く必要がある (SPEC §3.6)
  const style =
    role === "ob"
      ? "border-[var(--ob)] text-[var(--ob)]"
      : role === "admin"
        ? "border-[var(--accent)] text-[var(--accent)]"
        : role === "coordinator"
          ? "border-[var(--info)] text-[var(--info)]"
          : "border-[var(--border)] text-[var(--muted)]";

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${style}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function ChipRow({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; on: boolean; onClick: () => void }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-[var(--muted)]">{label}</span>
      {/* 期もジャンルも数が多い。折り返すと縦に伸びるので横スクロールにする */}
      <div className="h-scroll flex flex-1 gap-1.5 overflow-x-auto pb-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${
              item.on
                ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
                : "border-[var(--border)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 1人分の編集 (SPEC §6.5 / §6.5.1)
 *
 * 期・1ジャン・表示名のどれを変えても username が変わるため、
 * **変更後のログインIDを出したうえで確認を取る**。本人へ伝えるのは admin の仕事。
 */
function EditPanel({
  user,
  isSelf,
  onError,
  onNotice,
  onSaved,
  onDeleted,
}: {
  user: AdminUser;
  isSelf: boolean;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
  onSaved: (next: AdminUser) => void;
  onDeleted: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [generation, setGeneration] = useState(String(user.generation));
  const [mainGenreId, setMainGenreId] = useState(user.mainGenreId);
  const [role, setRole] = useState<Role>(user.role);
  const [pending, setPending] = useState(false);
  /** 発行した仮パスワード。画面から離れると読めなくなるので消さずに出しておく */
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const generationNumber = Number(generation);
  const valid =
    displayName.trim().length > 0 &&
    Number.isInteger(generationNumber) &&
    generationNumber >= 1 &&
    generationNumber <= 99;

  // 入力途中で組み立てられないときは現在のIDを出しておく (欄が空になるのを避ける)
  const nextUsername = valid
    ? buildUsernameFromGenreId(generationNumber, mainGenreId, displayName)
    : user.username;

  const changed =
    displayName.trim() !== user.displayName ||
    generationNumber !== user.generation ||
    mainGenreId !== user.mainGenreId ||
    role !== user.role;

  async function save() {
    if (!valid) {
      onError("名前と期を正しく入力してください");
      return;
    }

    const graduating = role === "ob" && user.role !== "ob";
    const restoring = user.role === "ob" && role !== "ob";

    const lines = [`${user.username} の情報を変更します。`];
    if (nextUsername !== user.username) {
      lines.push(
        `\n変更後のログインIDは「${nextUsername}」になります。\n本人へ必ず連絡してください。`,
      );
    }
    if (graduating) {
      lines.push(
        "\nOB/OGへ移行すると、この人の未来の空き申請と公式練の出欠が削除され、" +
          "サブジャンルの設定が消えます。ナンバー所属・過去の履歴・購読URLは残ります。",
      );
      if (user.role === "coordinator" || user.role === "admin") {
        lines.push(`\n同時に${ROLE_LABELS[user.role]}の権限も外れます。`);
      }
    }
    if (restoring) {
      lines.push(
        "\n現役へ戻すと全体カレンダーと公式練が再び見えるようになります。" +
          "削除済みの申請・出欠は戻りません。",
      );
    }
    if (!window.confirm(lines.join("\n"))) return;

    setPending(true);
    onError(null);
    onNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${user.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          generation: generationNumber,
          mainGenreId,
          role,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "更新に失敗しました");
        return;
      }

      onSaved({
        userId: user.userId,
        username: body.username,
        generation: body.generation,
        mainGenreId: body.mainGenreId,
        displayName: body.displayName,
        role: body.role,
      });
      onNotice(
        body.username === user.username
          ? `${body.username} を更新しました`
          : `更新しました。新しいログインIDは「${body.username}」です。本人へ伝えてください`,
      );
      if (body.warning) onError(body.warning);
    } finally {
      setPending(false);
    }
  }

  async function resetPassword() {
    if (
      !window.confirm(
        `${user.username} の仮パスワードを発行します。\n` +
          "今のパスワードは使えなくなります。発行した文字列は本人へ伝えてください。",
      )
    ) {
      return;
    }

    setPending(true);
    onError(null);
    onNotice(null);
    try {
      const res = await fetch(
        `/api/admin/users/${user.userId}/reset-password`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "仮パスワードを発行できませんでした");
        return;
      }
      setTempPassword(body.password);
      onNotice(`${body.username} の仮パスワードを発行しました`);
      if (body.warning) onError(body.warning);
    } finally {
      setPending(false);
    }
  }

  async function removeUser() {
    // 確認を2段にする。ロールの変更と違って元に戻せないため
    if (
      !window.confirm(
        `${user.username} を削除します。\n` +
          "この人の申請・出欠・ナンバー所属・購読URLもすべて消え、元に戻せません。\n\n" +
          "卒業する人ならOB/OGへの移行を使ってください。",
      )
    ) {
      return;
    }
    if (window.prompt("削除するには「削除」と入力してください") !== "削除") {
      return;
    }

    setPending(true);
    onError(null);
    onNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${user.userId}/delete`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "削除できませんでした");
        return;
      }
      onNotice(`${body.username} を削除しました`);
      onDeleted();
      if (body.warning) onError(body.warning);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <Field label="名前">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-3">
        <div className="w-24 shrink-0">
          <Field label="期">
            <input
              type="text"
              inputMode="numeric"
              value={generation}
              onChange={(e) => setGeneration(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="1ジャン">
            <select
              value={mainGenreId}
              onChange={(e) => setMainGenreId(Number(e.target.value))}
              className={inputClass}
            >
              {GENRES.map((genre) => (
                <option key={genre.id} value={genre.id}>
                  {genre.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <Field
        label="権限"
        hint={
          isSelf
            ? "自分自身の権限は変更できません (最後の3役が消えるのを防ぐため)"
            : "OB/OGにすると全体カレンダーと公式練が見えなくなります"
        }
      >
        <select
          value={role}
          disabled={isSelf}
          onChange={(e) => setRole(e.target.value as Role)}
          className={`${inputClass} disabled:opacity-50`}
        >
          {(["member", "coordinator", "admin", "ob"] as const).map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>

      <p className="text-xs text-[var(--muted)]">
        変更後のログインID:{" "}
        <strong className="font-mono">{nextUsername}</strong>
      </p>

      <button
        type="button"
        onClick={save}
        disabled={pending || !changed || !valid}
        className={secondaryButtonClass}
      >
        {pending ? "保存中…" : "保存する"}
      </button>

      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={resetPassword}
          disabled={pending}
          className={secondaryButtonClass}
        >
          仮パスワードを発行する
        </button>

        {tempPassword ? (
          <div className="rounded-lg border border-[var(--foreground)] px-3 py-2">
            <p className="text-xs text-[var(--muted)]">
              仮パスワード (この画面でしか読めません。本人へ伝えてください)
            </p>
            <p className="select-all font-mono text-lg font-bold">
              {tempPassword}
            </p>
          </div>
        ) : null}

        {/* 削除は取り返しがつかないので、他の操作と色でも分けておく */}
        <button
          type="button"
          onClick={removeUser}
          disabled={pending || isSelf}
          className="w-full rounded-lg border border-[var(--accent)] px-4 py-3 text-base font-medium text-[var(--accent)] disabled:opacity-50"
        >
          このアカウントを削除する
        </button>
        <p className="text-xs text-[var(--muted)]">
          卒業はOB/OGへの移行を使ってください。削除は誤登録の整理用で、
          活動の記録が残っているアカウントは削除できません。
        </p>
      </div>
    </div>
  );
}

/**
 * 期を指定した一括OB化 (SPEC §6.5 / §3.6)
 *
 * 卒業のたびに数十人を1人ずつ触るのは現実的でないので、期でまとめて移行する。
 * **現役だけを対象にする** — 既にOBの人を含めても何も起きないが、
 * 「N人を移行します」の数が実態とずれると確認の意味が無くなる。
 */
function BulkGraduateSection({
  users,
  currentUserId,
  onError,
  onNotice,
  onGraduated,
}: {
  users: AdminUser[];
  currentUserId: string;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
  onGraduated: (userIds: string[]) => void;
}) {
  const [generation, setGeneration] = useState<string>("");
  const [pending, setPending] = useState(false);

  const generations = [
    ...new Set(users.filter((u) => u.role !== "ob").map((u) => u.generation)),
  ].sort((a, b) => a - b);

  const targets = users.filter(
    (u) =>
      u.role !== "ob" &&
      String(u.generation) === generation &&
      u.userId !== currentUserId,
  );

  async function graduate() {
    const names = targets.map((t) => t.username).join("\n");
    if (
      !window.confirm(
        `${generation}期の${targets.length}人をOB/OGへ移行します。\n\n${names}\n\n` +
          "全員の未来の空き申請と公式練の出欠が削除され、サブジャンルの設定が消えます。\n" +
          "ナンバー所属・過去の履歴・購読URLは残ります。",
      )
    ) {
      return;
    }

    setPending(true);
    onError(null);
    onNotice(null);
    try {
      const res = await fetch("/api/admin/users/bulk-graduate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: targets.map((t) => t.userId) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "移行に失敗しました");
        return;
      }
      onGraduated(targets.map((t) => t.userId));
      onNotice(`${body.updated}人をOB/OGへ移行しました`);
      if (body.warning) onError(body.warning);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <h2 className="text-base font-bold">卒業処理 (一括OB化)</h2>
      <p className="text-xs text-[var(--muted)]">
        卒業者は<strong>削除ではなくOB/OGへ移行</strong>します。ナンバー機能と購読URLは
        そのまま使えます (SPEC §3.6)。削除は誤登録の整理にのみ使ってください。
      </p>

      <div className="flex gap-2">
        <select
          value={generation}
          onChange={(e) => setGeneration(e.target.value)}
          className={`${inputClass} mt-0 flex-1`}
        >
          <option value="">期を選ぶ</option>
          {generations.map((g) => (
            <option key={g} value={g}>
              {g}期
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={graduate}
          disabled={pending || targets.length === 0}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-50"
        >
          {targets.length}人を移行
        </button>
      </div>
    </section>
  );
}
