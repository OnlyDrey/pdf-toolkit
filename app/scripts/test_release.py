"""Standard-library tests; Windows executes the real PowerShell 5.1 launcher."""
import importlib.util
import io
import tarfile
import zipfile
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("release.py")
spec = importlib.util.spec_from_file_location("release_engine", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class EngineFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pdf release test ")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / "app").mkdir()
        (self.repo / "app/package.json").write_text('{"version":"1.2.0"}')

    def engine(self, *args):
        return release.Engine(release.parser().parse_args(["build", "--source-dir", str(self.repo), *args]))



class EngineTests(EngineFixture):
    def test_version_calculation(self):
        self.assertEqual(release.next_version("1.2.0", "beta", []), "1.2.0-beta.1")
        self.assertEqual(release.next_version("1.2.0", "beta", ["v1.2.0-beta.9", "1.2.0-beta.11", "v1.2.1-beta.99"]), "1.2.0-beta.12")
        self.assertEqual(release.next_version("1.2.0", "beta", ["v1.2.0-beta.9007199254740993"]), "1.2.0-beta.9007199254740994")
        self.assertEqual(release.next_version("1.2.0", "production", []), "1.2.0")

    def test_invalid_versions(self):
        for value in ["v1.2.0", "01.2.0", "1.2.0-beta.1", "1.2.0\n", "1.2.0+build"]:
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.validate_base(value)

    def test_offline_does_not_query_remote(self):
        engine = self.engine("--offline")
        with patch.object(engine, "git", return_value="v1.2.0-beta.3"), patch.object(engine, "command", side_effect=AssertionError("network")):
            tags, checked = engine.version_facts()
        self.assertEqual(tags, ["v1.2.0-beta.3"])
        self.assertFalse(checked)

    def test_remote_failure_is_provisional(self):
        engine = self.engine()
        with patch.object(engine, "git", return_value=""), patch.object(engine, "executable", return_value="git"), patch.object(engine, "command", side_effect=release.ReleaseError("unavailable", 4)):
            self.assertEqual(engine.version_facts(), ([], False))

    def test_local_manifests_and_partial_slots_reserve_numbers(self):
        engine = self.engine()
        slot = engine.output / "pdf-toolkit-1.2.0-beta.7"
        slot.mkdir(parents=True)
        (slot / "release-manifest.json").write_text(json.dumps({"producer": release.PRODUCER, "version": "1.2.0-beta.7"}))
        self.assertEqual(release.next_version("1.2.0", "beta", engine.local_versions()), "1.2.0-beta.8")

    def test_production_requires_confirmation(self):
        engine = self.engine("--channel", "production", "--version", "1.2.0", "--non-interactive", "--offline")
        with patch.object(engine, "version_facts", return_value=([], False)), self.assertRaises(release.ReleaseError):
            engine.choose_version()

    def test_missing_noninteractive_input_fails(self):
        with self.assertRaises(release.ReleaseError):
            self.engine("--non-interactive").choose_version()

    def test_protected_output_directory_rejected(self):
        with self.assertRaises(release.ReleaseError):
            self.engine("--output-dir", str(self.repo))

    def test_cleanup_preserves_unknown_output(self):
        engine = self.engine("--yes")
        engine.output.mkdir()
        unknown = engine.output / "my-notes.txt"
        unknown.write_text("keep")
        with patch.object(engine, "git", return_value=""):
            engine.clean()
        self.assertEqual(unknown.read_text(), "keep")

    def test_dry_run_does_not_create_files(self):
        engine = self.engine("--dry-run")
        engine.build()
        self.assertFalse((self.repo / "app/.release-work").exists())

    def test_resolver_cli_matches_library(self):
        data = {"channel": "beta", "base_version": "1.2.0", "tags": ["v1.2.0-beta.5"]}
        result = subprocess.run([sys.executable, str(SCRIPT), "--resolve-version"], input=json.dumps(data), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["version"], "1.2.0-beta.6")

    @unittest.skipIf(os.name == "nt" or not shutil.which("bash"), "Linux Bash test")
    def test_bash_forwards_arguments_and_exit_codes(self):
        launcher = SCRIPT.with_suffix(".sh")
        result = subprocess.run(["bash", str(launcher), "build", "--dry-run", "--non-interactive", "--source-dir", str(self.repo)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DRY RUN", result.stdout)
        bad = subprocess.run(["bash", str(launcher), "unknown-action"], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 2)

    @unittest.skipUnless(os.name == "nt", "Requires actual Windows PowerShell 5.1")
    def test_windows_powershell_51_forwards_arguments_and_exit_codes(self):
        powershell = shutil.which("powershell.exe")
        self.assertIsNotNone(powershell)
        version = subprocess.check_output([powershell, "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], text=True)
        self.assertTrue(version.strip().startswith("5.1."), version)
        command = [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT.with_suffix(".ps1"))]
        result = subprocess.run([*command, "build", "--dry-run", "--non-interactive", "--source-dir", str(self.repo)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DRY RUN", result.stdout)
        self.assertEqual(subprocess.run([*command, "invalid"], capture_output=True).returncode, 2)


class PackagingTests(EngineFixture):
    def package_engine(self, **changes):
        engine = self.engine("--channel", "beta", "--version", "1.2.0", "--offline", "--non-interactive", "--yes")
        engine.args.action = "package"
        for key, value in changes.items():
            setattr(engine.args, key, value)
        (self.repo / "compose.yaml").write_text("services:\n  pdf-toolkit:\n    image: ${PDF_TOOLKIT_IMAGE:-ghcr.io/onlydrey/pdf-toolkit:latest}\n")
        dist = self.repo / "app/dist"
        dist.mkdir(exist_ok=True)
        (dist / "index.html").write_text("<html>private frontend</html>")
        (dist / "asset.js").write_text("console.log('local')")
        engine.source = lambda: {"commit": "a" * 40, "branch": "work", "dirty": False}
        engine.git = lambda *args, **kwargs: ""
        engine.tool_versions = lambda: {"python": "3.11.0", "node": "v24.19.0"}
        work = engine.app / ".release-work"
        work.mkdir(exist_ok=True)
        (work / "build.json").write_text(json.dumps({"inputs": engine.fingerprint(), "dist": engine.fingerprint(dist)}))
        engine.ensure_build = lambda: None
        return engine

    def test_package_archive_manifest_and_checksums(self):
        engine = self.package_engine()
        engine.release()
        folder = engine.output / "pdf-toolkit-1.2.0-beta.1"
        data = engine.verify_manifest(folder / "release-manifest.json")
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["source"]["commit"], "a" * 40)
        self.assertTrue(data["provisional"])
        self.assertFalse(data["deterministic_archives"])
        self.assertIn(":1.2.0-beta.1", (folder / "compose.yaml").read_text())
        with zipfile.ZipFile(folder / "pdf-toolkit-1.2.0-beta.1-frontend.zip") as archive:
            self.assertIn("index.html", archive.namelist())
            self.assertIsNone(archive.testzip())
        bundle = engine.output / "pdf-toolkit-1.2.0-beta.1.zip"
        with zipfile.ZipFile(bundle) as archive:
            self.assertIn("pdf-toolkit-1.2.0-beta.1/release-manifest.json", archive.namelist())
            self.assertIsNone(archive.testzip())
        self.assertEqual((engine.output / (bundle.name + ".sha256")).read_text().split()[0], release.digest(bundle))

    def test_tampered_artifact_and_checksum_list_fail(self):
        engine = self.package_engine()
        engine.release()
        folder = engine.output / "pdf-toolkit-1.2.0-beta.1"
        (folder / "compose.yaml").write_text("tampered")
        with self.assertRaises(release.ReleaseError):
            engine.verify_manifest(folder / "release-manifest.json")

    def test_beta_reservation_never_overwrites_prior_outputs(self):
        engine = self.package_engine()
        engine.release()
        first = engine.output / "pdf-toolkit-1.2.0-beta.1/release-manifest.json"
        original = first.read_bytes()
        engine.release()
        self.assertEqual(first.read_bytes(), original)
        self.assertTrue((engine.output / "pdf-toolkit-1.2.0-beta.2/release-manifest.json").exists())

    def test_production_collision_is_rejected(self):
        engine = self.package_engine(channel="production")
        engine.release()
        with self.assertRaises(release.ReleaseError) as result:
            engine.release()
        self.assertEqual(result.exception.code, 5)

    def test_failure_is_recorded_and_number_not_reused(self):
        engine = self.package_engine()
        engine.ensure_build = lambda: (_ for _ in ()).throw(release.ReleaseError("build failed", 4))
        with self.assertRaises(release.ReleaseError):
            engine.release()
        folder = engine.output / "pdf-toolkit-1.2.0-beta.1"
        self.assertEqual(json.loads((folder / "release-manifest.json").read_text())["status"], "failed")
        self.assertTrue((folder / ".release-failure.json").exists())
        self.assertEqual(engine.reserve()[0]["version"], "1.2.0-beta.2")

    def test_changed_source_aborts_packaging(self):
        engine = self.package_engine()
        calls = []
        def source():
            calls.append(1)
            return {"commit": ("a" if len(calls) == 1 else "b") * 40, "branch": "work", "dirty": False}
        engine.source = source
        with self.assertRaises(release.ReleaseError) as result:
            engine.release()
        self.assertEqual(result.exception.code, 4)

    def test_unknown_files_in_owned_release_are_preserved_by_clean(self):
        engine = self.package_engine()
        engine.release()
        folder = engine.output / "pdf-toolkit-1.2.0-beta.1"
        (folder / "personal-notes.txt").write_text("keep")
        engine.clean()
        self.assertTrue((folder / "personal-notes.txt").exists())

    def test_clean_removes_only_owned_artifacts_and_bundles(self):
        engine = self.package_engine()
        engine.release()
        (engine.output / "unknown.zip").write_text("keep")
        engine.clean()
        self.assertFalse((engine.output / "pdf-toolkit-1.2.0-beta.1").exists())
        self.assertFalse((engine.output / "pdf-toolkit-1.2.0-beta.1.zip").exists())
        self.assertTrue((engine.output / "unknown.zip").exists())

    def test_build_lock_refuses_concurrent_build(self):
        engine = self.package_engine()
        with engine.build_lock():
            with self.assertRaises(release.ReleaseError):
                with engine.build_lock():
                    pass
        self.assertFalse((engine.app / ".release-work/build.lock").exists())

    def test_build_stamp_avoids_a_redundant_frontend_build(self):
        engine = self.engine()
        dist = engine.app / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<html/>")
        with patch.object(engine, "npm") as npm:
            engine.build()
            engine.ensure_build()
            self.assertEqual(npm.call_count, 1)
            (dist / "index.html").write_text("changed")
            engine.ensure_build()
            self.assertEqual(npm.call_count, 2)

    def test_cleanup_rejects_symlink_without_following_it(self):
        engine = self.package_engine()
        outside = self.repo / "outside.txt"
        outside.write_text("keep")
        try:
            (engine.app / "dist/link").symlink_to(outside)
        except OSError:
            self.skipTest("Host does not allow symlink creation")
        with self.assertRaises(release.ReleaseError):
            engine.clean()
        self.assertEqual(outside.read_text(), "keep")

    def test_docker_builder_platforms_and_no_push(self):
        engine = self.package_engine(platforms="linux/amd64,linux/arm64", docker_format="oci")
        commands = []
        def command(argv, **kwargs):
            commands.append([str(item) for item in argv])
            if "info" in argv:
                return '\"linux\"|\"x86_64\"'
            if "inspect" in argv:
                return "Platforms: linux/amd64, linux/arm64/v8"
            return 0
        engine.command = command
        engine.executable = lambda name: name
        plan = {"version": "1.2.0-beta.1", "source_sha": "a" * 40}
        with patch.object(engine, "check_docker_archive"):
            data = engine.docker_build(plan, engine.output)
        build = next(cmd for cmd in commands if cmd[:3] == ["docker", "buildx", "build"])
        self.assertIn("--push=false", build)
        self.assertIn("--sbom=true", build)
        self.assertEqual(data["platforms"], ["linux/amd64", "linux/arm64"])

    def test_unsupported_platform_is_reported_without_build(self):
        engine = self.package_engine(platforms="linux/arm64")
        engine.executable = lambda name: name
        engine.command = lambda argv, **kwargs: '\"linux\"|\"x86_64\"' if "info" in argv else "Platforms: linux/amd64"
        with self.assertRaises(release.ReleaseError) as result:
            engine.docker_build({"version": "1.2.0-beta.1"}, engine.output)
        self.assertEqual(result.exception.code, 3)

    def test_multi_platform_docker_load_is_rejected(self):
        engine = self.package_engine(platforms="linux/amd64,linux/arm64", dry_run=True)
        with self.assertRaises(release.ReleaseError):
            engine.docker_build({"version": "1.2.0-beta.1"}, engine.output)

    def test_archive_path_traversal_is_rejected_without_extracting(self):
        path = self.repo / "bad.tar"
        with tarfile.open(path, "w") as archive:
            for name, body in [("manifest.json", b"[]"), ("../escape", b"bad")]:
                info = tarfile.TarInfo(name)
                info.size = len(body)
                archive.addfile(info, io.BytesIO(body))
        with self.assertRaises(release.ReleaseError):
            release.Engine.check_docker_archive(path, "docker", ["linux/amd64"])
        self.assertFalse((self.repo.parent / "escape").exists())

    def test_oci_archive_platform_graph_and_integrity(self):
        blobs = {}
        def blob(data):
            content = json.dumps(data).encode()
            checksum = release.hashlib.sha256(content).hexdigest()
            blobs["blobs/sha256/" + checksum] = content
            return {"digest": "sha256:" + checksum, "size": len(content)}
        descriptors = []
        for architecture in ("amd64", "arm64"):
            config = blob({"os": "linux", "architecture": architecture})
            descriptors.append(blob({"schemaVersion": 2, "config": config, "layers": []}))
        blobs["index.json"] = json.dumps({"schemaVersion": 2, "manifests": descriptors}).encode()
        path = self.repo / "images.tar"
        def write():
            with tarfile.open(path, "w") as archive:
                for name, content in blobs.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(content)
                    archive.addfile(info, io.BytesIO(content))
        write()
        release.Engine.check_docker_archive(path, "oci", ["linux/amd64", "linux/arm64"])
        with self.assertRaises(release.ReleaseError):
            release.Engine.check_docker_archive(path, "oci", ["linux/amd64"])
        name = next(name for name in blobs if name.startswith("blobs/"))
        blobs[name] = b"{}"
        write()
        with self.assertRaises(release.ReleaseError):
            release.Engine.check_docker_archive(path, "oci", ["linux/amd64", "linux/arm64"])

    def test_optional_publishing_requires_explicit_authorization(self):
        engine = self.package_engine()
        with patch.object(engine, "command", side_effect=AssertionError("publication")):
            with self.assertRaises(release.ReleaseError):
                engine.publish()

    def test_optional_asset_upload_never_creates_tags_releases_or_clobbers(self):
        engine = self.package_engine()
        engine.release()
        engine.args.authorize_publish = True
        engine.args.manifest = str(engine.output / "pdf-toolkit-1.2.0-beta.1/release-manifest.json")
        engine.validation_status = lambda: "passed"
        # The package was intentionally not validated; rewrite a fresh separate package with a passed stamp.
        engine.release()
        engine.args.manifest = str(engine.output / "pdf-toolkit-1.2.0-beta.2/release-manifest.json")
        calls = []
        def command(argv, **kwargs):
            calls.append([str(item) for item in argv])
            if argv[1] == "api":
                if "/releases/tags/" in argv[2]:
                    return json.dumps({"draft": False, "prerelease": True, "assets": []})
                return json.dumps({"object": {"type": "commit", "sha": "a" * 40}})
            return 0
        engine.command = command
        engine.executable = lambda name: name
        engine.publish()
        upload = next(cmd for cmd in calls if cmd[1:3] == ["release", "upload"])
        self.assertNotIn("--clobber", upload)
        self.assertFalse(any("create" in cmd or "push" in cmd for cmd in calls))


if __name__ == "__main__":
    unittest.main()
