// The tasks tab: durable tasks, the live ones read off the session transcript, and the goals dsh has run,
// with the row shapes and status words that draw them.
import { useEffect, useRef, useState } from "react";
import type { LiveTask } from "../events.js";
import {
  btn,
  errText,
  stateText,
  sectionHead,
  nested,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
  boxParam,
  type ClientCtx,
} from "../shared.js";
import { t, useLocale, type OmcKey } from "../i18n.js";

/** One task from the durable file or the session transcript. */
interface Task {
  name: string;
  description?: string;
  schedule?: string;
  nextRunAt?: number;
  durable?: boolean;
}

/** Reply from GET /scheduled-tasks. */
interface ScheduledTasksReply {
  ok: true;
  durable: Task[];
  session: Task[];
  goal: { text: string; at: number } | null;
  dshGoals: DshGoal[];
  path: string;
}

/** One of the session's dsh goals, as the route folds dsh's own log. */
interface DshGoal {
  id: string;
  objective: string;
  phase: string;
  roundsStarted: number;
  maxGoalRounds?: number;
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
}

/** How a goal's phase reads on its row: a mark a glance can take in, and dsh's word translated at
 *  render. The mark stays; only the word switches language. */
const PHASE = new Map<string, { glyph: string; key: OmcKey }>([
  ["active", { glyph: "●", key: "panel.tasks.phase.active" }],
  ["paused", { glyph: "‖", key: "panel.tasks.phase.paused" }],
  ["blocked", { glyph: "■", key: "panel.tasks.phase.blocked" }],
  ["complete", { glyph: "✓", key: "panel.tasks.phase.complete" }],
  ["cleared", { glyph: "○", key: "panel.tasks.phase.cleared" }],
]);

/** A goal phase as it reads on its row: the mark plus the translated word, or the raw phase for a
 *  value dsh added that this map has not caught up with. */
const phaseLabel = (phase: string): string => {
  const p = PHASE.get(phase);
  return p ? `${p.glyph} ${t(p.key)}` : phase;
};

/** One dsh goal: its phase and objective, then rounds and age, and why it stopped when blocked. */
function DshGoalRow({ goal }: { goal: DshGoal }) {
  useLocale();
  const rounds =
    goal.maxGoalRounds === undefined
      ? t("panel.tasks.rounds", { n: goal.roundsStarted })
      : t("panel.tasks.roundsOf", { n: goal.roundsStarted, max: goal.maxGoalRounds });
  return (
    <div
      data-omc-dsh-goal={goal.phase}
      style={{ padding: "4px 0", fontSize: 12, lineHeight: "1.5" }}
    >
      <div>
        <span style={{ color: goal.phase === "blocked" ? T.err : T.muted }}>
          {phaseLabel(goal.phase)}
        </span>{" "}
        · {goal.objective}
      </div>
      <div style={{ ...meta, fontSize: 11 }}>
        {rounds} · {t("panel.tasks.updated", { ago: ago(goal.updatedAt) })}
      </div>
      {goal.blockedReason ? (
        <div style={{ color: T.err, fontSize: 11, whiteSpace: "normal" }}>{goal.blockedReason}</div>
      ) : null}
    </div>
  );
}

/** Error from GET /scheduled-tasks. */
interface ScheduledTasksError {
  ok: false;
  error: string;
}

/** One scheduled task, the same row whether it survives a restart or not. */
function TaskRow({ task }: { task: Task }) {
  useLocale();
  return (
    <div style={{ ...nested, padding: "4px 0 4px 12px", fontSize: 12, lineHeight: "1.5" }}>
      <div style={{ fontWeight: 600 }}>{task.name}</div>
      {task.description ? <div style={{ ...meta, fontSize: 11 }}>{task.description}</div> : null}
      {task.schedule ? (
        <div style={{ ...meta, fontSize: 11 }}>
          {t("panel.tasks.schedule", { schedule: task.schedule })}
        </div>
      ) : null}
      {task.nextRunAt === undefined ? null : (
        <div style={{ ...meta, fontSize: 11 }}>
          {t("panel.tasks.nextRun", { date: new Date(task.nextRunAt).toLocaleString() })}
        </div>
      )}
    </div>
  );
}

/** An earlier dsh goal as one line (phase, objective cut to fit, age) that opens on a click to
 *  the full row, so a session with many past goals stays a short list. */
