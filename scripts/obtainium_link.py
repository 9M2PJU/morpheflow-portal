#!/usr/bin/env python3
"""
Generates foolproof Obtainium deep links and additionalSettings payloads for AutoMorph.
Compatible with Dart/Flutter RegExp engine (ECMAScript syntax without invalid flags).
"""

import argparse
import json
import os
import re
import urllib.parse


def to_case_insensitive_pattern(s: str) -> str:
    """Converts a string into an ECMAScript-compatible case-insensitive regex pattern."""
    if not s:
        return ""
    special = set(".*+?^$()|[]/\\")
    out = []
    for c in s:
        if c.isalpha():
            out.append(f"[{c.lower()}{c.upper()}]")
        elif c in special:
            out.append(f"\\{c}")
        else:
            out.append(c)
    return "".join(out)


def build_obtainium_payload(pkg: str, name: str, repo: str) -> dict:
    """Builds the complete Obtainium app payload."""
    author = repo.split("/")[0] if "/" in repo else "AutoMorph"
    ci_pkg = to_case_insensitive_pattern(pkg)
    ci_name = to_case_insensitive_pattern(name)

    settings = {
        "fallbackToOlderReleases": True,
        "filterReleaseTitlesByRegEx": f"({ci_pkg}|{ci_name})",
        "apkFilterRegEx": f"^{ci_pkg}_",
        "releaseTitleAsVersion": True,
        "versionExtractionRegEx": r"v?([0-9][0-9a-zA-Z._-]+)$",
        "matchGroupToUse": "1",
        "sortMethodChoice": "date",
    }

    return {
        "id": pkg,
        "url": f"https://github.com/{repo}",
        "author": author,
        "name": name,
        "preferredApkIndex": 0,
        "additionalSettings": json.dumps(settings),
    }


def get_deep_link(payload: dict) -> str:
    """Returns the obtainium://app/... URI."""
    encoded = urllib.parse.quote(json.dumps(payload))
    return f"obtainium://app/{encoded}"


def get_redirect_url(deep_link: str) -> str:
    """Returns the https://apps.obtainium.imranr.dev/redirect?... URL."""
    encoded = urllib.parse.quote(deep_link)
    return f"https://apps.obtainium.imranr.dev/redirect?r={encoded}"


def main():
    parser = argparse.ArgumentParser(description="Generate Obtainium App Payload and Links")
    parser.add_argument("--pkg", required=True, help="Android package name (e.g. com.sbs.train)")
    parser.add_argument("--name", default="", help="Application display name (e.g. MacroFactor Workouts)")
    parser.add_argument("--repo", default="wiwek13/AutoMorph", help="GitHub repo slug (owner/repo)")
    parser.add_argument("--format", choices=["redirect", "deep_link", "json"], default="redirect")

    args = parser.parse_args()
    name = args.name.strip()
    if not name:
        # Try resolving from catalog
        cat_file = "tools/automorph-data/state/morphe_catalog.json"
        if os.path.exists(cat_file):
            try:
                with open(cat_file) as f:
                    cat = json.load(f)
                    name = cat.get("store", {}).get(args.pkg, {}).get("name", "")
            except Exception:
                pass
    if not name:
        name = args.pkg

    payload = build_obtainium_payload(args.pkg, name, args.repo)
    deep_link = get_deep_link(payload)

    if args.format == "deep_link":
        print(deep_link)
    elif args.format == "json":
        print(json.dumps(payload, indent=2))
    else:
        print(get_redirect_url(deep_link))


if __name__ == "__main__":
    main()
