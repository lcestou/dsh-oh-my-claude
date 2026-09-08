# Chat stream ordering: diagnosis and the tail-follow treatment

## Symptom

During a tool-heavy turn the newest assistant text is not visible. The view shows a wall of tool
rows with older prose above them, and the latest text only appears after the next message is sent.
Thinking blocks appear to flash at an old position rather than at the bottom. It is intermittent.

## What was ruled out

The on-disk session log is correctly ordered. For one real turn the events came out strictly
monotonic by seq:

```
195..207  assistant/chunk   T3 S1   (streamed prose)
208       assistant/message T3 S1
209       tool/call         T3 S1
210       tool/result       T3 S1
211       step/end          T3 S1
213       step/start        T3 S2
217..     assistant/chunk   T3 S2   (next prose, below the tool)
```

Step increments per tool round, each step's prose and its tool row are contiguous, seq never goes
backwards. Rendering strictly by seq would be perfect. So the plugin's event stream is not the
fault — it already emits the ideal signal.

## Root cause

dsh renders a turn as two tracks:

- assistant prose streams as live chunks, assembled into a step-scoped node
  (`dsh-client-ui-chat` `buildLocationData` → `kind:"step"`, keyed `assistant-step` by turn+step);
- this plugin's native tool rows are separate `session.append("tool/call" | "tool/result")` surface
  events (the rich `Bash·` / `Edit· +15 −7` rows), placed as their own step-scoped nodes.

The renderer's live tail path (`ConversationNodeAssembler.append`) does not follow the bottom the
way its full-window path (`replaceWindow`) lays things out. When the prose stream pauses because a
tool is running, dsh stops following the tail; the tool rows and the next prose grow the document
below the current scroll position, off-screen. Sending a message triggers a full re-render from the
(correct) log, which is why it "fixes itself."

The `[data-conversation-scroll]` container shows its scroll-to-bottom affordance in the failing
screenshot — direct evidence the view is parked above the bottom with content below.

## Why treat it in the plugin, and as scroll

- The user constraint: nothing outside the plugin, and no dsh-core edits — core will change under us
  with its own fixes, so the plugin treats the symptom, it does not patch the renderer.
- The event stream is already correct, so there is nothing to fix in emission. Re-emitting tool
  calls inside the prose stream would collapse the two tracks into one, but it depends on dsh's
  `tool-call start requires tool/call` in-stream contract — exactly the core surface likely to move.
- dsh tags no per-node seq/turn/step on the DOM, so reordering nodes by hand is not available.
- What remains, and matches the evidence, is scroll-follow: keep the container pinned to the tail
  while a turn streams. This is the ordinary chat behaviour and needs only `scrollTop`.

## Design

`src/client/tailFollow.ts` holds the pure decision, unit-tested in `tailFollow.test.ts`:

- `distanceFromBottom(g)` — pixels above the bottom, clamped at 0.
- `atBottom(g, px)` — within `px` of the bottom (slack 120 absorbs rounding and the one-frame gap
  between a content append growing `scrollHeight` and the next pin).
- `nextFollow(prev, signal, g, px)` — `turn-start` re-arms following, `user-up` disarms it, `scroll`
  re-arms only when it lands at the bottom and otherwise holds the prior state.

`watchTailFollow(ctx)` in `index.tsx` is the thin DOM layer, registered in `apply` next to the other
watchers and riding the shared body `MutationObserver` (`onBodyMutation`), so it runs at most once
per animation frame on the mutation bursts a streaming turn already produces — no new observer, no
`querySelectorAll` sweeps.

Each scan:

1. Gate: the open session is a Claude session (`activeClaudeSession`) and its `running` flag is set.
   Idle or non-Claude → return immediately, nothing touched.
2. On a fresh turn (`running` false→true) re-arm following.
3. While running, find `[data-conversation-scroll]`, wire one passive `scroll` listener once, and if
   following and not already at the bottom, set `scrollTop = scrollHeight`.

Reader intent is read from that one `scroll` listener: a pin only ever increases `scrollTop`, so a
scroll that moved up (`scrollTop < lastTop`) and is not at the bottom is unambiguously the reader —
one listener covers wheel, touch and keyboard without an our-write-vs-user flag. Returning to the
bottom re-arms.

## Performance

- One extra `frameScan`, coalesced into the existing per-frame flush; no new observer.
- Idle and non-Claude turns cost one store read then return.
- While streaming: one layout read and at most one `scrollTop` write per frame (skipped when already
  at the bottom), plus a passive `scroll` handler that reads geometry. O(1) per frame.
- No smooth-scroll, no timers of its own.

## Edge cases

- Reader scrolls up mid-turn → disarms, stays put; returns to bottom → re-arms.
- New turn starts while the reader is up-thread → re-arms and jumps to the live tail (the requested
  "always see live talking"); accepted trade-off.
- Container remounts (React) → `WeakSet` gate re-wires the new element; the old one is dropped.
- Non-Claude / local-model sessions → untouched; dsh's own scrolling stands.
- dsh also following the tail → both agree on the bottom, no fight; when dsh un-pins, the plugin
  re-pins on the next frame.

## How to verify

1. Refresh the tab (picks up the rebuilt `lib/client.js`).
2. Run a tool-heavy Claude turn. The view should stay glued to the newest text as tools stream.
3. Scroll up mid-turn: it should stay where you put it, not yank down, until you return to the
   bottom.
4. Confirm no visible jank on a fast streaming turn.

## Rollback

Remove the `watchTailFollow(ctx)` call in `apply`. The module and its test are inert without it.
