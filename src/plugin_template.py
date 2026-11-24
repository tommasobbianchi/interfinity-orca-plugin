# -*- coding: utf-8 -*-
# /// script
# requires-python = ">=3.12"
# dependencies = []
#
# [tool.orcaslicer.plugin]
# name = "Interfinity Tile Generator"
# description = "Genera i tile modulari Interfinity (incastri tondi ogni 25 mm) in qualsiasi misura WxD, riempie un'area, impagina sul piatto e invia l'STL a OrcaSlicer."
# author = "tommasobbianchi"
# version = "0.1.0"
# ///
"""Interfinity tile generator for OrcaSlicer.

Registers a Pages capability (a tab in the main window) and a Script
capability (the same panel as a floating window, from the Plugins dialog).

The geometry lives in the HTML page (src/geometry.js, inlined at build time);
this file only saves the STL the page produces and asks the running
OrcaSlicer to open it.

GENERATED FILE. Edit src/* and run build_orca_plugin.py.

The way a file is handed to the running instance (D-Bus on Linux,
WM_COPYDATA on Windows, `open -a` on macOS) follows the approach used by
JonasMerrell/Gridfinity-Orca-Plugin.
"""

import base64
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time

import orca

OUTPUT_DIRNAME = "interfinity_output"
HERE = os.path.dirname(os.path.abspath(__file__))
IS_WINDOWS = sys.platform.startswith("win")
IS_MACOS = sys.platform == "darwin"
BUS_RE = re.compile(r"([a-zA-Z0-9_.-]*InstanceCheck[.]Object[0-9]+)")
WM_COPYDATA = 0x004A


def _log(*parts):
    msg = "[interfinity] " + " ".join(str(p) for p in parts)
    print(msg, file=sys.stderr, flush=True)


def _payload(path):
    # element 0 stands in for the executable and is discarded by the receiver
    return "orca-slicer;" + path


# ---------------------------------------------------------------------------
# Handing a file to the running OrcaSlicer
# ---------------------------------------------------------------------------
def _dbus_names():
    try:
        out = subprocess.run(
            ["dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.DBus",
             "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames"],
            capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return []
    names = sorted(set(BUS_RE.findall(out)), reverse=True)   # newest instance first
    mine = []
    for name in list(names):
        try:
            pid_out = subprocess.run(
                ["dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.DBus",
                 "/org/freedesktop/DBus", "org.freedesktop.DBus.GetConnectionUnixProcessID",
                 "string:" + name],
                capture_output=True, text=True, timeout=3).stdout
            m = re.search(r"uint32\s+([0-9]+)", pid_out)
            if m and int(m.group(1)) == os.getpid():
                names.remove(name)
                mine.append(name)
        except Exception:
            pass
    return mine + names


def _place_cli_fallback(path):
    candidates = []
    appimage = os.environ.get("APPIMAGE")
    if appimage and os.path.isfile(appimage) and os.access(appimage, os.X_OK):
        candidates.append([appimage, path])
    try:
        exe = os.path.realpath("/proc/self/exe")
        if "orca" in exe.lower() or "slicer" in exe.lower():
            candidates.append([exe, path])
    except Exception:
        pass
    for binary in ("orca-slicer", "OrcaSlicer"):
        found = shutil.which(binary)
        if found:
            candidates.append([found, path])
    for cmd in candidates:
        try:
            if subprocess.run(cmd, capture_output=True, text=True, timeout=10).returncode == 0:
                return None
        except Exception:
            continue
    return "could not find the running OrcaSlicer instance"


def _place_dbus(path):
    last_err = None
    for name in _dbus_names():
        obj = "/" + name.replace(".", "/")
        for iface in ([name, name.rsplit(".", 1)[0]] if ".Object" in name else [name]):
            try:
                done = subprocess.run(
                    ["dbus-send", "--session", "--print-reply", "--reply-timeout=1500",
                     "--dest=" + name, "--type=method_call", obj, iface + ".AnotherInstance",
                     "string:" + _payload(path)],
                    capture_output=True, text=True, timeout=5)
                # OrcaSlicer never sends a method return, so NoReply is the success case
                if done.returncode == 0 or "NoReply" in (done.stderr or ""):
                    return None
                last_err = (done.stderr or "request rejected").strip()
            except FileNotFoundError:
                return "dbus-send is not installed"
            except Exception as exc:
                last_err = str(exc)
    return _place_cli_fallback(path) and (last_err or "could not reach OrcaSlicer")


def _place_macos(path):
    open_bin = "/usr/bin/open" if os.path.exists("/usr/bin/open") else "open"
    app = None
    p = os.path.abspath(sys.executable or "")
    while p and p != "/" and not p.endswith(".app"):
        p = os.path.dirname(p)
    if p.endswith(".app"):
        app = p
    cmd = [open_bin, "-a", app or "OrcaSlicer", path]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    return None if done.returncode == 0 else (done.stderr or "open failed").strip()


def _place_windows(path):
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)

    class COPYDATASTRUCT(ctypes.Structure):
        _fields_ = [("dwData", ctypes.c_size_t), ("cbData", wintypes.DWORD),
                    ("lpData", ctypes.c_void_p)]

    user32.GetClassNameW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    user32.GetPropW.argtypes = (wintypes.HWND, wintypes.LPCWSTR)
    user32.GetPropW.restype = wintypes.HANDLE
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    user32.SendMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    user32.SendMessageW.restype = ctypes.c_ssize_t
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    me, found = os.getpid(), []

    def visit(hwnd, _l):
        buf = ctypes.create_unicode_buffer(256)
        if user32.GetClassNameW(hwnd, buf, 256) == 0 or buf.value != "wxWindowNR":
            return True
        if not user32.GetPropW(hwnd, "Instance_Hash_Minor") or not user32.GetPropW(hwnd, "Instance_Hash_Major"):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != me:
            return True
        found.append(hwnd)
        return False

    user32.EnumWindows.argtypes = (WNDENUMPROC, wintypes.LPARAM)
    cb = WNDENUMPROC(visit)
    user32.EnumWindows(cb, 0)
    if not found:
        return "could not find the OrcaSlicer main window"
    text = ctypes.create_unicode_buffer(_payload(path))
    data = COPYDATASTRUCT(1, ctypes.sizeof(text), ctypes.cast(text, ctypes.c_void_p))
    user32.SendMessageW(found[0], WM_COPYDATA, 0, ctypes.addressof(data))
    return None


