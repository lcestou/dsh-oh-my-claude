// The Changelog block under Settings: the route parses the plugin's own CHANGELOG.md, this
// component draws the releases it answers and marks the one this box runs. The items carry
// backticks and nothing else, so the inline renderer is a split on backticks.
import { useEffect, useState } from "react";
import { ACCENT, errText, meta, pill, readJson, ROUTE, stateText, T } from "./shared.js";
import { t, useLocale, type OmcKey } from "./i18n.js";

interface Release {
  version: string;
  date: string | null;
  intro: string | null;
  sections: { kind: string; items: string[] }[];
}

const FULL_URL = "https://github.com/lcestou/dsh-oh-my-claude/blob/main/CHANGELOG.md";

/** A section heading from CHANGELOG.md in the active language; an unknown heading as written.
 *  The entries themselves stay in English, the language the file is written in. */
function kindLabel(kind: string): string {
  const key = KIND_KEYS.get(kind);
  return key ? t(key) : kind;
}

/** The Keep a Changelog headings this file knows, by the English word CHANGELOG.md uses. */
const KIND_KEYS = new Map<string, OmcKey>([
  ["Added", "changelog.added"],
  ["Changed", "changelog.changed"],
  ["Fixed", "changelog.fixed"],
  ["Removed", "changelog.removed"],
]);

/** Backtick spans as `<code>`, the rest as text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} style={{ fontFamily: T.mono, fontSize: "0.92em" }}>
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** The Changelog block under Settings: fetches the route's parsed releases, draws them and marks
 *  the version this box runs. */
export function ChangelogBlock() {
  useLocale();
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/changelog`)
      .then((r) => readJson<{ version: string; releases: Release[] }>(r))
      .then((b) => {
        if (!live) return;
        setVersion(b.version);
        setReleases(b.releases);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const link = (
    <a
      data-omc-changelog-link=""
      href={FULL_URL}
      target="_blank"
      rel="noreferrer"
      style={{ color: ACCENT, fontSize: 13 }}
    >
      {t("changelog.full")}
    </a>
  );
  if (error) return <p style={errText}>{error}</p>;
  if (releases === null) return <p style={stateText}>{t("common.loading")}</p>;
  if (releases.length === 0)
    return (
      <p data-omc-changelog="" style={stateText}>
        {t("changelog.none")} {link}
      </p>
    );
  return (
    <div data-omc-changelog="">
      {releases.map((r) => (
        <section
          key={r.version}
          data-omc-changelog-release={r.version}
          style={{ marginBottom: 14 }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: T.text, fontSize: 14, fontWeight: 600 }}>{r.version}</span>
            {r.version === version && (
              <span data-omc-changelog-installed="" style={pill(T.brand)}>
                {t("changelog.installed")}
              </span>
            )}
            {r.date && <span style={{ ...meta, marginLeft: "auto" }}>{r.date}</span>}
          </div>
          {r.intro && (
            <p style={{ ...meta, whiteSpace: "normal", margin: "4px 0 0" }}>
              <Inline text={r.intro} />
            </p>
          )}
          {r.sections.map((s, si) => (
            <div key={si} data-omc-changelog-kind={s.kind}>
              <div style={{ ...meta, marginTop: 8 }}>{kindLabel(s.kind)}</div>
              <ul
                style={{
                  margin: "4px 0 0",
                  paddingLeft: 18,
                  listStyleType: "disc",
                  color: T.text,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {s.items.map((item, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {link}
    </div>
  );
}