function PastGoalRow({ goal }: { goal: DshGoal }) {
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <div data-omc-dsh-goal-past={goal.phase}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "3px 0",
          background: "none",
          border: "none",
          font: "inherit",
          fontSize: 12,
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ color: T.faint, flex: "0 0 auto" }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: goal.phase === "blocked" ? T.err : T.muted, flex: "0 0 auto" }}>
          {phaseLabel(goal.phase)}
        </span>
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {goal.objective}
        </span>
        <span style={{ ...meta, flex: "0 0 auto" }}>{ago(goal.updatedAt)}</span>
      </button>
      {open ? (
        <div style={{ ...nested, margin: "0 0 4px 3px", fontSize: 12, lineHeight: "1.5" }}>
          <div style={{ whiteSpace: "normal" }}>{goal.objective}</div>
          <div style={{ ...meta, fontSize: 11 }}>
            {goal.maxGoalRounds === undefined
              ? t("panel.tasks.rounds", { n: goal.roundsStarted })
              : t("panel.tasks.roundsOf", { n: goal.roundsStarted, max: goal.maxGoalRounds })}
          </div>
          {goal.blockedReason ? (
            <div style={{ color: T.err, fontSize: 11, whiteSpace: "normal" }}>
              {goal.blockedReason}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The two words the CLI sends for a live task, in the reader's language; a status the CLI adds
 *  later shows as its own word, which is still true. Read at render, so a language switch that
 *  re-renders the section re-reads it. */
const statusWord = (status: string) =>
  status === "running"
    ? t("panel.tasks.status.running")
    : status === "paused"
      ? t("panel.tasks.status.paused")
      : status;

/**
 * Claude's own background tasks and subagents, polled every 3 s while the tab is open, each with
 * Stop (the CLI's `stop_task`) and Output (the last 8 KiB of a shell or Monitor task). The CLI's
 * refusal, for a subagent asked for output or a task it no longer has, lands on the row's note
 * line; a network failure lands there too. Renders nothing without tasks, so the tab reads as before.
 */
function LiveTasksSection({ sessionId }: { sessionId: string }) {
  useLocale();
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [output, setOutput] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  // A Stop or Output click outlives the tab when the panel closes before the route answers; the
  // answer then has no row to land on, and is dropped rather than set on a gone section.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`${ROUTE}/live-tasks?session=${encodeURIComponent(sessionId)}`)
        .then((r) => readJson<{ ok: true; tasks: LiveTask[] } | { ok: false }>(r))
        .then((b) => live && b.ok && setTasks(b.tasks))
        .catch(() => {});
    void load();
    // A hidden tab keeps the timer and skips the read, the way the aside card's poll does.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sessionId]);
  const act = (task: LiveTask, kind: "stop" | "output") =>
    fetch(`${ROUTE}/live-tasks/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, taskId: task.id }),
    })
      .then((r) => readJson<{ ok: boolean; output?: string; error?: string }>(r))
      .then((b) => {
        if (!mounted.current) return;
        if (kind === "output" && b.ok) setOutput((cur) => ({ ...cur, [task.id]: b.output ?? "" }));
        else if (kind === "stop" && b.ok)
          // The server dropped the row on the CLI's ok; the next poll would too, up to 3 s later.
          setTasks((cur) => cur.filter((row) => row.id !== task.id));
        else
          setNote((cur) => ({
            ...cur,
            [task.id]: b.error ?? t("panel.tasks.refused"),
          }));
      })
      .catch((e: Error) => {
        if (mounted.current) setNote((cur) => ({ ...cur, [task.id]: e.message }));
      });
  if (tasks.length === 0) return null;
  return (
    <div data-omc-live-tasks="">
      <span style={sectionHead}>{t("panel.tasks.live")}</span>
      {tasks.map((task) => (
        <div
          key={task.id}
          data-omc-live-task={task.id}
          style={{ ...nested, padding: "4px 0 4px 12px", fontSize: 12, lineHeight: "1.5" }}
        >
          {/* Wraps on a phone, the way the suggestion card does: the buttons drop under a long
              description instead of squeezing it. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ flex: "1 1 14em", minWidth: 0, overflowWrap: "break-word" }}>
              {task.description}
            </span>
            {/* Output reads a shell or Monitor task's tail; the CLI refuses it for a subagent,
                so a subagent row does not offer it. */}
            {task.subagentType ? null : (
              <button
                type="button"
                style={btn}
                data-omc-live-task-output=""
                onClick={() => void act(task, "output")}
              >
                {t("panel.tasks.output")}
              </button>
            )}
            <button
              type="button"
              style={btn}
              data-omc-live-task-stop=""
              onClick={() => void act(task, "stop")}
            >
              {t("panel.tasks.stop")}
            </button>
          </div>
          <div style={{ ...meta, fontSize: 11 }}>
            {[
              statusWord(task.status),
              task.backgrounded ? t("panel.tasks.background") : "",
              task.subagentType ?? "",
            ]
              .filter(Boolean)
              .join(" · ")}
            {note[task.id] ? ` · ${note[task.id]}` : ""}
          </div>
          {output[task.id] !== undefined ? (
            <pre
              data-omc-live-task-output-text=""
              style={{
                ...meta,
                fontFamily: T.mono,
                fontSize: 11,
                whiteSpace: "pre-wrap",
                margin: "4px 0 0",
              }}
            >
              {output[task.id] || t("panel.tasks.outputEmpty")}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Both goals and the scheduled tasks, each section only when it has something: dsh's goal and its
 *  past ones from dsh's own log, the CLI's goal from its transcript, then the tasks. Read-only;
 *  dsh's goal is changed from dsh's own controls. With nothing at all, one line says so. */
export function TasksBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const [data, setData] = useState<ScheduledTasksReply | ScheduledTasksError | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  useEffect(() => {
    // dsh's goal is there with or without a running CLI; the CLI's half is empty without one.
    let live = true;
    fetch(
      `${ROUTE}/scheduled-tasks?session=${encodeURIComponent(sessionId)}${boxParam(ctx, sessionId)}`,
    )
      .then((r) => readJson<ScheduledTasksReply | ScheduledTasksError>(r))
      .then((b) => live && setData(b))
      .catch((e: Error) => live && setData({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionId]);

  const dshGoals = data?.ok ? data.dshGoals : [];
  const current =
    dshGoals[0] && ["active", "paused", "blocked"].includes(dshGoals[0].phase)
      ? dshGoals[0]
      : undefined;
  const past = current ? dshGoals.slice(1) : dshGoals;

  return (
    <div style={bodyFlow}>
      <LiveTasksSection sessionId={sessionId} />
      {data === null ? (
        <span style={stateText}>{t("loading")}</span>
      ) : !data.ok ? (
        <span style={errText}>{data.error}</span>
      ) : (
        <>
          {dshGoals.length === 0 &&
          !data.goal &&
          data.durable.length === 0 &&
          data.session.length === 0 ? (
            <span data-omc-tasks-empty="" style={stateText}>
              {t("panel.tasks.empty")}
            </span>
          ) : null}
          {dshGoals.length > 0 ? <span style={sectionHead}>{t("panel.tasks.dshGoal")}</span> : null}
          {current ? (
            <DshGoalRow goal={current} />
          ) : dshGoals.length > 0 ? (
            <div style={{ ...meta, padding: "4px 0", fontSize: 12 }}>
              {t("panel.tasks.noGoalRunning")}
            </div>
          ) : null}
          {past.length > 0 ? (
            <div data-omc-dsh-goals-past="">
              <button
                type="button"
                aria-expanded={pastOpen}
                onClick={() => setPastOpen((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 0",
                  font: "inherit",
                  fontSize: 12,
                  color: T.muted,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {`${pastOpen ? "▾" : "▸"}\u00a0${t("panel.tasks.pastGoals")}`}
                <span style={meta}> · {past.length}</span>
              </button>
              {pastOpen && past.map((g) => <PastGoalRow key={g.id} goal={g} />)}
            </div>
          ) : null}

          {/* The CLI's own /goal: rarely set from dsh, so the section only appears when it is. */}
          {data.goal ? (
            <>
              <span style={sectionHead}>{t("panel.tasks.cliGoal")}</span>
              <div
                data-omc-cli-goal=""
                style={{ padding: "4px 0", fontSize: 12, lineHeight: "1.5" }}
              >
                <div style={{ marginBottom: 4 }}>{data.goal.text}</div>
                <div style={{ ...meta, fontSize: 11 }}>
                  {t("panel.tasks.proposed", { ago: ago(data.goal.at) })}
                </div>
              </div>
            </>
          ) : null}

          {/* Like the CLI goal, the tasks only take room when there are some. */}
          {data.durable.length > 0 ? (
            <>
              <span style={sectionHead}>{t("panel.tasks.durable")}</span>
              {data.durable.map((task) => (
                <TaskRow key={task.name} task={task} />
              ))}
              <div style={{ ...meta, padding: "2px 0", fontSize: 11, fontFamily: T.mono }}>
                {data.path}
              </div>
            </>
          ) : null}

          {data.session.length > 0 ? (
            <>
              <span style={sectionHead}>{t("panel.tasks.sessionOnly")}</span>
              {data.session.map((task) => (
                <TaskRow key={task.name} task={task} />
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
