"""Download a verified imp release and run it without shell interpolation."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REPOSITORY = "https://github.com/smedijan/go-imp"
FLAGS = {
    "config": "value", "quiet": "bool", "no-color": "bool",
    "json": "bool", "statuses": "value", "verbose": "bool",
    "dry-run": "bool", "tags": "value", "coverpkg": "value",
    "diff": "value", "output": "value", "integration": "bool",
    "exclude-files": "array", "include-files": "array", "exclude-workdir": "array",
    "threshold-efficacy": "value", "threshold-mcover": "value",
    "workers": "value", "test-cpu": "value", "timeout-coefficient": "value",
    "conditionals-boundary": "bool", "conditionals-negation": "bool",
    "increment-decrement": "bool", "invert-logical": "bool",
    "invert-negatives": "bool", "arithmetic-base": "bool",
    "invert-loopctrl": "bool", "invert-assignments": "bool",
    "invert-bitwise": "bool", "invert-bwassign": "bool",
    "remove-self-assignments": "bool",
}


def arguments(inputs):
    args = ["run"]
    for name, kind in FLAGS.items():
        value = inputs.get(name, "")
        if value == "":
            continue
        if kind == "bool":
            value = value.lower()
            if value not in ("true", "false"):
                raise ValueError(f"{name} must be true or false")
        values = value.splitlines() if kind == "array" else [value]
        args.extend(f"--{name}={item}" for item in values if item != "")
    args.extend(["--", inputs.get("path") or "."])
    return args


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "smedijan/imp-action"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def release_tag(version):
    if version == "latest":
        return json.loads(fetch("https://api.github.com/repos/smedijan/go-imp/releases/latest"))["tag_name"]
    if not re.fullmatch(r"v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("imp-version must be latest or a release version, e.g. v0.8.0")
    return version if version.startswith("v") else "v" + version


def asset_name(tag, system, machine):
    systems = {"Linux": "linux", "Darwin": "darwin", "Windows": "windows"}
    arches = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64", "i386": "386", "i686": "386"}
    if system not in systems or machine.lower() not in arches:
        raise ValueError(f"Unsupported runner: {system}/{machine}")
    return f"imp_{tag.removeprefix('v')}_{systems[system]}_{arches[machine.lower()]}.tar.gz"


def install(tag, directory):
    asset = asset_name(tag, platform.system(), platform.machine())
    base = f"{REPOSITORY}/releases/download/{tag}"
    checksums = fetch(f"{base}/checksums.txt").decode()
    expected = next((line.split()[0] for line in checksums.splitlines()
                     if len(line.split()) == 2 and line.split()[1] == asset), None)
    archive = fetch(f"{base}/{asset}")
    if expected is None or hashlib.sha256(archive).hexdigest() != expected:
        raise ValueError(f"Checksum verification failed for {asset}")
    archive_path = Path(directory) / asset
    archive_path.write_bytes(archive)
    executable = "imp.exe" if platform.system() == "Windows" else "imp"
    target = Path(directory) / executable
    with tarfile.open(archive_path) as tar:
        # Extract only the regular executable; never trust archive paths or links.
        member = tar.getmember(executable)
        if not member.isfile():
            raise ValueError("Release executable is not a regular file")
        with tar.extractfile(member) as source:
            target.write_bytes(source.read())
    target.chmod(0o755)
    return target


def main():
    inputs = json.loads(os.environ["IMP_ACTION_INPUTS"])
    args = arguments(inputs)
    tag = release_tag(inputs.get("imp-version") or "latest")
    with tempfile.TemporaryDirectory(prefix="imp-action-") as directory:
        binary = install(tag, directory)
        print(f"Running imp {tag}", flush=True)
        return subprocess.run([str(binary), *args], check=False).returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        print(f"imp-action: {error}", file=sys.stderr)
        sys.exit(1)
