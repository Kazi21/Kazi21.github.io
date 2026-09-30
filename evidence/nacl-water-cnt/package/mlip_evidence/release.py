"""
Explicit-inclusion public release builder.

build_public_release(manifest_path, public_root, zip_path) packages ONLY the files
named in the manifest, each of which must resolve to a real regular file inside
public_root. It rejects:
  - files not under public_root (path traversal / absolute escape),
  - symlinks (which could point outside the public tree),
  - missing or non-regular files,
  - any manifest entry flagged restricted.

Nothing is added implicitly: there is no directory globbing, so a private file
cannot be swept in. The resulting ZIP stores relative POSIX paths only.
"""
import hashlib
import json
import os
import zipfile


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_member(entry, public_root):
    """Validate one manifest entry; return (abs_path, arcname) or raise ValueError."""
    if entry.get("restricted"):
        raise ValueError(f"entry flagged restricted: {entry.get('public_path')}")
    rel = entry.get("public_path")
    if not rel or os.path.isabs(rel) or rel.startswith(".."):
        raise ValueError(f"invalid public_path: {rel!r}")
    abs_path = os.path.realpath(os.path.join(public_root, rel))
    root = os.path.realpath(public_root)
    if os.path.commonpath([abs_path, root]) != root:
        raise ValueError(f"path escapes public_root: {rel}")
    src = os.path.join(public_root, rel)
    if os.path.islink(src):
        raise ValueError(f"symlink not allowed in release: {rel}")
    if not os.path.isfile(abs_path):
        raise ValueError(f"not a regular file: {rel}")
    return abs_path, rel.replace(os.sep, "/")


def build_public_release(manifest_path, public_root, zip_path):
    """Build a public-only ZIP from an explicit manifest. Returns a summary dict."""
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    entries = manifest.get("files", manifest if isinstance(manifest, list) else [])
    if not entries:
        raise ValueError("manifest lists no files")

    members, errors = [], []
    for entry in entries:
        try:
            abs_path, arc = _safe_member(entry, public_root)
            members.append((abs_path, arc))
        except ValueError as e:
            errors.append(str(e))
    if errors:
        raise ValueError("release rejected:\n  - " + "\n  - ".join(errors))

    os.makedirs(os.path.dirname(os.path.abspath(zip_path)), exist_ok=True)
    written = []
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for abs_path, arc in members:
            zf.write(abs_path, arcname=arc)
            written.append({"arcname": arc, "sha256": _sha256(abs_path)})

    return {
        "zip_path": os.path.abspath(zip_path),
        "n_members": len(written),
        "members": written,
        "zip_sha256": _sha256(zip_path),
    }
