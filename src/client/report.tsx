// The Report a problem block: the server builds and redacts the text, this component only shows
// it, lets the owner edit it, and copies it or opens an issue with it.
import { useEffect, useRef, useState } from "react";
import { btn, btnPrimary, errText, inputStyle, meta, readJson, ROUTE, T } from "./shared.js";

interface Props {
  sessionId?: string;
  provider?: string;
}

/** The "Report a problem" block: fetches the server-built report for this session, shows it for
 *  editing and copies it or opens an issue with it. */
export function ReportBlock({ sessionId, provider }: Props) {
  const [text, setText] = useState("");
  const [issues, setIssues] = useState("");
  const [host, setHost] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams();
    if (sessionId) q.set("session", sessionId);
    if (provider) q.set("provider", provider);
    if (host) q.set("host", "1");
    fetch(`${ROUTE}/report?${q}`)
      .then((r) => readJson<{ text: string; issues: string }>(r))
      .then((b) => {
        if (live) {
          setText(b.text);
          setIssues(b.issues);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [sessionId, provider, host]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard write failed; select the text and copy it.");
    }
  };

  const issueHref = issues ? `${issues}?body=${encodeURIComponent(text)}` : "";

  return (
    <div data-omc-report="">
      <p style={{ ...meta, whiteSpace: "normal", margin: "0 0 6px" }}>
        What the plugin knows about this box, with your home, user name and email masked. Read it,
        strike anything you do not want to share, then copy it or open an issue.
      </p>
      <textarea
        data-omc-report-text=""
        aria-label="Bug report"
        rows={10}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          ...inputStyle,
          width: "100%",
          boxSizing: "border-box",
          fontFamily: T.mono,
          fontSize: 11,
          lineHeight: "1.45",
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 8,
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          <input
            type="checkbox"
            data-omc-report-host=""
            checked={host}
            onChange={(e) => setHost(e.target.checked)}
          />
          Include hostname
        </label>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-omc-report-copy=""
          style={btnPrimary}
          disabled={text === ""}
          onClick={copy}
        >
          {copied ? "Copied" : "Copy report"}
        </button>
        {issues !== "" && issueHref.length <= 7000 ? (
          <a data-omc-report-issue="" target="_blank" rel="noreferrer" style={btn} href={issueHref}>
            Open GitHub issue
          </a>
        ) : issues !== "" ? (
          <>
            <span style={meta}>Too long for a link: copy it and paste it into a new issue.</span>
            <a data-omc-report-issue="" target="_blank" rel="noreferrer" style={btn} href={issues}>
              Open issues page
            </a>
          </>
        ) : null}
      </div>
      {error !== "" && <p style={errText}>{error}</p>}
    </div>
  );
}
