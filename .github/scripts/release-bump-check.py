#!/usr/bin/env python3
"""Fail when a release version bumps less than its commit types require.

Usage: release-bump-check.py [vX.Y.Z]   (defaults to $GITHUB_REF_NAME; run it before tagging too)
Compares against the highest plain X.Y.Z tag below the new version, reading commits up to HEAD.
Below 1.0: feat or breaking -> minor, fix/perf -> patch. From 1.0: breaking -> major, feat -> minor, fix/perf -> patch.
"""
import os
import re
import subprocess
import sys

SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
HEADER = re.compile(r"^(\w+)(\([^)]*\))?(!)?:")
LEVELS = ["none", "patch", "minor", "major"]


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def parse(tag):
    m = SEMVER.match(tag)
    return tuple(int(x) for x in m.groups()) if m else None


def required_bump(version):
    level = 0
    for commit in git("log", f"{prev_tag}..HEAD", "--format=%s%x1e%b%x1f").split("\x1f"):
        if not commit.strip():
            continue
        subject, _, body = commit.strip().partition("\x1e")
        m = HEADER.match(subject)
        kind = m.group(1) if m else ""
        breaking = bool(m and m.group(3)) or "BREAKING CHANGE" in body or "BREAKING-CHANGE" in body
        if breaking:
            level = max(level, 2 if version[0] == 0 else 3)
        elif kind == "feat":
            level = max(level, 2)
        elif kind in ("fix", "perf"):
            level = max(level, 1)
    return level


def actual_bump(old, new):
    if new[0] != old[0]:
        return 3
    if new[1] != old[1]:
        return 2
    return 1 if new[2] != old[2] else 0


new_tag = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GITHUB_REF_NAME", "")
new = parse(new_tag)
if not new:
    print(f"{new_tag!r} is not a plain X.Y.Z version; nothing to check")
    sys.exit(0)
older = sorted(v for v in map(parse, git("tag", "--list").split()) if v and v < new)
if not older:
    print("no earlier release; nothing to check")
    sys.exit(0)
prev = older[-1]
prev_tag = next(t for t in git("tag", "--list").split() if parse(t) == prev)
need, got = required_bump(new), actual_bump(prev, new)
print(f"{prev_tag} -> {new_tag}: commits need {LEVELS[need]}, version bumps {LEVELS[got]}")
if got < need:
    print(f"::error::{new_tag} is too small a bump for the commits since {prev_tag}; commits need at least a {LEVELS[need]} release")
    sys.exit(1)
