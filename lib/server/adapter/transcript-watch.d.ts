import { type FSWatcher } from "node:fs";
import { type FsBox } from "../remote-fs.js";
import { type WatchRecord } from "../state.js";
import { type FoldedTurn } from "../transcript.js";
/** Deterministic UUID for a dsh session id, so a reopened dsh session resumes the same Claude session. */
/** Terminal exchanges waiting to be shown in a dsh session, and the one whose turn is open. */
export interface MirrorQueue {
    queue: FoldedTurn[];
    inFlight?: {
        id: string;
        turn: FoldedTurn;
        at: number;
    };
}
/** A terminal turn being streamed live into one open dsh turn. `id` matches the followup that
 *  opened the turn; the render loop reads the exchange from `start`, renders its blocks, and yields
 *  the ones past `shown`, waking on `wake` when a scan sees new rows and settling when `done`. */
export interface StreamState {
    id: string;
    path: string;
    box: FsBox;
    start: number;
    shown: number;
    done: boolean;
    startedAt: number;
    wake?: () => void;
}
/** What watch.json keeps for a session: the file, the byte its settled rows end at, the box. */
export declare function watchRecord(path: string, seen: number, box: FsBox, provider: string, claudeId: string): WatchRecord;
/** A session's transcript under watch: the file, the byte its settled rows end at, the watcher. */
export interface TranscriptWatch {
    path: string;
    seen: number;
    claudeId: string;
    /** The box the file is on; a remote one has no inotify and is polled by the sweep instead. */
    box: FsBox;
    fw?: FSWatcher;
    timer?: NodeJS.Timeout;
    /** A scan is reading the file; one asked for meanwhile runs after it, never alongside it. */
    scanning?: boolean;
    again?: boolean;
}
/** Turns a dsh session id into a Claude Code–style session id so the transcript path computed from
 *  it matches the one the CLI actually wrote. */
export declare function claudeSessionId(sessionId: string): string;
/**
 * The directory Claude Code keeps a path's transcripts in, under `~/.claude/projects/`: the path
 * with every non-alphanumeric as `-`. Past 200 characters the CLI keeps the first 200 and appends
 * a base-36 hash of the whole path (its own 31-multiplier string hash, read off the 2.1.287
 * binary and checked against a live run), so two long paths with one prefix stay apart.
 */
export declare function projectDirName(cwd: string): string;
/**
 * Whether this session has a saved transcript on disk: true when the `.jsonl` file is there,
 * false when the read fails, so a caller can skip a session that never wrote one.
 */
export declare function claudeSessionExists(home: string, cwd: string, id: string): Promise<boolean>;