def load_onto_plate(path):
    """None on success, otherwise a short reason. Safe from a worker thread."""
    place = _place_windows if IS_WINDOWS else _place_macos if IS_MACOS else _place_dbus
    last = "unknown error"
    for attempt in (1, 2, 3):
        if attempt > 1:
            time.sleep(0.4)
        try:
            problem = place(path)
        except Exception as exc:
            last = "{}: {}".format(type(exc).__name__, exc)
            continue
        if problem is None:
            return None
        last = problem
    return last


# ---------------------------------------------------------------------------
# Bed size of the active printer
# ---------------------------------------------------------------------------
def _active_printer_preset():
    bundle = orca.host.preset_bundle()
    getters = (
        lambda: bundle.current_printer_preset(),
        lambda: bundle.printers().get_selected_preset(),
        lambda: bundle.printers().selected_preset(),
        lambda: bundle.printers().selected_preset,
        lambda: bundle.printers.get_selected_preset(),
    )
    for get in getters:
        try:
            preset = get()
        except Exception:
            continue
        if preset is not None:
            return preset
    raise RuntimeError("no printer-preset accessor on the preset bundle")


def _preset_config(preset, key):
    for get in (lambda: preset.full_config_value(key), lambda: preset.config_value(key)):
        try:
            value = get()
        except Exception:
            continue
        if value not in (None, "", []):
            return value
    return None


def _preset_name(preset):
    for get in (lambda: preset.name(), lambda: preset.name):
        try:
            value = get()
        except Exception:
            continue
        if isinstance(value, str) and value:
            return value
    return "stampante attiva"


def _area_extent(raw):
    text = raw if isinstance(raw, str) else ",".join(str(v) for v in raw)
    nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", text)]
    pts = list(zip(nums[0::2], nums[1::2]))
    if len(pts) < 2:
        raise ValueError("printable_area did not parse: %r" % (raw,))
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    return round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2)


def active_bed_size():
    preset = _active_printer_preset()
    raw = _preset_config(preset, "printable_area") or _preset_config(preset, "bed_shape")
    if raw is None:
        raise RuntimeError("no printable_area on the printer preset")
    width, depth = _area_extent(raw)
    if width <= 0 or depth <= 0:
        raise ValueError("printable_area has no area")
    return width, depth, _preset_name(preset)


# ---------------------------------------------------------------------------
# Shared behaviour for both capabilities
# ---------------------------------------------------------------------------
def _safe_name(name):
    base = re.sub(r"[^A-Za-z0-9 ._-]", "_", os.path.basename(name or "").strip())
    base = re.sub(r" +", " ", base).strip() or "interfinity"
    return base if base.lower().endswith(".stl") else base + ".stl"


