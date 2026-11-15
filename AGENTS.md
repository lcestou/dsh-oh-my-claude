# Agent notes

## Git

- Conventional Commits, one-line subjects. Squash merges by default.
- PR titles are Conventional Commit subjects (`feat: ...`, `fix(scope): ...`), because a squash merge makes the title the commit on the default branch; CI checks it.
- Versions follow semver, and the bump comes from the commit types since the last tag, not from feel: below 1.0, `feat` or a breaking change (`!` / `BREAKING CHANGE`) is a minor bump and `fix`/`perf` a patch; from 1.0, breaking is major, `feat` minor, `fix` patch; docs/ci/chore/test alone need no release. The release check (`.github/workflows/release-check.yml`, `.github/scripts/release-bump-check.py`) fails a tag whose bump is too small; run the script with the new version before tagging.
