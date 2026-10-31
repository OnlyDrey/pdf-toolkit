"""Standard-library tests; Windows executes the real PowerShell 5.1 launcher."""
import importlib.util
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


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pdf release test ")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / "app").mkdir()
        (self.repo / "app/package.json").write_text('{"version":"1.2.0"}')

    def engine(self, *args):
        return release.Engine(release.parser().parse_args(["build", "--source-dir", str(self.repo), *args]))

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


if __name__ == "__main__":
    unittest.main()
