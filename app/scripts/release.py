#!/usr/bin/env python3
"""PDF Toolkit local release engine. Python 3.11+, standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

MIN_PYTHON = (3, 11)
PRODUCER = "pdf-toolkit-release"
SCHEMA_VERSION = 1
BASE = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
DEFAULT_REPO = Path(__file__).resolve().parents[2]


class ReleaseError(Exception):
    def __init__(self, message: str, code: int = 2):
        super().__init__(message)
        self.code = code


def validate_base(value: str) -> str:
    if not isinstance(value, str) or len(value) > 128 or not BASE.fullmatch(value):
        raise ReleaseError("Use a base version such as 1.2.0, without v or prerelease suffix")
    return value


def next_version(base: str, channel: str, tags: list[str]) -> str:
    validate_base(base)
    if channel not in ("beta", "production"):
        raise ReleaseError("Channel must be beta or production")
    if channel == "production":
        return base
    pattern = re.compile(rf"v?{re.escape(base)}-beta\.(0|[1-9][0-9]*)\Z")
    numbers = [int(match[1]) for tag in tags if isinstance(tag, str) and (match := pattern.fullmatch(tag))]
    version = f"{base}-beta.{max(numbers, default=0) + 1}"
    if len(version) > 128:
        raise ReleaseError("Calculated version exceeds the registry tag limit")
    return version


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def guarded_path(path: Path) -> Path:
    absolute = Path(os.path.abspath(path))
    if os.path.normcase(str(absolute)) != os.path.normcase(str(absolute.resolve())):
        raise ReleaseError(f"Refusing symlink/junction path: {path}", 5)
    return absolute


class Engine:
    def __init__(self, args):
        self.args = args
        self.repo = guarded_path(Path(args.source_dir or DEFAULT_REPO))
        self.app = self.repo / "app"
        if not (self.app / "package.json").is_file():
            raise ReleaseError("Source directory must contain app/package.json", 3)
        self.output = guarded_path(Path(args.output_dir).expanduser() if args.output_dir else self.app / "releases")
        protected = [self.repo / ".git", self.app / "src", self.app / "node_modules", self.repo / "docs", self.repo / ".github"]
        if self.output in [self.repo, self.app, *self.repo.parents] or any(self.output == p or p in self.output.parents for p in protected):
            raise ReleaseError("Output directory must not replace source or repository directories", 5)
        self.tools = {"python": platform.python_version()}

    def command(self, argv, *, cwd=None, capture=False, check=True, timeout=None, env=None):
        argv = [str(item) for item in argv]
        if self.args.dry_run:
            if not capture:
                print("DRY RUN argv=" + json.dumps(argv) + " cwd=" + str(cwd or self.app))
            return ""
        try:
            result = subprocess.run(argv, cwd=cwd or self.app, env=env, text=True, capture_output=capture, check=False, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ReleaseError(f"Could not run {Path(argv[0]).name}: {type(error).__name__}", 4) from error
        if check and result.returncode:
            raise ReleaseError(f"{Path(argv[0]).name} failed with exit code {result.returncode}", 4)
        return result.stdout.strip() if capture else result.returncode

    def executable(self, name):
        path = shutil.which(name)
        if path is None:
            if self.args.dry_run:
                return name
            raise ReleaseError(f"Missing prerequisite: {name}", 3)
        return path

    def git(self, *arguments, optional=False):
        try:
            return self.command([self.executable("git"), *arguments], cwd=self.repo, capture=True, timeout=15)
        except ReleaseError:
            if optional:
                return ""
            raise

    def source(self):
        commit = self.git("rev-parse", "HEAD") if not self.args.dry_run else "dry-run"
        if not self.args.dry_run and not re.fullmatch(r"[a-f0-9]{40}", commit):
            raise ReleaseError("A Git checkout with a full source SHA is required", 3)
        return {"commit": commit, "branch": self.git("branch", "--show-current", optional=True), "dirty": bool(self.git("status", "--porcelain", "--untracked-files=normal", optional=True))}

    def local_versions(self):
        versions = []
        if self.output.exists():
            for child in self.output.iterdir():
                match = re.fullmatch(r"pdf-toolkit-([0-9].*?)(?:\.zip(?:\.sha256)?)?", child.name)
                if match:
                    versions.append(match[1])
                if child.is_dir() and not child.is_symlink():
                    manifest = child / "release-manifest.json"
                    if manifest.is_file():
                        try:
                            data = json.loads(manifest.read_text(encoding="utf-8"))
                            if data.get("producer") == PRODUCER and isinstance(data.get("version"), str):
                                versions.append(data["version"])
                        except (OSError, ValueError):
                            pass  # The reserved directory name still prevents reuse.
        return versions

    def version_facts(self):
        tags = self.git("tag", "--list", optional=True).splitlines()
        remote_checked = False
        if not self.args.offline and not self.args.dry_run:
            environment = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="Never")
            try:
                data = self.command([self.executable("git"), "ls-remote", "--tags", "--refs", "origin"], cwd=self.repo, capture=True, timeout=10, env=environment)
                tags.extend(line.split("refs/tags/", 1)[1] for line in data.splitlines() if "refs/tags/" in line)
                remote_checked = True
            except ReleaseError:
                print("Remote tags unavailable; using local tags/manifests. Version is provisional.", file=sys.stderr)
        return tags + self.local_versions(), remote_checked

    def choose_version(self):
        channel = self.args.channel
        base = self.args.version
        if not channel:
            channel = self.prompt("Release channel [beta]: ", "beta")
        if not base:
            default = json.loads((self.app / "package.json").read_text(encoding="utf-8"))["version"].split("-")[0]
            base = self.prompt(f"Base version [{default}]: ", default)
        validate_base(base)
        if channel not in ("beta", "production"):
            raise ReleaseError("Channel must be beta or production")
        tags, checked = self.version_facts()
        version = next_version(base, channel, tags)
        if channel == "production" and any(tag in (version, "v" + version) for tag in tags):
            raise ReleaseError("Production version already exists in tags or local releases", 5)
        if channel == "production" and not self.args.dry_run:
            self.confirm(f"Create Production artifacts for {version}? [y/N]: ")
        return {"channel": channel, "base_version": base, "version": version, "tag": "v" + version, "provisional": not checked, "remote_tags_checked": checked}

    def prompt(self, text, default=None):
        if self.args.non_interactive or not sys.stdin.isatty():
            raise ReleaseError("Missing input in non-interactive mode; supply --channel and --version")
        try:
            answer = input(text).strip()
        except EOFError as error:
            raise ReleaseError("Input cancelled") from error
        return answer or default

    def confirm(self, text):
        if self.args.yes:
            return
        if self.args.non_interactive or not sys.stdin.isatty():
            raise ReleaseError("Confirmation required; explicitly pass --yes in non-interactive mode")
        if input(text).strip().lower() not in ("y", "yes"):
            raise ReleaseError("Operation cancelled")

    def npm(self, script):
        if not self.args.dry_run:
            version = self.command([self.executable("node"), "--version"], capture=True)
            match = re.fullmatch(r"v24\.(\d+)\.(\d+)", version)
            if not match or (int(match[1]), int(match[2])) < (13, 0):
                raise ReleaseError("Node 24.13+ (24.x LTS) is required", 3)
            self.tools["node"] = version
            if not (self.app / "node_modules").is_dir():
                raise ReleaseError("Dependencies missing: run npm ci inside app/ first", 3)
        environment = dict(os.environ, RELEASE_PYTHON=sys.executable)
        self.command([self.executable("npm"), "run", script], env=environment)

    def fingerprint(self, directory=None):
        roots = [directory] if directory else [self.app / "src", self.app / "public", *[self.app / name for name in ("package.json", "package-lock.json", "index.html", "vite.config.ts", "tailwind.config.ts", "postcss.config.js", "tsconfig.json", "tsconfig.node.json")]]
        files = sorted({file for root in roots if root.exists() for file in (root.rglob("*") if root.is_dir() else [root]) if file.is_file()})
        result = hashlib.sha256()
        for file in files:
            guarded_path(file)
            result.update(file.relative_to(self.app).as_posix().encode())
            result.update(b"\0" + digest(file).encode() + b"\0")
        return result.hexdigest()

    def build(self):
        self.npm("build")
        if not self.args.dry_run:
            work = self.app / ".release-work"
            guarded_path(work).mkdir(exist_ok=True)
            (work / "build.json").write_text(json.dumps({"inputs": self.fingerprint(), "dist": self.fingerprint(self.app / "dist")}), encoding="utf-8")

    def ensure_build(self):
        try:
            stamp = json.loads((self.app / ".release-work/build.json").read_text(encoding="utf-8"))
            if (self.app / "dist/index.html").is_file() and stamp == {"inputs": self.fingerprint(), "dist": self.fingerprint(self.app / "dist")}:
                return
        except (OSError, ValueError):
            pass
        self.build()

    def validate(self):
        if self.args.skip_tests:
            raise ReleaseError("test cannot be combined with --skip-tests")
        for script in ("typecheck", "lint", "format:check", "test:run", "test:release"):
            self.npm(script)
        self.command([sys.executable, "-m", "unittest", "discover", "-s", str(Path(__file__).parent), "-p", "test_release.py"])
        self.build()
        self.npm("test:e2e")
        if not self.args.dry_run:
            (self.app / ".release-work/validation.json").write_text(json.dumps({"inputs": self.fingerprint(), "status": "passed"}), encoding="utf-8")

    def clean(self):
        if (self.app / ".release-work/build.lock").exists():
            raise ReleaseError("A build lock exists; inspect the active/stale build before cleaning", 5)
        paths = [self.app / name for name in ("dist", "test-results", "playwright-report", ".release-work")]
        if self.output.exists():
            for child in self.output.iterdir():
                marker = child / ".release-owner.json"
                if child.is_dir() and not child.is_symlink() and marker.is_file():
                    try:
                        if json.loads(marker.read_text(encoding="utf-8")).get("producer") == PRODUCER:
                            paths.append(child)
                    except (OSError, ValueError):
                        pass
        paths = [guarded_path(path) for path in paths if path.exists()]
        for path in paths:
            if any(item.is_symlink() for item in path.rglob("*")):
                raise ReleaseError(f"Refusing to clean a directory containing symlinks: {path}", 5)
            if self.git("ls-files", "--", str(path), optional=True):
                raise ReleaseError(f"Refusing to remove tracked files: {path}", 5)
        if paths and not self.args.dry_run:
            self.confirm("Remove listed generated artifacts? [y/N]: ")
        for path in paths:
            print(("DRY RUN remove " if self.args.dry_run else "Remove ") + str(path))
            if not self.args.dry_run:
                shutil.rmtree(path)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("action", nargs="?", choices=("dev", "test", "build", "clean"))
    result.add_argument("--channel", choices=("beta", "production"))
    result.add_argument("--version", help="Base semantic version, e.g. 1.2.0")
    result.add_argument("--output-dir")
    result.add_argument("--source-dir", help="Repository checkout to build (defaults to this checkout)")
    result.add_argument("--offline", action="store_true", help="Never query remote Git tags")
    result.add_argument("--skip-tests", action="store_true")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--non-interactive", action="store_true")
    result.add_argument("--yes", action="store_true", help="Explicitly confirm Production artifacts or safe cleanup")
    result.add_argument("--resolve-version", action="store_true", help=argparse.SUPPRESS)
    return result


def main(argv=None):
    if sys.version_info < MIN_PYTHON:
        print("Python 3.11+ is required", file=sys.stderr)
        return 3
    try:
        args = parser().parse_args(argv)
        if args.resolve_version:
            data = json.load(sys.stdin)
            print(json.dumps({"version": next_version(data["base_version"], data["channel"], data["tags"])}))
            return 0
        if not args.action:
            raise ReleaseError("Choose an action; use --help for available commands")
        if args.version:
            validate_base(args.version)
        engine = Engine(args)
        {"dev": lambda: engine.npm("dev"), "test": engine.validate, "build": engine.build, "clean": engine.clean}[args.action]()
        return 0
    except ReleaseError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return error.code
    except (OSError, ValueError, KeyError) as error:
        print(f"ERROR: {type(error).__name__}: {error}", file=sys.stderr)
        return 5
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
