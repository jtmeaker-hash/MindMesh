#!/usr/bin/env python3
"""Apply the final pending pull request documentation summary to README.md.

Runs only after a pull request has been merged into ``main`` (or when the
update is re-applied manually for a merged pull request).

Guarantees:
  * README.md is modified at most once per merged pull request. A per-PR
    marker plus a content check make the update idempotent, so re-runs and
    repeated merges never duplicate documentation entries.
  * Existing README content is preserved. Only the managed release-notes
    section (``<!-- mindmesh-release-notes:start -->`` .. ``end``) is
    touched; every other section is left intact.
  * When no pending summary comment is available, the entry is rebuilt from
    the merged pull request metadata, changed files and commit subjects, so
    the README is still updated from real information.

Inputs (all optional except the pull request itself):
  PR_JSON          path to ``gh pr view --json ...`` output (preferred)
  PR_NUMBER / PR_TITLE / PR_URL / PR_AUTHOR / PR_BODY   env fallbacks
  PENDING_COMMENT  path to the stored pending summary comment
  CHANGED_FILES    path to a changed-files list
  COMMIT_SUBJECTS  path to a commit-subject list
  README_PATH      defaults to README.md
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pending_docs import (  # noqa: E402  (import path configured above)
    DOCS_END,
    DOCS_START,
    build_block,
    extract_author_hints,
    read_lines,
    write_step_summary,
)

MANAGED_START = "<!-- mindmesh-release-notes:start -->"
MANAGED_END = "<!-- mindmesh-release-notes:end -->"

SECTION_HEADING = "## Recent Merged Changes"

SECTION_INTRO = (
    "This section is maintained automatically. When a pull request is merged into `main`, the "
    "workflow that owns this file inserts a single entry describing the merged change, grouped "
    "from the pull request instead of from individual commits. Entries are never duplicated."
)


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def load_pr_json() -> dict:
    path = env("PR_JSON")
    if not path or not Path(path).is_file():
        return {}
    try:
        return json.loads(Path(path).read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return {}


def extract_pending_block(comment: str) -> str:
    """Pull the README-ready block out of the stored pending summary."""
    if not comment:
        return ""
    start = comment.find(DOCS_START)
    end = comment.find(DOCS_END)
    if start == -1 or end == -1 or end <= start:
        return ""
    return comment[start + len(DOCS_START) : end].strip()


def build_entry(pr_number: str, title: str, url: str, author: str, merged: str, block: str) -> str:
    footer_bits = [f"Merged {merged}"]
    footer_bits.append(f"[PR #{pr_number}]({url})" if url else f"PR #{pr_number}")
    if author:
        footer_bits.append(f"@{author}")

    return "\n".join(
        [
            f"<!-- mindmesh-pr-{pr_number} -->",
            f"### PR #{pr_number} — {title}",
            "",
            block.strip(),
            "",
            f"_{' · '.join(footer_bits)}_",
            "",
        ]
    )


def insert_entry(readme: str, entry: str) -> str:
    """Insert the entry as the newest item in the managed release-notes section."""
    if MANAGED_START in readme and MANAGED_END in readme:
        marker_end = readme.index(MANAGED_START) + len(MANAGED_START)
        return readme[:marker_end] + "\n\n" + entry.rstrip() + "\n" + readme[marker_end:]

    section = "\n".join(
        [
            "",
            "---",
            "",
            SECTION_HEADING,
            "",
            SECTION_INTRO,
            "",
            MANAGED_START,
            "",
            entry.rstrip(),
            "",
            MANAGED_END,
            "",
        ]
    )
    return readme.rstrip() + "\n" + section


def main() -> int:
    pr = load_pr_json()
    author = pr.get("author") or {}
    if isinstance(author, dict):
        author = author.get("login", "")

    number = str(pr.get("number") or env("PR_NUMBER") or "").strip()
    if not number:
        print("No pull request number available; nothing to document.", file=sys.stderr)
        return 1

    title = (pr.get("title") or env("PR_TITLE") or f"Pull request #{number}").strip()
    url = (pr.get("url") or env("PR_URL") or "").strip()
    author = str(author or env("PR_AUTHOR") or "").strip()
    body = pr.get("body") or os.environ.get("PR_BODY") or ""
    merged_at = (pr.get("mergedAt") or "").strip()

    readme_path = Path(env("README_PATH") or "README.md")
    if not readme_path.is_file():
        print(f"README not found at {readme_path}", file=sys.stderr)
        return 1

    readme = readme_path.read_text(encoding="utf-8")
    marker = f"<!-- mindmesh-pr-{number} -->"
    output = os.environ.get("GITHUB_OUTPUT")

    def set_output(name: str, value: str) -> None:
        if output:
            with open(output, "a", encoding="utf-8") as handle:
                handle.write(f"{name}={value}\n")

    def skip(message: str) -> int:
        print(message)
        set_output("changed", "false")
        write_step_summary(f"## README Status\n\n{message}\n")
        return 0

    if marker in readme:
        return skip(f"README already documents PR #{number} — no duplicate entry was added.")

    pending_block = ""
    pending_comment = env("PENDING_COMMENT")
    if pending_comment and Path(pending_comment).is_file():
        pending_block = extract_pending_block(
            Path(pending_comment).read_text(encoding="utf-8", errors="replace")
        )

    if not pending_block:
        print("No pending summary comment found; rebuilding the entry from merge metadata.")
        pending_block = build_block(
            pr_number=number,
            pr_title=title,
            hints=extract_author_hints(body),
            files=read_lines(env("CHANGED_FILES")),
            commits=read_lines(env("COMMIT_SUBJECTS")),
            checks=[],
            build_type="RELEASE",
        )

    if pending_block and pending_block in readme:
        return skip(
            f"README already contains the PR #{number} summary — no duplicate entry was added."
        )

    if merged_at:
        try:
            merged = datetime.fromisoformat(merged_at.replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            merged = merged_at[:10]
    else:
        merged = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    updated = insert_entry(readme, build_entry(number, title, url, author, merged, pending_block))
    if updated == readme:
        print("README update produced no change.")
        set_output("changed", "false")
        return 0

    readme_path.write_text(updated, encoding="utf-8")
    set_output("changed", "true")
    print(f"README.md updated with the merged PR #{number} summary.")

    write_step_summary(
        "\n".join(
            [
                "## README Status",
                "",
                "README updated from merged PR summary.",
                "",
                "- Section: Recent Merged Changes (managed block)",
                f"- Entry: PR #{number} — {title}",
                "- Existing README sections were preserved.",
                "",
            ]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
