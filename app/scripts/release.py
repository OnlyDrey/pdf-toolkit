#!/usr/bin/env python3
"""PDF Toolkit local release engine. Python 3.11+, standard library only."""
from __future__ import annotations

import argparse
import contextlib
import csv
import io
import hashlib
import json
import os
import platform
import tempfile
import uuid
import re
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile
from datetime import datetime, timezone
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


def validate_release_version(base, channel, version):
    validate_base(base)
    if channel not in ("beta", "production") or not isinstance(version, str) or len(version) > 128:
        raise ReleaseError("Invalid release version")
    valid = version == base if channel == "production" else bool(re.fullmatch(re.escape(base) + r"-beta\.[1-9][0-9]*", version))
    if not valid:
        raise ReleaseError("Release version does not match its base and channel")
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
        protected = [self.repo / ".git", self.app / "src", self.app / "scripts", self.app / "tests", self.app / "public", self.app / "node_modules", self.app / "dist", self.app / ".release-work", self.app / "test-results", self.app / "playwright-report", self.repo / "docs", self.repo / ".github"]
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
        exclusions = [":(exclude)app/.release-work", ":(exclude)app/releases"]
        if self.repo in self.output.parents:
            exclusions.append(":(exclude)" + self.output.relative_to(self.repo).as_posix())
        return {"commit": commit, "branch": self.git("branch", "--show-current", optional=True), "dirty": bool(self.git("status", "--porcelain", "--untracked-files=normal", "--", ".", *exclusions, optional=True))}

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
        roots = [directory] if directory else [self.app / name for name in (
            "src", "public", "scripts", "tests", "package.json", "package-lock.json", "index.html",
            "vite.config.ts", "tailwind.config.ts", "postcss.config.js", "tsconfig.json", "tsconfig.node.json",
            "eslint.config.js", "playwright.config.ts", ".prettierignore", ".prettierrc.json",
            "Dockerfile", ".dockerignore", "nginx.conf", "compose.local.yaml")]
        if not directory:
            roots.append(self.repo / "compose.yaml")
        files = []
        for root in roots:
            if root.exists():
                guarded_path(root)
                for file in (root.rglob("*") if root.is_dir() else [root]):
                    guarded_path(file)
                    if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc":
                        files.append(file)
        files = sorted(set(files))
        result = hashlib.sha256()
        for file in files:
            guarded_path(file)
            result.update(file.relative_to(self.repo).as_posix().encode())
            result.update(b"\0" + digest(file).encode() + b"\0")
        return result.hexdigest()

    @contextlib.contextmanager
    def build_lock(self):
        if self.args.dry_run:
            yield
            return
        work = guarded_path(self.app / ".release-work")
        work.mkdir(exist_ok=True)
        lock = work / "build.lock"
        try:
            with lock.open("x", encoding="utf-8") as stream:
                stream.write(str(os.getpid()))
        except FileExistsError as error:
            raise ReleaseError("Another build (or a stale build.lock) exists; inspect it before retrying", 5) from error
        try:
            yield
        finally:
            lock.unlink(missing_ok=True)

    def build(self):
        with self.build_lock():
            original = self.fingerprint()
            self.npm("build")
            if not self.args.dry_run:
                if not (self.app / "dist/index.html").is_file():
                    raise ReleaseError("Build did not produce dist/index.html", 4)
                if original != self.fingerprint():
                    raise ReleaseError("Source inputs changed during build", 4)
                work = self.app / ".release-work"
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
        original = self.fingerprint()
        if self.args.skip_tests:
            raise ReleaseError("test cannot be combined with --skip-tests")
        for script in ("typecheck", "lint", "format:check", "test:run", "test:release"):
            self.npm(script)
        self.command([sys.executable, "-m", "unittest", "discover", "-s", str(Path(__file__).parent), "-p", "test_release.py"])
        self.build()
        self.npm("test:e2e")
        status = "passed-offline" if self.args.offline else "passed"
        if self.args.offline:
            print("Dependency network audit skipped in offline mode.")
        else:
            self.command([self.executable("npm"), "audit", "--audit-level=high"])
        if not self.args.dry_run:
            if original != self.fingerprint():
                raise ReleaseError("Source inputs changed during validation", 4)
            (self.app / ".release-work/validation.json").write_text(json.dumps({"inputs": original, "status": status}), encoding="utf-8")

    def clean(self):
        if (self.app / ".release-work/build.lock").exists():
            raise ReleaseError("A build lock exists; inspect the active/stale build before cleaning", 5)
        paths = [self.app / name for name in ("dist", "test-results", "playwright-report", ".release-work")]
        if self.output.exists():
            for child in self.output.iterdir():
                marker = child / ".release-owner.json"
                if child.is_dir() and not child.is_symlink() and marker.is_file():
                    try:
                        owner = json.loads(marker.read_text(encoding="utf-8"))
                        if owner.get("producer") != PRODUCER or child.name != "pdf-toolkit-" + owner.get("version", ""):
                            continue
                        manifest = child / "release-manifest.json"
                        allowed = {".release-owner.json", ".release-failure.json", "release-manifest.json", "SHA256SUMS"}
                        if manifest.is_file():
                            allowed.update(item["path"] for item in json.loads(manifest.read_text(encoding="utf-8")).get("artifacts", []))
                        if any(item.name not in allowed for item in child.iterdir()):
                            print("Preserve release directory containing unknown files: " + str(child))
                            continue
                        paths.append(child)
                        paths.extend(guarded_path(self.output / (child.name + suffix)) for suffix in (".zip", ".zip.sha256") if (self.output / (child.name + suffix)).is_file())
                    except (OSError, ValueError, KeyError):
                        pass
        paths = [guarded_path(path) for path in paths if path.exists()]
        for path in paths:
            if any(item.is_symlink() or guarded_path(item) != item.absolute() for item in path.rglob("*")):
                raise ReleaseError(f"Refusing to clean a directory containing symlinks: {path}", 5)
            if self.git("ls-files", "--", str(path), optional=not (self.repo / ".git").exists()):
                raise ReleaseError(f"Refusing to remove tracked files: {path}", 5)
        for path in paths:
            print("Generated path: " + str(path))
        if paths and not self.args.dry_run:
            self.confirm("Remove listed generated artifacts? [y/N]: ")
        for path in paths:
            print(("DRY RUN remove " if self.args.dry_run else "Remove ") + str(path))
            if not self.args.dry_run:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()



    def supplied_plan(self):
        if not self.args.release_plan:
            return None
        data = json.loads(Path(self.args.release_plan).read_text(encoding="utf-8"))
        channel, base, version = data.get("channel"), data.get("base_version"), data.get("version")
        validate_base(base)
        validate_release_version(base, channel, version)
        if data.get("tag") != "v" + version:
            raise ReleaseError("Invalid supplied release tag")
        if self.source()["commit"] != data.get("source_sha"):
            raise ReleaseError("Supplied plan does not match this checkout's exact source SHA")
        if channel == "production" and not self.args.dry_run:
            self.confirm(f"Create Production artifacts for {version}? [y/N]: ")
        return {"channel": channel, "base_version": base, "version": version, "tag": data["tag"], "provisional": False, "remote_tags_checked": False, "version_authority": "provided-plan"}

    def reserve(self):
        plan = self.supplied_plan() or self.choose_version()
        source = self.source()
        source["inputs_sha256"] = self.fingerprint()
        plan["source_sha"] = source["commit"]
        if plan["provisional"]:
            print("PROVISIONAL version: remote uniqueness is not guaranteed.", file=sys.stderr)
        if self.args.dry_run:
            print("DRY RUN release " + json.dumps(plan))
            return plan, source, self.output / ("pdf-toolkit-" + plan["version"])
        self.output.mkdir(parents=True, exist_ok=True)
        for _ in range(10):
            slot = self.output / ("pdf-toolkit-" + plan["version"])
            if any((self.output / (slot.name + suffix)).exists() for suffix in (".zip", ".zip.sha256")):
                collision = True
            else:
                try:
                    slot.mkdir()
                    collision = False
                except FileExistsError:
                    collision = True
            if not collision:
                marker = {"producer": PRODUCER, "schema_version": SCHEMA_VERSION, "version": plan["version"]}
                self.write_json(slot / ".release-owner.json", marker)
                return plan, source, slot
            if self.args.release_plan or plan["channel"] == "production":
                raise ReleaseError("Versioned artifact already exists; it will not be overwritten", 5)
            plan["version"] = next_version(plan["base_version"], "beta", [plan["version"], *self.local_versions()])
            plan["tag"] = "v" + plan["version"]
        raise ReleaseError("Repeated local version reservation collisions", 5)

    @staticmethod
    def write_json(path, data):
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(data, stream, indent=2, sort_keys=True)
            stream.write("\n")

    def tool_versions(self):
        for name, arguments in (("git", ["--version"]), ("node", ["--version"]), ("npm", ["--version"]), ("docker", ["--version"])):
            if name not in self.tools and shutil.which(name):
                try:
                    self.tools[name] = self.command([shutil.which(name), *arguments], capture=True, timeout=15)
                except ReleaseError:
                    self.tools[name] = "unavailable"
        return dict(self.tools)

    def validation_status(self):
        if self.args.skip_tests:
            return "skipped"
        try:
            stamp = json.loads((self.app / ".release-work/validation.json").read_text(encoding="utf-8"))
            if stamp["inputs"] == self.fingerprint():
                return stamp["status"]
        except (OSError, ValueError, KeyError):
            pass
        return "not-run"

    def manifest(self, plan, source, slot, docker=None, status="complete", error=None):
        files = []
        for path in sorted(slot.iterdir()):
            if path.is_file() and path.name not in (".release-owner.json", "release-manifest.json", "SHA256SUMS"):
                guarded_path(path)
                files.append({"path": path.name, "size": path.stat().st_size, "sha256": digest(path)})
        data = {"schema_version": SCHEMA_VERSION, "producer": PRODUCER, **plan, "status": status,
                "source": source, "created_utc": datetime.now(timezone.utc).isoformat(),
                "tools": self.tool_versions(), "build_platform": {"system": platform.system(), "machine": platform.machine(), "platform": platform.platform()},
                "docker": docker or {"platforms": [], "format": None},
                "validation": {"status": self.validation_status()}, "artifacts": files,
                "deterministic_archives": False}
        if error:
            data["error"] = str(error)
        self.write_json(slot / "release-manifest.json", data)
        return data

    def docker_build(self, plan, slot):
        docker = self.executable("docker")
        if self.app in self.output.parents and self.output != self.app / "releases":
            raise ReleaseError("Docker output must be outside app/ or in the ignored app/releases directory")
        if self.args.dry_run:
            native = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "amd64"
            self.command([docker, "buildx", "inspect", "--bootstrap"])
        else:
            information = self.command([docker, "info", "--format", "{{json .OSType}}|{{json .Architecture}}"], capture=True)
            system, architecture = [json.loads(part) for part in information.split("|", 1)]
            if system != "linux":
                raise ReleaseError("Linux containers are required; switch Docker Desktop to Linux containers", 3)
            native = {"x86_64": "amd64", "aarch64": "arm64"}.get(architecture, architecture)
        requested = sorted(set(value.strip() for value in (self.args.platforms or "linux/" + native).split(",")))
        if any(value not in ("linux/amd64", "linux/arm64") for value in requested):
            raise ReleaseError("Supported Docker platforms are linux/amd64 and linux/arm64")
        if not self.args.dry_run:
            inspection = self.command([docker, "buildx", "inspect", "--bootstrap"], capture=True)
            supported = [value.strip().rstrip("*") for line in inspection.splitlines() if line.strip().startswith("Platforms:") for value in line.split(":", 1)[1].split(",")]
            missing = [value for value in requested if not any(item == value or item.startswith(value + "/") for item in supported)]
            if missing:
                raise ReleaseError("Active Buildx builder cannot build: " + ", ".join(missing) + "; configure a capable builder/QEMU first", 3)
        kind = self.args.docker_format
        if self.args.verify_container and kind != "image":
            raise ReleaseError("--verify-container requires --docker-format image")
        if kind in ("image", "docker") and len(requested) != 1:
            raise ReleaseError("Docker load/archive supports one platform here; use --docker-format oci for multiple platforms")
        repository = self.args.docker_image
        if not re.fullmatch(r"[a-z0-9][a-z0-9._:/-]*", repository) or ":" in repository.rsplit("/", 1)[-1]:
            raise ReleaseError("--docker-image must be a repository name without a tag")
        tag = repository + ":" + plan["version"]
        if kind == "image" and not self.args.dry_run and tag in self.command([docker, "image", "ls", "--format", "{{.Repository}}:{{.Tag}}"], capture=True).splitlines():
            raise ReleaseError("Local versioned Docker image already exists; refusing overwrite", 5)
        command = [docker, "buildx", "build", "--platform", ",".join(requested), "--pull=false", "--push=false", "--tag", tag,
                   "--label", "org.opencontainers.image.revision=" + plan["source_sha"],
                   "--label", "org.opencontainers.image.version=" + plan["version"]]
        archive = None
        if kind == "image":
            command.extend(["--load", "--provenance=false"])
        else:
            archive = slot / ("pdf-toolkit-" + plan["version"] + ("-oci.tar" if kind == "oci" else "-docker.tar"))
            output = io.StringIO()
            csv.writer(output, lineterminator="").writerow(["type=" + kind, "dest=" + str(archive)])
            command.extend(["--output", output.getvalue(), "--provenance=" + ("mode=max" if kind == "oci" else "false")])
            if kind == "oci":
                command.append("--sbom=true")
        if self.args.offline:
            command.append("--network=none")
        if self.args.proxy_ca:
            certificate = Path(self.args.proxy_ca).absolute()
            if not certificate.is_file() and not self.args.dry_run:
                raise ReleaseError("Proxy CA file does not exist", 3)
            secret = io.StringIO()
            csv.writer(secret, lineterminator="").writerow(["id=proxy_ca", "src=" + str(certificate)])
            command.extend(["--secret", secret.getvalue()])
        command.append(str(self.app))
        self.command(command)
        if archive and not self.args.dry_run:
            self.check_docker_archive(archive, kind, requested)
        if kind == "image" and not self.args.dry_run:
            inspected = self.command([docker, "image", "inspect", tag, "--format", '{{.Architecture}}|{{.Os}}|{{.Config.User}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.version"}}'], capture=True).split("|")
            if inspected != [requested[0].split("/")[1], "linux", "101:101", plan["source_sha"], plan["version"]]:
                raise ReleaseError("Built image platform, non-root user or source/version labels mismatch", 5)
            if self.args.verify_container:
                self.verify_container(docker, tag)
        elif self.args.verify_container and self.args.dry_run:
            print("DRY RUN verify non-root, read-only container startup and health")
        return {"platforms": requested, "format": kind, "image": tag, "archive": archive.name if archive else None, "attestations": kind == "oci"}

    def verify_container(self, docker, tag):
        name = "pdf-toolkit-check-" + uuid.uuid4().hex[:12]
        started = False
        try:
            self.command([docker, "run", "-d", "--name", name, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,uid=101,gid=101", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--health-interval=2s", tag], capture=True)
            started = True
            for _ in range(60):
                state = self.command([docker, "inspect", "--format", "{{.State.Health.Status}}", name], capture=True)
                if state == "healthy":
                    self.command([docker, "exec", name, "sh", "-ec", "wget -Y off -qO- http://127.0.0.1:8080/healthz | grep -qx ok; wget -Y off -qO- http://127.0.0.1:8080/ | grep -q '<html'"])
                    return
                if state == "unhealthy":
                    break
                time.sleep(1)
            raise ReleaseError("Container failed health/startup verification", 4)
        finally:
            if started:
                self.command([docker, "rm", "-f", name], capture=True, check=False)

    @staticmethod
    def archive_platforms(archive):
        def blob(descriptor):
            value = descriptor["digest"]
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", value):
                raise ReleaseError("Invalid OCI digest", 5)
            member = archive.getmember("blobs/sha256/" + value[7:])
            data = archive.extractfile(member).read()
            if "sha256:" + hashlib.sha256(data).hexdigest() != value:
                raise ReleaseError("OCI digest mismatch", 5)
            return json.loads(data)
        platforms = {}
        def walk(index, depth=0):
            if depth > 5:
                raise ReleaseError("OCI index nesting exceeds limit", 5)
            for descriptor in index["manifests"]:
                if descriptor.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest":
                    continue
                manifest = blob(descriptor)
                if "manifests" in manifest:
                    walk(manifest, depth + 1)
                else:
                    config = blob(manifest["config"])
                    key = config["os"] + "/" + config["architecture"]
                    if key in platforms:
                        raise ReleaseError("Duplicate OCI platform", 5)
                    platforms[key] = descriptor
        walk(json.load(archive.extractfile("index.json")))
        return platforms

    @staticmethod
    def check_docker_archive(path, kind, requested):
        try:
            with tarfile.open(path, "r:*") as archive:
                names = archive.getnames()
                required = "index.json" if kind == "oci" else "manifest.json"
                if required not in names:
                    raise ReleaseError("Docker archive is missing " + required, 5)
                for member in archive.getmembers():
                    name = member.name.replace("\\", "/")
                    parts = [part for part in name.split("/") if part not in ("", ".")]
                    reserved = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", re.I)
                    if "\\" in member.name or ":" in name or name.startswith("/") or any(part == ".." or part.endswith((".", " ")) or reserved.fullmatch(part) for part in parts) or not (member.isfile() or member.isdir()):
                        raise ReleaseError("Unsafe Docker archive member", 5)
                if kind == "docker":
                    entries = json.load(archive.extractfile(required))
                    config = json.load(archive.extractfile(entries[0]["Config"]))
                    actual = {config["os"] + "/" + config["architecture"]}
                else:
                    actual = set(Engine.archive_platforms(archive))
                if actual != set(requested):
                    raise ReleaseError("Archive platforms do not match the request", 5)
        except (tarfile.TarError, KeyError, ValueError, TypeError) as error:
            raise ReleaseError("Invalid Docker archive", 5) from error

    def package_payloads(self, plan, source, slot):
        self.ensure_build()
        if self.args.dry_run:
            print("DRY RUN package frontend ZIP, Compose, notes, manifest, checksums and release ZIP at " + str(slot))
            return
        with self.build_lock():
            stamp = json.loads((self.app / ".release-work/build.json").read_text(encoding="utf-8"))
            if stamp != {"inputs": self.fingerprint(), "dist": self.fingerprint(self.app / "dist")}:
                raise ReleaseError("Build assets changed before packaging", 4)
            frontend = slot / ("pdf-toolkit-" + plan["version"] + "-frontend.zip")
            with zipfile.ZipFile(frontend, "x", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted((self.app / "dist").rglob("*")):
                    guarded_path(path)
                    if path.is_file():
                        archive.write(path, path.relative_to(self.app / "dist").as_posix())
            with zipfile.ZipFile(frontend) as archive:
                if "index.html" not in archive.namelist() or archive.testzip() is not None:
                    raise ReleaseError("Frontend ZIP integrity check failed", 5)
        compose = (self.repo / "compose.yaml").read_text(encoding="utf-8")
        old = "${PDF_TOOLKIT_IMAGE:-ghcr.io/onlydrey/pdf-toolkit:latest}"
        if old not in compose:
            raise ReleaseError("Deployment Compose image template changed; refusing an unpinned package", 5)
        with (slot / "compose.yaml").open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(compose.replace(old, "${PDF_TOOLKIT_IMAGE:-ghcr.io/onlydrey/pdf-toolkit:" + plan["version"] + "}"))
        notes = f"# PDF Toolkit {plan['version']}\n\nSource: {source['commit']} (dirty: {source['dirty']})\n\nChannel: {plan['channel']}\n\nVersion provisional: {plan['provisional']}\n\nPDF processing remains client-side. Crop is not redaction. See the deployment guide for limitations.\n"
        with (slot / "release-notes.md").open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(notes)

    def release(self):
        plan, source, slot = self.reserve()
        docker_data = None
        try:
            if self.args.action == "all" and not self.args.skip_tests:
                self.validate()
            if self.args.action == "docker" or self.args.with_docker:
                docker_data = self.docker_build(plan, slot)
            if self.args.action in ("all", "package"):
                self.package_payloads(plan, source, slot)
            if self.args.dry_run:
                return
            current = self.source()
            if current["commit"] != source["commit"] or current["dirty"] != source["dirty"] or self.fingerprint() != source["inputs_sha256"]:
                raise ReleaseError("Source changed during release preparation", 4)
            data = self.manifest(plan, source, slot, docker_data)
            paths = [slot / item["path"] for item in data["artifacts"]] + [slot / "release-manifest.json"]
            with (slot / "SHA256SUMS").open("x", encoding="utf-8", newline="\n") as stream:
                stream.writelines(f"{digest(path)}  {path.name}\n" for path in sorted(paths))
            self.verify_manifest(slot / "release-manifest.json")
            bundle = self.output / (slot.name + ".zip")
            with zipfile.ZipFile(bundle, "x", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(slot.iterdir()):
                    if path.is_file() and path.name != ".release-owner.json":
                        archive.write(path, slot.name + "/" + path.name)
            with zipfile.ZipFile(bundle) as archive:
                if archive.testzip() is not None:
                    raise ReleaseError("Release ZIP integrity check failed", 5)
            with (self.output / (bundle.name + ".sha256")).open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(f"{digest(bundle)}  {bundle.name}\n")
            print("Release manifest: " + str(slot / "release-manifest.json"))
            print("Release ZIP: " + str(bundle))
        except Exception as error:
            if not self.args.dry_run:
                try:
                    self.write_json(slot / ".release-failure.json", {"status": "failed", "error": str(error)})
                except OSError:
                    pass
            if not self.args.dry_run and not (slot / "release-manifest.json").exists():
                try:
                    self.manifest(plan, source, slot, docker_data, "failed", error)
                except Exception:
                    pass  # Never hide the original failure; the ownership reservation remains.
            raise

    @staticmethod
    def verify_manifest(path):
        path = guarded_path(Path(path))
        data = json.loads(path.read_text(encoding="utf-8"))
        if (path.parent / ".release-failure.json").exists():
            raise ReleaseError("Release has a recorded preparation failure", 5)
        if data.get("producer") != PRODUCER or data.get("schema_version") != SCHEMA_VERSION or data.get("status") != "complete":
            raise ReleaseError("Not a complete supported release manifest", 5)
        try:
            validate_release_version(data["base_version"], data["channel"], data["version"])
            if data["tag"] != "v" + data["version"] or not re.fullmatch(r"[a-f0-9]{40}", data["source"]["commit"]) or not re.fullmatch(r"[a-f0-9]{64}", data["source"]["inputs_sha256"]) or not isinstance(data["source"]["dirty"], bool):
                raise ReleaseError("Invalid manifest source/tag")
        except (ReleaseError, KeyError, TypeError) as error:
            raise ReleaseError("Invalid release manifest metadata", 5) from error
        expected = {}
        for item in data["artifacts"]:
            name = item["path"]
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name) or name in expected or name in ("release-manifest.json", "SHA256SUMS"):
                raise ReleaseError("Unsafe manifest artifact path", 5)
            artifact = guarded_path(path.parent / name)
            if artifact.stat().st_size != item["size"] or digest(artifact) != item["sha256"]:
                raise ReleaseError("Artifact checksum mismatch: " + name, 5)
            expected[name] = item["sha256"]
        expected[path.name] = digest(path)
        lines = (path.parent / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
        listed = {}
        for line in lines:
            checksum, name = line.split("  ", 1)
            if not re.fullmatch(r"[a-f0-9]{64}", checksum) or name in listed:
                raise ReleaseError("Invalid checksum list", 5)
            listed[name] = checksum
        if listed != expected:
            raise ReleaseError("Checksum list does not match release manifest", 5)
        return data

    def publish(self):
        if not self.args.authorize_publish or not self.args.manifest:
            raise ReleaseError("Optional publication requires --authorize-publish and --manifest")
        if self.args.dry_run:
            print("DRY RUN: verify assets and upload only to an existing approved GitHub Release; no tags/images/releases are created")
            return
        data = self.verify_manifest(self.args.manifest)
        if data["source"]["dirty"] or data["validation"]["status"] != "passed":
            raise ReleaseError("Publication requires a clean source and a fully validated package", 6)
        if self.source()["commit"] != data["source"]["commit"] or self.source()["dirty"] or self.fingerprint() != data["source"]["inputs_sha256"]:
            raise ReleaseError("Current clean checkout must match the packaged source commit", 6)
        self.confirm(f"Upload verified assets to existing GitHub Release {data['tag']}? [y/N]: ")
        gh = self.executable("gh")
        repository = "OnlyDrey/pdf-toolkit"
        def api(path):
            try:
                return json.loads(self.command([gh, "api", "repos/" + repository + path], capture=True))
            except (ReleaseError, ValueError) as error:
                raise ReleaseError("Authenticated GitHub verification failed; nothing uploaded", 6) from error
        branch = "work" if data["channel"] == "beta" else "main"
        if api("/git/ref/heads/" + branch)["object"]["sha"] != data["source"]["commit"]:
            raise ReleaseError("Published source must still match the channel branch HEAD", 6)
        ref = api("/git/ref/tags/" + data["tag"])["object"]
        for _ in range(5):
            if ref["type"] != "tag":
                break
            ref = api("/git/tags/" + ref["sha"])["object"]
        if ref["type"] != "commit" or ref["sha"] != data["source"]["commit"]:
            raise ReleaseError("Existing release tag points at another commit", 6)
        remote = api("/releases/tags/" + data["tag"])
        if remote["draft"] or remote["prerelease"] != (data["channel"] == "beta"):
            raise ReleaseError("An existing published release with matching channel is required", 6)
        folder = Path(self.args.manifest).resolve().parent
        files = [folder / item["path"] for item in data["artifacts"]] + [folder / "release-manifest.json", folder / "SHA256SUMS"]
        existing = {asset["name"] for asset in remote["assets"]}
        if existing.intersection(path.name for path in files):
            raise ReleaseError("Remote assets already exist; refusing to overwrite", 6)
        self.scan_archives(data, folder)
        try:
            self.command([gh, "release", "upload", data["tag"], *files, "--repo", repository])
        except ReleaseError as error:
            raise ReleaseError("Asset publication failed; inspect the remote release before retrying (no overwrite permitted)", 6) from error


    def scan_archives(self, data, folder):
        archives = [folder / item["path"] for item in data["artifacts"] if item["path"].endswith(("-docker.tar", "-oci.tar"))]
        if not archives:
            return
        trivy = self.executable("trivy")
        for path in archives:
            kind = "oci" if path.name.endswith("-oci.tar") else "docker"
            self.check_docker_archive(path, kind, data["docker"]["platforms"])
            targets = []
            with tempfile.TemporaryDirectory(prefix="pdf-release-scan-") as temp:
                stage = Path(temp)
                if kind == "docker":
                    targets.append(path)
                else:
                    with tarfile.open(path) as archive:
                        platforms = self.archive_platforms(archive)
                        for member in archive.getmembers():
                            target = stage / member.name
                            if member.isdir():
                                target.mkdir(parents=True, exist_ok=True)
                            else:
                                target.parent.mkdir(parents=True, exist_ok=True)
                                with target.open("xb") as output:
                                    shutil.copyfileobj(archive.extractfile(member), output)
                    # Rewrite only the temporary layout index for each individual platform.
                    for platform_name, descriptor in platforms.items():
                        (stage / "index.json").write_text(json.dumps({"schemaVersion": 2, "manifests": [descriptor]}), encoding="utf-8")
                        self.command([trivy, "image", "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "--exit-code", "1", "--input", str(stage)])
                for target in targets:
                    self.command([trivy, "image", "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "--exit-code", "1", "--input", str(target)])


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("action", nargs="?", choices=("dev", "test", "build", "docker", "package", "all", "clean", "publish"))
    result.add_argument("--channel", choices=("beta", "production"))
    result.add_argument("--version", help="Base semantic version, e.g. 1.2.0")
    result.add_argument("--output-dir")
    result.add_argument("--source-dir", help="Repository checkout to build (defaults to this checkout)")
    result.add_argument("--offline", action="store_true", help="Never query remote Git tags")
    result.add_argument("--skip-tests", action="store_true")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--non-interactive", action="store_true")
    result.add_argument("--yes", action="store_true", help="Explicitly confirm Production artifacts or safe cleanup")
    result.add_argument("--platforms", help="Comma-separated Docker platforms; default is the native Linux architecture")
    result.add_argument("--docker-format", choices=("image", "docker", "oci"), default="image")
    result.add_argument("--docker-image", default="pdf-toolkit", help="Local Docker repository without a tag; never pushed")
    result.add_argument("--verify-container", action="store_true", help="Run non-root/read-only health checks after a loaded image build")
    result.add_argument("--with-docker", action="store_true", help="Include an optional Docker build/export in package/all")
    result.add_argument("--proxy-ca", help="Optional public proxy CA mounted as a BuildKit secret")
    result.add_argument("--release-plan", help="Use an externally reserved plan with an exact checkout SHA (CI integration)")
    result.add_argument("--manifest", help="Complete manifest to verify for optional asset publication")
    result.add_argument("--authorize-publish", action="store_true", help="Explicitly allow asset upload to an already published GitHub Release")
    result.add_argument("--resolve-version", action="store_true", help=argparse.SUPPRESS)
    return result


def main(argv=None):
    if sys.version_info < MIN_PYTHON:
        print("Python 3.11+ is required", file=sys.stderr)
        return 3
    try:
        args = parser().parse_args(argv)
        if args.resolve_version:
            try:
                data = json.load(sys.stdin)
                version = next_version(data["base_version"], data["channel"], data["tags"])
            except (ValueError, KeyError, TypeError) as error:
                raise ReleaseError("Invalid version resolver request") from error
            print(json.dumps({"version": version}))
            return 0
        if not args.action:
            raise ReleaseError("Choose an action; use --help for available commands")
        if args.version:
            validate_base(args.version)
        engine = Engine(args)
        {"dev": lambda: engine.npm("dev"), "test": engine.validate, "build": engine.build, "docker": engine.release, "package": engine.release, "all": engine.release, "clean": engine.clean, "publish": engine.publish}[args.action]()
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
