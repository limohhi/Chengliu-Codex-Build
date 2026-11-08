#!/usr/bin/env python3
"""Populate Tauri's Windows NSIS cache using pinned official GitHub assets."""
import argparse
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile

# Official release-assets API metadata, pinned 2026-11-08. No mirrors or tokens.
ASSETS = (
    dict(repo="binary-releases", tag="nsis-3.11", name="nsis-3.11.zip",
         id=317051073, size=2361546,
         sha1="ef7ff767e5cbd9edd22add3a32c9b8f4500bb10d",
         sha256="c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1"),
    dict(repo="nsis-tauri-utils", tag="nsis_tauri_utils-v0.5.3",
         name="nsis_tauri_utils.dll", id=345882097, size=34304,
         sha1="75197fee3c6a814fe035788d1c34ead39349b860",
         sha256="5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709"),
)
PLUGIN = "Plugins/x86-unicode/additional/nsis_tauri_utils.dll"
# tauri-bundler/src/bundle/windows/nsis/mod.rs NSIS_REQUIRED_FILES (Windows).
REQUIRED = (
    "makensis.exe", "Bin/makensis.exe", "Stubs/lzma-x86-unicode",
    "Stubs/lzma_solid-x86-unicode", PLUGIN, "Include/MUI2.nsh",
    "Include/FileFunc.nsh", "Include/x64.nsh", "Include/nsDialogs.nsh",
    "Include/WinMessages.nsh", "Include/Win/COM.nsh",
    "Include/Win/Propkey.nsh", "Include/Win/RestartManager.nsh",
)


def verified(data, asset):
    return (len(data) == asset["size"]
            and hashlib.sha1(data).hexdigest() == asset["sha1"]
            and hashlib.sha256(data).hexdigest() == asset["sha256"])


def download(asset):
    api = ("https://api.github.com/repos/tauri-apps/" + asset["repo"]
           + "/releases/assets/" + str(asset["id"]))
    direct = ("https://github.com/tauri-apps/" + asset["repo"]
              + "/releases/download/" + asset["tag"] + "/" + asset["name"])
    for attempt in range(4):
        # A fresh API query avoids replaying an expired cached CDN redirect.
        endpoints = (api + "?download=1&nonce=" + str(time.time_ns()), direct)
        for index, url in enumerate(endpoints):
            request = urllib.request.Request(url, headers={
                "Accept": "application/octet-stream",
                "User-Agent": "CodexPlusPlus-NSIS-prefetch",
            })
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    data = response.read(asset["size"] + 1)
                if not verified(data, asset):
                    raise ValueError("asset validation failed")
                print("Verified official asset: " + asset["name"])
                return data
            except Exception as error:
                # Do not log exception messages: they may contain signed URLs.
                print("Retry %d/4 %s via %s (%s)" % (
                    attempt + 1, asset["name"],
                    "release-assets API" if index == 0 else "official download/CDN",
                    type(error).__name__), flush=True)
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError("official download exhausted: " + asset["name"])


def package_files(data):
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if (not path.parts or path.parts[0] != "nsis-3.11"
                    or ".." in path.parts or "\\" in entry.filename
                    or ":" in entry.filename):
                raise ValueError("unexpected NSIS archive layout")
            if entry.is_dir():
                continue
            relative = Path(*path.parts[1:])
            if not relative.parts or relative in files:
                raise ValueError("unexpected NSIS archive member")
            files[relative] = archive.read(entry)
    for required in REQUIRED:
        if required != PLUGIN and Path(required) not in files:
            raise ValueError("NSIS archive lacks required file: " + required)
    return files


def valid_tree(root, files, plugin):
    try:
        return (all((root / name).is_file() for name in REQUIRED)
                and all((root / name).read_bytes() == data
                        for name, data in files.items())
                and (root / PLUGIN).read_bytes() == plugin)
    except OSError:
        return False


def populate(root):
    root = root.resolve()
    payloads = []
    for asset in ASSETS:
        saved = root / ".downloads" / asset["name"]
        try:
            data = saved.read_bytes()
        except OSError:
            data = b""
        if not verified(data, asset):
            data = download(asset)
        payloads.append(data)
    files = package_files(payloads[0])
    if valid_tree(root, files, payloads[1]):
        print("Verified complete NSIS 3.11 + Tauri utils 0.5.3 cache")
        return
    root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="nsis-prefetch-", dir=root.parent) as work:
        staged = Path(work) / "NSIS"
        for relative, data in files.items():
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        target = staged / PLUGIN
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payloads[1])
        downloads = staged / ".downloads"
        downloads.mkdir()
        for asset, data in zip(ASSETS, payloads):
            (downloads / asset["name"]).write_bytes(data)
        if not valid_tree(staged, files, payloads[1]):
            raise ValueError("staged NSIS cache validation failed")
        if root.exists():
            shutil.rmtree(root)
        staged.rename(root)
    print("Installed verified NSIS 3.11 + Tauri utils 0.5.3 cache")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    # dirs::cache_dir() on Windows is LocalAppData, not RoamingAppData.
    default = (str(Path(os.environ["LOCALAPPDATA"]) / "tauri" / "NSIS")
               if "LOCALAPPDATA" in os.environ else None)
    parser.add_argument("--cache-dir", default=default)
    args = parser.parse_args()
    if not args.cache_dir:
        parser.error("--cache-dir is required when LOCALAPPDATA is unset")
    try:
        populate(Path(args.cache_dir))
    except Exception as error:
        print("NSIS prefetch failed (%s); cache not saved" % type(error).__name__,
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