class _Core:
    _transfer = None

    def _handle(self, message, reply):
        if isinstance(message, (bytes, bytearray)):
            message = message.decode("utf-8", "replace")
        if isinstance(message, str):
            try:
                message = json.loads(message)
            except Exception:
                return
        if not isinstance(message, dict):
            return
        kind = message.get("type")

        if kind == "get_bed":
            settings = self._read_settings()
            try:
                x, y, name = active_bed_size()
                reply({"type": "bed", "x": x, "y": y, "printer": name, "settings": settings})
            except Exception as exc:
                _log("bed size lookup failed:", exc)
                reply({"type": "bed_failed", "error": str(exc), "settings": settings})
        elif kind == "get_settings":
            reply({"type": "settings", "settings": self._read_settings()})
        elif kind == "save_settings":
            self._write_settings(message.get("settings"))
        elif kind == "reset_settings":
            self._write_settings(None)
        elif kind == "save_file_start":
            self._start(message, reply)
        elif kind == "save_file_chunk":
            self._chunk(message, reply)
        elif kind == "save_file_finish":
            self._finish(reply)

    # -- file transfer ------------------------------------------------------
    def _out_dir(self):
        d = os.path.join(HERE, OUTPUT_DIRNAME)
        os.makedirs(d, exist_ok=True)
        return d

    def _start(self, message, reply):
        try:
            path = os.path.abspath(os.path.join(self._out_dir(), _safe_name(message.get("name"))))
            self._transfer = {"path": path, "handle": open(path, "wb"), "place": bool(message.get("place")),
                              "total": int(message.get("total_bytes", 0)), "bytes": 0}
            reply({"type": "chunk_ack", "index": -1})
        except Exception as exc:
            _log("save start failed:", exc)
            reply({"type": "save_failed", "error": str(exc)})

    def _chunk(self, message, reply):
        t = self._transfer
        if not t:
            return
        try:
            data = base64.b64decode(message.get("chunk", ""))
            t["handle"].write(data)
            t["bytes"] += len(data)
            reply({"type": "chunk_ack", "index": message.get("index", 0)})
        except Exception as exc:
            reply({"type": "save_failed", "error": str(exc)})

    def _finish(self, reply):
        t, self._transfer = self._transfer, None
        if not t:
            return
        path = t["path"]
        try:
            t["handle"].flush()
            os.fsync(t["handle"].fileno())
            t["handle"].close()
            size = os.path.getsize(path)
            if t["total"] and size != t["total"]:
                raise ValueError("incomplete transfer: %d of %d bytes" % (size, t["total"]))
            with open(path, "rb") as f:
                hdr = f.read(84)
            if len(hdr) >= 84 and size != 84 + struct.unpack("<I", hdr[80:84])[0] * 50:
                raise ValueError("STL triangle count does not match file size")
            self._prune()
        except Exception as exc:
            _log("save finish failed:", exc)
            reply({"type": "save_failed", "error": str(exc)})
            return
        if not t["place"]:
            reply({"type": "saved", "path": path, "placed": False})
            return
        reply({"type": "saved", "path": path, "placed": False, "pending": True})

        def worker():
            time.sleep(0.5)
            problem = load_onto_plate(path)
            try:
                reply({"type": "placed", "path": path, "placed": problem is None,
                       "place_error": problem or ""})
            except Exception as exc:
                _log("could not report placement:", exc)

        threading.Thread(target=worker, name="interfinity-place", daemon=True).start()

    def _prune(self):
        try:
            d = self._out_dir()
            stls = [os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith(".stl")]
            stls.sort(key=os.path.getmtime)
            for old in stls[:-50]:
                os.remove(old)
        except Exception:
            pass

    # -- settings -------------------------------------------------------------
    def _settings_path(self):
        return os.path.join(HERE, "settings.json")

    def _read_settings(self):
        try:
            with open(self._settings_path(), "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _write_settings(self, data):
        path = self._settings_path()
        try:
            if data is None:
                if os.path.isfile(path):
                    os.remove(path)
                return
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, path)
        except Exception as exc:
            _log("settings write failed:", exc)


# ---------------------------------------------------------------------------
# A tab in the main window (when the host supports it)
# ---------------------------------------------------------------------------
_PAGES = getattr(orca, "pages", None)
_PAGE_BASE = getattr(_PAGES, "PagesPluginCapabilityBase", None)

if _PAGE_BASE is not None:
    class InterfinityPage(_PAGE_BASE, _Core):
        def get_name(self):
            return "Interfinity"

        def get_icon(self):
            return "param_grid"

        def get_ui(self):
            return PAGE

        def on_message(self, message):
            self._handle(message, self.post_message)
else:
    InterfinityPage = None


# ---------------------------------------------------------------------------
# The same panel as a floating window
# ---------------------------------------------------------------------------
class InterfinityWindow(orca.script.ScriptPluginCapabilityBase, _Core):
    def __init__(self):
        super().__init__()
        self._win = None

    def get_name(self):
        return "Interfinity Tile Generator"

    def execute(self):
        if self._win is not None:
            try:
                if self._win.is_open():
                    return orca.ExecutionResult.success("Il pannello Interfinity è già aperto.")
            except Exception:
                self._win = None
        try:
            self._win = orca.host.ui.create_window(
                html=PAGE, title="Interfinity Tile Generator",
                on_message=self._on_message, on_close=self._on_close)
        except Exception as exc:
            return orca.ExecutionResult.failure(
                orca.PluginResult.RecoverableError, "Impossibile aprire il pannello: {}".format(exc))
        return orca.ExecutionResult.success("Pannello Interfinity aperto.")

    def _on_close(self, *_a):
        self._win = None

    def _on_message(self, message):
        self._handle(message, self._post)

    def _post(self, payload):
        if self._win is None:
            return
        try:
            self._win.post(payload)
        except Exception:
            pass


@orca.plugin
class InterfinityPlugin(orca.base):
    def register_capabilities(self):
        if InterfinityPage is not None:
            try:
                orca.register_capability(InterfinityPage)
            except Exception as exc:
                _log("could not register page:", exc)
        try:
            orca.register_capability(InterfinityWindow)
        except Exception as exc:
            _log("could not register window:", exc)


PAGE = r"""__HTML__"""
