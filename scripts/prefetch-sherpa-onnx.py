#!/usr/bin/env python3
"""Prefetch official sherpa-onnx-sys 1.13.8 archives before Cargo runs."""

import argparse
import bz2
import hashlib
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import time

VERSION = "1.13.8"
# Official metadata from k2-fsa/sherpa-onnx release v1.13.8 (GitHub assets API).
# Keep names/layout aligned with sherpa-onnx-sys 1.13.8 build.rs.
ASSETS = {
    "windows-x64": (
        "sherpa-onnx-v1.13.8-win-x64-static-MT-Release-lib.tar.bz2",
        555521905,
        123206268,
        "56ffcf3c454c1f14f7bc9887286cc8143e7e542dc632804e1c447d5f8d534eaf",
    ),
    "macos-arm64": (
        "sherpa-onnx-v1.13.8-osx-arm64-static-lib.tar.bz2",
        555602879,
        20965936,
        "9091bf160dc7fdacedbc906b212badf53c2993f4e5277a0e03998e96c31d60da",
    ),
}


def validate(path, asset):
    name, _, size, digest = asset
    if path.stat().st_size != size:
        raise ValueError("archive size does not match official asset")
    sha = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha.update(chunk)
    if sha.hexdigest() != digest:
        raise ValueError("SHA256 does not match official asset")
    prefix = PurePosixPath(name.removesuffix(".tar.bz2")) / "lib"
    libraries = set()
    # Read without extracting; drain bz2 to verify its end marker/CRC too.
    with bz2.open(path, "rb") as source:
        with tarfile.open(fileobj=source, mode="r|") as archive:
            for member in archive:
                entry = PurePosixPath(member.name)
                if entry.is_absolute() or ".." in entry.parts:
                    raise ValueError("unsafe archive member path")
                if member.isfile() and entry.parent == prefix and member.size > 0:
                    libraries.add(entry.name)
        while source.read(1024 * 1024):
            pass
    for library in ("sherpa-onnx-c-api", "onnxruntime"):
        if not ({f"{library}.lib", f"lib{library}.a"} & libraries):
            raise ValueError(f"missing static library in {prefix}: {library}")


def acquire(directory, target):
    asset = ASSETS[target]
    name, asset_id, _, _ = asset
    destination = directory / name
    if destination.is_file():
        try:
            validate(destination, asset)
            print(f"Verified cached {name}", flush=True)
            return
        except (OSError, ValueError, tarfile.TarError, EOFError) as error:
            print(f"Cached archive rejected: {error}", flush=True)
    partial = directory / (name + ".part")
    # Hong Kong server mirror. The archive was fetched from the official
    # upstream asset there and its size/SHA256 are verified above.
    mirror = (
        "https://api.chengliu-api.top/downloads/build-deps/"
        f"sherpa-onnx/{VERSION}/{name}"
    )
    try:
        # Do not fall back to GitHub CDN: the CI runner was returning 504 there.
        for attempt in range(4):
            url, headers = mirror, []
            print(f"Fetching {name}: attempt {attempt + 1}/4 via Chengliu HK mirror", flush=True)
            try:
                result = subprocess.run(
                    ["curl", "--fail", "--location", "--silent", "--show-error",
                     "--proto", "=https", "--proto-redir", "=https",
                     "--connect-timeout", "15", "--max-time", "180",
                     "--speed-limit", "1024", "--speed-time", "30", "--retry", "0",
                     "--header", "User-Agent: CodexPlusPlus-CI-sherpa-prefetch",
                     *headers, "--output", str(partial), url],
                    # Do not echo redirects or curl stderr containing signed URLs.
                    capture_output=True, timeout=190, check=False,
                )
                returncode = result.returncode
            except subprocess.TimeoutExpired:
                returncode = 28
            if returncode == 0:
                try:
                    validate(partial, asset)
                    partial.replace(destination)
                    print(f"Verified and saved {name}", flush=True)
                    return
                except (OSError, ValueError, tarfile.TarError, EOFError) as error:
                    print(f"Downloaded archive rejected: {error}", flush=True)
            else:
                print(f"Download failed (curl exit {returncode})", flush=True)
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
        raise RuntimeError(f"Unable to acquire verified {name} after 4 attempts")
    finally:
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=ASSETS)
    parser.add_argument("--archive-dir", required=True, type=Path)
    args = parser.parse_args()
    directory = args.archive_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    acquire(directory, args.target)
    # build.rs joins this directory with the exact original archive filename.
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as environment:
            environment.write(f"SHERPA_ONNX_ARCHIVE_DIR={directory}\n")


if __name__ == "__main__":
    main()
