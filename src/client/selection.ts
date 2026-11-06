// What the selection popover's Ask sends, and the Markdown quote scan the composer's quote
// highlight (ultrathink.ts) reads.

/** Longest passage Ask sends. The server caps the same field at the same length (sessions.ts). */
export const QUOTE_MAX = 4000;

/** The `POST /side-questions` body for a selection: the typed question trimmed (blank means explain)
 *  and the passage. Never sets `withDiff` or `recap`, which belong to the Changes tab and the recap. */
export const askBody = (session: string, question: string, quote: string) => ({
  session,
  question: question.trim(),
  quote,
});

/** One run of text the quote scan reads: a text node's content, and whether it opens a new line
 *  without a newline character (a new paragraph or a `<br>` in the composer). */
export interface QuoteSeg {
  text: string;
  newLine: boolean;
}
/** A stretch to paint inside one segment: the `>` marker, or the quoted text after it. */
export interface QuoteSpan {
  seg: number;
  start: number;
  end: number;
  mark: boolean;
}

/** One line's share of a segment, `start` to `end` in that segment's text. */
interface LinePiece {
  seg: number;
  start: number;
  end: number;
}

/**
 * The quoted lines in a run of text, by the rule dsh's `messageQuoteRanges` draws a sent message's
 * quote chip with, so the composer dims what dsh will draw: consecutive lines that open (after up
 * to three spaces) with `>` form one block, kept only if text remains once each line loses its `>`
 * and one space or tab. `>` mid-line is plain and fences are not special. `mark` covers that `>`
 * and its one space or tab; the spaces before it stay unpainted. A line may run across segments.
 */
export function quoteSpans(segs: readonly QuoteSeg[]): QuoteSpan[] {
  const lines: LinePiece[][] = [];
  let line: LinePiece[] | undefined;
  for (const [i, seg] of segs.entries()) {
    if (seg.newLine || line === undefined) lines.push((line = []));
    let pos = 0;
    for (let nl = seg.text.indexOf("\n"); nl !== -1; nl = seg.text.indexOf("\n", pos)) {
      line.push({ seg: i, start: pos, end: nl });
      lines.push((line = []));
      pos = nl + 1;
    }
    line.push({ seg: i, start: pos, end: seg.text.length });
  }
  const parsed = lines.map((pieces) => {
    const text = pieces.map((p) => segs[p.seg]?.text.slice(p.start, p.end) ?? "").join("");
    const marker = /^( {0,3})>[ \t]?/.exec(text);
    return { pieces, text, lead: marker?.[1]?.length ?? 0, body: marker?.[0].length ?? -1 };
  });

  const out: QuoteSpan[] = [];
  // Paints `from` to `to`, in the line's own offsets, onto the segments the line runs across.
  const paint = (pieces: LinePiece[], from: number, to: number, mark: boolean) => {
    let at = 0;
    for (const p of pieces) {
      const start = Math.max(from, at);
      const end = Math.min(to, at + p.end - p.start);
      if (start < end)
        out.push({ seg: p.seg, start: p.start + start - at, end: p.start + end - at, mark });
      at += p.end - p.start;
    }
  };
  for (let i = 0; i < parsed.length;) {
    if (parsed[i]?.body === -1) {
      i++;
      continue;
    }
    const from = i;
    while (i < parsed.length && parsed[i]?.body !== -1) i++;
    const block = parsed.slice(from, i);
    if (block.every((l) => l.text.slice(l.body).trim() === "")) continue;
    for (const l of block) {
      paint(l.pieces, l.lead, l.body, true);
      paint(l.pieces, l.body, l.text.length, false);
    }
  }
  return out;
}
