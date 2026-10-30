import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner", Path(__file__).parents[1] / "scripts/run.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ActionTests(unittest.TestCase):
    def test_defaults_leave_cli_configuration_intact(self):
        self.assertEqual(runner.arguments({}), ["run", "--", "."])

    def test_all_flags_and_metadata(self):
        metadata = (Path(__file__).parents[1] / "action.yml").read_text()
        for name, kind in runner.FLAGS.items():
            self.assertIn(f"  {name}:\n", metadata)
            value = "false" if kind == "bool" else "example"
            self.assertIn(f"--{name}={value}", runner.arguments({name: value}))

    def test_arguments_are_literal_and_repeatable(self):
        self.assertEqual(runner.arguments({
            "exclude-files": "a{1,2}\n$(touch /tmp/never)",
            "quiet": "false", "output": "a b.json", "path": "-module",
        }), ["run", "--quiet=false", "--output=a b.json", "--exclude-files=a{1,2}",
             "--exclude-files=$(touch /tmp/never)", "--", "-module"])

    def test_invalid_boolean(self):
        with self.assertRaises(ValueError):
            runner.arguments({"json": "yes"})

    def test_release_resolution(self):
        with patch.object(runner, "fetch", return_value=b'{"tag_name":"v0.8.0"}'):
            self.assertEqual(runner.release_tag("latest"), "v0.8.0")
        for value in ["0.8.0", "v0.8.0"]:
            self.assertEqual(runner.release_tag(value), "v0.8.0")
        with self.assertRaises(ValueError):
            runner.release_tag("../../evil")

    def test_platforms(self):
        for system, machine, suffix in [("Linux", "x86_64", "linux_amd64"),
                                         ("Darwin", "arm64", "darwin_arm64"),
                                         ("Windows", "AMD64", "windows_amd64")]:
            self.assertEqual(runner.asset_name("v0.8.0", system, machine), f"imp_0.8.0_{suffix}.tar.gz")
        with self.assertRaises(ValueError):
            runner.asset_name("v0.8.0", "Unknown", "x86_64")

    def archive(self, symlink=False):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as tar:
            entry = tarfile.TarInfo("imp")
            if symlink:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "/etc/passwd"
            else:
                entry.size = 4
            tar.addfile(entry, None if symlink else io.BytesIO(b"test"))
        return data.getvalue()

    def install(self, archive, checksum):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(runner.platform, "system", return_value="Linux"), \
             patch.object(runner.platform, "machine", return_value="x86_64"), \
             patch.object(runner, "fetch", side_effect=[
                 f"{checksum}  imp_0.8.0_linux_amd64.tar.gz\n".encode(), archive]):
            return runner.install("v0.8.0", directory).read_bytes()

    def test_verified_install(self):
        archive = self.archive()
        self.assertEqual(self.install(archive, hashlib.sha256(archive).hexdigest()), b"test")

    def test_corrupt_archive_rejected(self):
        with self.assertRaisesRegex(ValueError, "Checksum"):
            self.install(self.archive(), "0" * 64)

    def test_symlink_rejected(self):
        archive = self.archive(symlink=True)
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.install(archive, hashlib.sha256(archive).hexdigest())

    def test_cli_status_propagated(self):
        with patch.dict(os.environ, {"IMP_ACTION_INPUTS": json.dumps({})}), \
             patch.object(runner, "release_tag", return_value="v0.8.0"), \
             patch.object(runner, "install", return_value=Path("/tmp/imp")), \
             patch.object(runner.subprocess, "run") as run:
            run.return_value.returncode = 3
            self.assertEqual(runner.main(), 3)
            run.assert_called_once_with(["/tmp/imp", "run", "--", "."], check=False)
