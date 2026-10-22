// The dsh-to-Claude session id mapping, the mirror queue and stream shapes, and the watch record.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
/** What watch.json keeps for a session: the file, the byte its settled rows end at, the box. */
export function watchRecord(path, seen, box, provider, claudeId) {
    const record = { path, seen, provider, claudeId };
    if (box.sshHost)
        record.host = box.sshHost;
    return record;
}
/** Turns a dsh session id into a Claude Code–style session id so the transcript path computed from
 *  it matches the one the CLI actually wrote. */
export function claudeSessionId(sessionId) {
    const h = createHash("sha256").update(`dsh-llm-claude:${sessionId}`).digest("hex");
    const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/**
 * The directory Claude Code keeps a path's transcripts in, under `~/.claude/projects/`: the path
 * with every non-alphanumeric as `-`. Past 200 characters the CLI keeps the first 200 and appends
 * a base-36 hash of the whole path (its own 31-multiplier string hash, read off the 2.1.287
 * binary and checked against a live run), so two long paths with one prefix stay apart.
 */
export function projectDirName(cwd) {
    const flat = cwd.replace(/[^A-Za-z0-9]/g, "-");
    if (flat.length <= 200)
        return flat;
    let hash = 0;
    for (let i = 0; i < cwd.length; i++)
        hash = Math.imul(hash, 31) + cwd.charCodeAt(i);
    return `${flat.slice(0, 200)}-${Math.abs(hash | 0).toString(36)}`;
}
/**
 * Whether this session has a saved transcript on disk: true when the `.jsonl` file is there,
 * false when the read fails, so a caller can skip a session that never wrote one.
 */
export async function claudeSessionExists(home, cwd, id) {
    try {
        await access(join(home, "projects", projectDirName(cwd), `${id}.jsonl`));
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=transcript-watch.js.map