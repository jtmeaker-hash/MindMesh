#!/usr/bin/env python3
"""Generate the documentation summary for a MindMesh workflow run.

``MODE=pr`` (pull request workflow)
    Produces the *pending* documentation summary for an open pull request.
    The pending summary is stored as a sticky pull request comment (refreshed
    in place on every push, never duplicated), uploaded as a workflow
    artifact, and rendered into the GitHub Actions job summary.
    README.md is never modified by this mode.

``MODE=main`` (main release workflow)
    Renders the release validation job summary only.  The README is updated
    once, after a pull request merges, by ``update_readme.py``.

Only information the workflow actually has is recorded: pull request
metadata, commit subjects, changed files and step outcomes.  Raw build logs
are never copied into documentation.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

DOCS_START = "<!-- mindmesh-pending-docs:start -->"
DOCS_END = "<!-- mindmesh-pending-docs:end -->"
COMMENT_MARKER = "<!-- mindmesh-pending-docs -->"
META_OPEN = "<!-- mindmesh-pending-meta"
META_CLOSE = "-->"

# Soft limit so generated documentation never grows into a log dump.
MAX_BLOCK_CHARS = 20_000

STATUS_TEXT = {
    "success": "passed",
    "failure": "failed",
    "cancelled": "cancelled",
    "skipped": "not run (blocked by an earlier failure)",
    "": "not run",
}

CONFIG_FILES = {
    "package.json",
    "package-lock.json",
    "build.gradle.kts",
    "settings.gradle.kts",
    "gradle.properties",
    "libs.versions.toml",
    "vite.config.ts",
    "tsconfig.json",
    "eslint.config.js",
}

FIX_PATTERN = re.compile(
    r"\b(fix|fixes|fixed|fixing|bug|bugs|hotfix|repair|patched|patch|regression|revert)\b",
    re.IGNORECASE,
)


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def read_lines(path: str) -> list:
    """Read a newline separated context file produced by the workflow."""
    if not path:
        return []
    candidate = Path(path)
    if not candidate.is_file():
        return []
    return [
        line.strip()
        for line in candidate.read_text(encoding="utf-8", errors="replace").splitlines()
        if line.strip()
    ]


def to_bullets(text: str) -> list:
    bullets = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^#{1,6}\s*", "", line)
        line = re.sub(r"^[-*+]\s+", "", line)
        line = re.sub(r"^\d+[.)]\s+", "", line)
        if line:
            bullets.append(line)
    return bullets


def bullet_list(items: list) -> str:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    if not cleaned:
        return "- _Nothing recorded._"
    return "\n".join(f"- {item}" for item in cleaned)


def human_join(items: list) -> str:
    items = list(items)
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def extract_author_hints(body: str) -> dict:
    """Read optional documentation hints supplied by the pull request author.

    Supported forms::

        <!-- mindmesh-docs
        summary: Short description of the change
        fixes: What was fixed
        readme: Human readable release description
        -->

    or markdown headings such as ``## Summary of Changes``.
    """
    hints = {}
    block = re.search(r"<!--\s*mindmesh-docs(.*?)-->", body or "", re.S | re.I)
    if block:
        for line in block.group(1).splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip().lower()
            value = value.strip()
            if key and value:
                hints[key] = value

    headings = (
        ("summary", r"^#{1,6}\s*(?:summary of changes|summary|what changed|overview|changes)\s*$"),
        ("fixes", r"^#{1,6}\s*(?:applied fixes|fixes|bug fixes|fixed)\s*$"),
        ("readme", r"^#{1,6}\s*(?:readme description|readme|description|release notes)\s*$"),
    )
    for key, heading in headings:
        if hints.get(key):
            continue
        match = re.search(heading + r"(.*?)(?=^#{1,6}\s|\Z)", body or "", re.S | re.M | re.I)
        if match:
            hints[key] = match.group(1).strip()
    return hints


def describe_areas(files: list) -> list:
    areas = []

    def add(label: str, predicate) -> None:
        if label not in areas and any(predicate(path) for path in files):
            areas.append(label)

    add(
        "the web application UI, services or types",
        lambda p: p.startswith("web/src/") and "/test/" not in p,
    )
    add("web tests", lambda p: p.startswith("web/src/test/") or p.endswith((".test.ts", ".test.tsx")))
    add("the Android host application", lambda p: p.startswith("app/src/"))
    add("the GitHub Actions workflows", lambda p: p.startswith(".github/"))
    add("documentation", lambda p: p.startswith("docs/") or p.lower().endswith(".md"))
    add("build or tooling configuration", lambda p: Path(p).name in CONFIG_FILES)
    return areas


def failure_lines(checks: list) -> list:
    lines = []
    for label, status in checks:
        if status in ("failure", "cancelled"):
            lines.append(f"{label}: {STATUS_TEXT.get(status, status)}.")
    blocked = [label for label, status in checks if status == "skipped"]
    if blocked:
        lines.append("Not executed because an earlier step failed: " + human_join(blocked) + ".")
    return lines


def build_block(
    pr_number: str,
    pr_title: str,
    hints: dict,
    files: list,
    commits: list,
    checks: list,
    build_type: str,
    heading: str = "####",
) -> str:
    """Build the reusable documentation block for a change set."""
    areas = describe_areas(files)

    if hints.get("summary"):
        summary_bullets = to_bullets(hints["summary"])
    else:
        summary_bullets = []
        if areas:
            summary_bullets.append("Updated " + human_join(areas) + ".")
        summary_bullets.extend(commits[:12])
        if not summary_bullets:
            summary_bullets.append(f"Repository changes were made in pull request #{pr_number}.")

    if hints.get("fixes"):
        fix_bullets = to_bullets(hints["fixes"])
    else:
        fix_bullets = [subject for subject in commits if FIX_PATTERN.search(subject)]
    if not fix_bullets:
        fix_bullets = ["No fixes were recorded for this pull request."]

    failure_bullets = failure_lines(checks)
    if not failure_bullets:
        failure_bullets = [
            "No build, test, regression, lint, signing or packaging failures were recorded."
        ]

    description = hints.get("readme")
    if not description:
        sentences = [pr_title.rstrip(".") + "." if pr_title else "MindMesh was updated."]
        if areas:
            sentences.append("It updates " + human_join(areas) + ".")
        sentences.append(
            f"The {build_type} build, the required test suite and the regression checks are "
            "validated by this workflow."
        )
        description = " ".join(sentences)

    def section(title: str, body: str) -> str:
        return f"{heading} {title}\n\n{body.strip()}"

    parts = [
        f"{heading} Summary of Changes",
        "",
        bullet_list(summary_bullets),
        "",
        f"{heading} Applied Fixes",
        "",
        bullet_list(fix_bullets),
        "",
        f"{heading} Build / Test Failures",
        "",
        bullet_list(failure_bullets),
        "",
        f"{heading} README Description",
        "",
        description.strip(),
    ]
    block = "\n".join(parts).strip()

    if len(block) > MAX_BLOCK_CHARS:
        block = block[:MAX_BLOCK_CHARS].rstrip() + "\n\n_(summary truncated)_"
    return block


def render_job_summary(
    *,
    mode: str,
    build_type: str,
    title: str,
    subtitle: str,
    block: str,
    checks: list,
    readme_status: str,
    run_url: str,
    artifact_note: str = "",
) -> str:
    """Render the GitHub Actions job summary (spec sections, no raw logs)."""
    # The stored block uses README-level headings; promote them for the summary.
    block = re.sub(r"(?m)^#{3,} ", "## ", block)

    passed = [label for label, status in checks if status == "success"]
    failed = [label for label, status in checks if status in ("failure", "cancelled")]
    not_run = [label for label, status in checks if status in ("skipped", "")]
    build_check = next((label for label, _ in checks if "APK" in label), "APK build")
    build_ok = any(label == build_check and status == "success" for label, status in checks)

    lines = [
        f"# {title}",
        "",
        subtitle,
        "",
        f"**Build type:** {build_type}",
        "",
        block,
        "",
        "## Build Status",
        "",
        f"- Build type: {build_type}",
        f"- {build_check}: {'success' if build_ok else 'not successful'}",
    ]
    if artifact_note:
        lines.append(f"- Artifact: {artifact_note}")

    lines += [
        "",
        "## Test Status",
        "",
        f"- Checks passed: {human_join(passed) if passed else 'none'}",
        f"- Checks failed: {human_join(failed) if failed else 'none'}",
        f"- Checks not run: {human_join(not_run) if not_run else 'none'}",
    ]

    lines += ["", "## Failures", ""]
    failures = failure_lines(checks)
    if failures:
        lines.extend(f"- {line}" for line in failures)
    else:
        lines.append("- None.")

    lines += ["", "## README Status", "", readme_status]

    if run_url:
        lines += ["", f"_Workflow run: {run_url}_"]

    return "\n".join(lines).strip() + "\n"


def collect_checks(build_type: str) -> list:
    apk_label = f"{build_type} APK build"
    return [
        ("Web lint", env("LINT_OUTCOME")),
        ("Web type-check", env("TYPECHECK_OUTCOME")),
        ("Web required + regression tests", env("WEB_TESTS_OUTCOME")),
        ("Web production bundle build", env("WEB_BUILD_OUTCOME")),
        ("Android unit tests", env("ANDROID_TESTS_OUTCOME")),
        (apk_label, env("APK_OUTCOME")),
    ]


def write_step_summary(text: str) -> None:
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as handle:
        handle.write(text)


def run_pr_mode() -> int:
    number = env("PR_NUMBER")
    title = env("PR_TITLE") or f"Pull request #{number}"
    body = os.environ.get("PR_BODY") or ""
    url = env("PR_URL")
    author = env("PR_AUTHOR")
    head_ref = env("PR_HEAD_REF")
    head_sha = env("PR_HEAD_SHA")
    run_url = env("RUN_URL")

    files = read_lines(env("CHANGED_FILES"))
    commits = read_lines(env("COMMIT_SUBJECTS"))
    hints = extract_author_hints(body)
    checks = collect_checks("DEBUG")

    block = build_block(
        pr_number=number,
        pr_title=title,
        hints=hints,
        files=files,
        commits=commits,
        checks=checks,
        build_type="DEBUG",
    )

    Path("pending-docs.md").write_text(block + "\n", encoding="utf-8")

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    readme_status = "README pending update — actual README.md will be updated after merge."

    comment = "\n".join(
        [
            COMMENT_MARKER,
            f"## Pending documentation — PR #{number}",
            "",
            f"**README Status:** {readme_status}",
            "",
            "This pending summary is regenerated in place on every push to this pull request, so it "
            "is always replaced rather than duplicated. `README.md` is **not** modified while the "
            "pull request is open.",
            "",
            DOCS_START,
            block,
            DOCS_END,
            "",
            "<details>",
            "<summary>Pull request workflow facts</summary>",
            "",
            bullet_list(
                [
                    f"Pull request: #{number} — {title}",
                    f"Source branch: `{head_ref or 'unknown'}`",
                    f"Head commit: `{head_sha or 'unknown'}`",
                    f"Changed files: {len(files)}",
                    f"Commits: {len(commits)}",
                    f"Generated: {generated}",
                    f"Workflow run: {run_url or 'n/a'}",
                ]
            ),
            "",
            "</details>",
            "",
            f"{META_OPEN}",
            f"pr: {number}",
            f"title: {title}",
            f"head_sha: {head_sha}",
            f"generated_at: {generated}",
            META_CLOSE,
            "",
        ]
    )
    Path("pending-comment.md").write_text(comment, encoding="utf-8")
    Path("comment-payload.json").write_text(
        json.dumps({"body": comment}, ensure_ascii=False), encoding="utf-8"
    )

    write_step_summary(
        render_job_summary(
            mode="pr",
            build_type="DEBUG",
            title="MindMesh PR — Build + Test + DEBUG APK",
            subtitle=f"**Pull request:** #{number} — {title}"
            + (f" (@{author})" if author else ""),
            block=block,
            checks=checks,
            readme_status=readme_status,
            run_url=run_url,
            artifact_note=f"`mindmesh-debug-apk-pr{number}`"
            if any(label.endswith("APK build") and status == "success" for label, status in checks)
            else "",
        )
    )
    print(f"Pending documentation generated for PR #{number}.")
    return 0


def run_main_mode() -> int:
    sha = env("COMMIT_SHA")
    subject = env("COMMIT_SUBJECT") or "Push to main"
    author = env("COMMIT_AUTHOR")
    run_url = env("RUN_URL")
    commits = read_lines(env("COMMIT_SUBJECTS"))
    files = read_lines(env("CHANGED_FILES"))
    checks = collect_checks("RELEASE")
    markers = env("README_MARKERS") or "unknown"

    block = build_block(
        pr_number="",
        pr_title=subject,
        hints={},
        files=files,
        commits=commits,
        checks=checks,
        build_type="RELEASE",
    )

    readme_status = (
        "Merged pull request summaries are applied to README.md once, after merge, by the "
        "`MindMesh README — Update After Merge` workflow. "
        f"Managed release-notes section markers: {markers}."
    )

    write_step_summary(
        render_job_summary(
            mode="main",
            build_type="RELEASE",
            title="MindMesh Main — Build + Test + RELEASE APK",
            subtitle=f"**Branch:** main · **Commit:** `{sha or 'unknown'}`"
            + (f" · @{author}" if author else ""),
            block=block,
            checks=checks,
            readme_status=readme_status,
            run_url=run_url,
            artifact_note="`mindmesh-release-apk`"
            if any(label.endswith("APK build") and status == "success" for label, status in checks)
            else "",
        )
    )
    print("Release validation summary generated.")
    return 0


def main() -> int:
    mode = (env("MODE") or "pr").lower()
    if mode == "main":
        return run_main_mode()
    return run_pr_mode()


if __name__ == "__main__":
    raise SystemExit(main())
