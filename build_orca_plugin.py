#!/usr/bin/env python3
"""Bundle src/geometry.js + src/interfinity.html into the OrcaSlicer plugin.

    python3 build_orca_plugin.py               # dist/interfinity_plugin_<host target>.py
    python3 build_orca_plugin.py --all-targets # all six OS/arch tags
    python3 build_orca_plugin.py --install     # build + copy into OrcaSlicer's orca_plugins/
"""
import glob, os, platform, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
DIST = os.path.join(HERE, "dist")
STEM = "interfinity_plugin"
TARGETS = ["linux_x86_64", "linux_arm64", "win_x86_64", "win_arm64", "macosx_arm64", "macosx_x86_64"]


def host_target():
    os_name = {"linux": "linux", "win32": "win", "cygwin": "win", "darwin": "macosx"}.get(sys.platform, sys.platform)
    m = platform.machine().lower()
    arch = "x86_64" if m in ("x86_64", "amd64") else "arm64" if m in ("arm64", "aarch64") else m
    return f"{os_name}_{arch}"


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def bundle():
    html = read("interfinity.html").replace("/*__GEOMETRY__*/", read("geometry.js"))
    if '"""' in html or "</script>" in read("geometry.js"):
        sys.exit('page contains """ or </script>; cannot embed')
    return read("plugin_template.py").replace("__HTML__", html)


def plugin_dirs():
    home = os.path.expanduser("~")
    roots = [os.path.join(home, ".var", "app", "com.orcaslicer.OrcaSlicer", "config", "OrcaSlicer"),
             os.path.join(home, ".config", "OrcaSlicer"),
             os.path.join(os.environ.get("APPDATA", ""), "OrcaSlicer"),
             os.path.join(home, "Library", "Application Support", "OrcaSlicer")]
    return [os.path.join(r, "orca_plugins", "interfinity") for r in roots if r and os.path.isdir(r)]


def main():
    targets = TARGETS if "--all-targets" in sys.argv else [host_target()]
    os.makedirs(DIST, exist_ok=True)
    content, written = bundle(), []
    for t in targets:
        out = os.path.join(DIST, f"{STEM}_{t}.py")
        with open(out, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"wrote {os.path.relpath(out, HERE)} ({os.path.getsize(out):,} bytes)")
        written.append(out)
    if "--install" in sys.argv:
        dirs = plugin_dirs()
        if not dirs:
            print("no OrcaSlicer data directory found; nothing installed")
        for d in dirs:
            os.makedirs(d, exist_ok=True)
            host = [w for w in written if w.endswith(f"_{host_target()}.py")] or written[:1]
            dest = os.path.join(d, os.path.basename(host[0]))
            shutil.copy(host[0], dest)
            for junk in glob.glob(os.path.join(d, "__pycache__")):
                shutil.rmtree(junk, ignore_errors=True)
            print("installed ->", dest)
        if dirs:
            print("restart OrcaSlicer to pick up the change")


if __name__ == "__main__":
    main()
