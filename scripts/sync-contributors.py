#!/usr/bin/env python3
"""Regenerate the contributor wall embedded in README.md (idempotent).

The wall is rendered from live GitHub data so that a brand new contributor
always changes the block:

  * ``repos/<owner>/<repo>/contributors`` -> accounts GitHub maps to commits
  * merged pull request authors          -> accounts the contributor list can
                                             miss (committer email not linked
                                             to an account, or a PR merged
                                             before the list is re-indexed)

Bots (dependabot, github-actions, Copilot, ...accounts ending in ``[bot]``)
are filtered out.

Only GitHub-rendered primitives are emitted (``align``, ``title``, ``width``,
``<strong>``, ``<sub>``) — GitHub's markdown sanitizer strips inline CSS, so a
style-free block renders identically everywhere.

Designed to run both locally and in CI
(``.github/workflows/update-contributors.yml``). Safe to run repeatedly: when
the roster is unchanged the README is not touched.

Usage:
  python scripts/sync-contributors.py [--repo owner/repo] [--readme PATH]
                                      [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_REPO = "Sudharsanselvaraj/Token-Print"
DEFAULT_README = Path(__file__).resolve().parent.parent / "README.md"
START_MARKER = "<!-- CONTRIBUTORS:START -->"
END_MARKER = "<!-- CONTRIBUTORS:END -->"
AVATAR_SIZE = 96
AVATAR_PX = 48
MAX_PAGES = 50


class Gh:
    """Thin wrapper around the `gh` CLI (works locally and in Actions)."""

    def __init__(self, repo: str):
        self.repo = repo

    def get(self, path: str, params: dict | None = None) -> object:
        cmd = ["--method", "GET", path]
        for key, value in (params or {}).items():
            cmd += ["-f", f"{key}={value}"]
        proc = subprocess.run(["gh", "api", *cmd], capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"GET {path} failed: {proc.stderr.strip()}")
        return json.loads(proc.stdout)

    @property
    def base(self) -> str:
        return f"repos/{self.repo}"


def paginate(gh: Gh, path: str, params: dict | None = None) -> list[dict]:
    """Return every item of a list endpoint, page by page."""
    items: list[dict] = []
    base_params = dict(params or {})
    for page in range(1, MAX_PAGES + 1):
        batch = gh.get(path, {**base_params, "per_page": 100, "page": page})
        if not isinstance(batch, list) or not batch:
            break
        items.extend(batch)
        if len(batch) < 100:
            break
    else:
        print(f"  [warn] stopped paginating {path} at {MAX_PAGES} pages")
    return items


def is_bot(login: str) -> bool:
    lowered = login.lower()
    if lowered.endswith("[bot]") or lowered.startswith("app/"):
        return True
    return lowered in {"copilot", "copilot-swe-agent", "dependabot", "github-actions"}


def collect(gh: Gh) -> list[dict]:
    """Union of commit contributors and merged PR authors, bots removed."""
    api: dict[str, int] = {}
    for entry in paginate(gh, f"{gh.base}/contributors"):
        login = entry.get("login") or ""
        if not login or entry.get("type") == "Bot" or is_bot(login):
            continue
        api[login] = int(entry.get("contributions") or 0)

    pr_counts: dict[str, int] = {}
    for pr in paginate(gh, f"{gh.base}/pulls", {"state": "closed"}):
        if not pr.get("merged_at"):
            continue
        login = ((pr.get("user") or {}).get("login")) or ""
        if not login or is_bot(login):
            continue
        pr_counts[login] = pr_counts.get(login, 0) + 1

    logins = {login for login in (*api, *pr_counts) if not is_bot(login)}
    # Commit contributions outrank a stray direct push; the merged PR count is
    # the fallback for accounts the contributor list has not indexed yet.
    entries = [
        {
            "login": login,
            "contributions": api[login] if login in api else pr_counts.get(login, 0),
            "from_api": login in api,
        }
        for login in logins
    ]
    entries.sort(key=lambda e: (-e["contributions"], e["login"].lower()))
    return entries


def render_block(repo: str, entries: list[dict]) -> str:
    """Build the README block. No inline CSS: GitHub strips it."""
    profile = f"https://github.com/{repo}"
    project = repo.split("/", 1)[-1]
    lines = [
        START_MARKER,
        '<div align="center">',
        f'  <a href="{profile}/graphs/contributors">'
        f"<strong>{len(entries)} contributors</strong></a>",
        '  <div align="center">',
    ]
    for entry in entries:
        login = entry["login"]
        lines.append(
            f'    <a href="https://github.com/{login}" title="{login}">'
            f'<img src="https://github.com/{login}.png?size={AVATAR_SIZE}" '
            f'width="{AVATAR_PX}" height="{AVATAR_PX}" alt="{login}" /></a>'
        )
    lines.append("  </div>")

    names = ", ".join(
        f'<a href="https://github.com/{entry["login"]}">{entry["login"]}</a>'
        for entry in entries
    )
    lines.append(f"  <sub>{names}</sub>")
    lines.append("  <br />")
    lines.append(f"  <sub>Every person who has contributed to {project}. Thank you.</sub>")
    lines.append("</div>")
    lines.append(END_MARKER)
    return "\n".join(lines)


def replace_block(readme: str, block: str) -> str:
    if START_MARKER not in readme or END_MARKER not in readme:
        raise SystemExit(f"README is missing {START_MARKER} / {END_MARKER}")
    pattern = re.compile(re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER), re.S)
    return pattern.sub(lambda _match: block, readme, count=1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--readme", type=Path, default=DEFAULT_README)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    gh = Gh(args.repo)
    entries = collect(gh)
    if not entries:
        print("no contributors returned; refusing to blank the README", file=sys.stderr)
        return 1

    block = render_block(args.repo, entries)
    original = args.readme.read_text(encoding="utf-8")
    updated = replace_block(original, block)

    from_api = sum(1 for entry in entries if entry["from_api"])
    print(f"contributor wall: {len(entries)} people ({from_api} from the "
          f"contributor list, {len(entries) - from_api} from merged PRs)")

    if updated == original:
        print("README contributor wall unchanged; nothing to write.")
        return 0
    if args.dry_run:
        print(updated[updated.index(START_MARKER):updated.index(END_MARKER) + len(END_MARKER)])
        print("[dry-run] README.md not written")
        return 0

    args.readme.write_text(updated, encoding="utf-8")
    print(f"README.md updated with {len(entries)} contributors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
