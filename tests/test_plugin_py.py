"""Exercise the generated plugin with a fake `orca` module: transfer protocol, settings, placement hook."""
import base64, importlib.util, json, os, struct, sys, tempfile, types, time
dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist", "interfinity_plugin_linux_x86_64.py")
orca = types.ModuleType("orca")
class _B: 
    def __init__(s,*a,**k): pass
orca.script = types.SimpleNamespace(ScriptPluginCapabilityBase=_B)
orca.pages = types.SimpleNamespace(PagesPluginCapabilityBase=_B)
orca.base = object
orca.plugin = lambda c: c
orca.register_capability = lambda c: None
orca.host = types.SimpleNamespace()
orca.ExecutionResult = types.SimpleNamespace(success=lambda m:m, failure=lambda *a:a)
orca.PluginResult = types.SimpleNamespace(RecoverableError=1)
sys.modules["orca"] = orca
tmp = tempfile.mkdtemp(); src = os.path.join(tmp, "plug.py")
open(src, "w").write(open(dist).read())
spec = importlib.util.spec_from_file_location("plug", src); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
placed = []
m.load_onto_plate = lambda p: (placed.append(p), None)[1]
core = m._Core(); out = []
reply = out.append
# fake STL: 2 triangles
tri = struct.pack("<12fH", *([0]*12), 0)
stl = b"x"*80 + struct.pack("<I", 2) + tri*2
b = base64.b64encode(stl).decode()
core._handle({"type":"save_file_start","name":"../evil/a b?.stl","place":True,"total_bytes":len(stl)}, reply)
core._handle({"type":"save_file_chunk","index":0,"chunk":b[:40]}, reply)
core._handle({"type":"save_file_chunk","index":1,"chunk":b[40:]}, reply)
core._handle({"type":"save_file_finish"}, reply)
time.sleep(1.2)
print([o["type"] for o in out])
assert [o["type"] for o in out] == ["chunk_ack","chunk_ack","chunk_ack","saved","placed"], out
path = out[3]["path"]; assert os.path.dirname(path).endswith("interfinity_output") and os.path.basename(path)=="a b_.stl", path
assert open(path,"rb").read()==stl and placed==[path] and out[-1]["placed"] is True
# bad transfer: wrong size
out.clear()
core._handle({"type":"save_file_start","name":"bad","total_bytes":999}, reply)
core._handle({"type":"save_file_chunk","index":0,"chunk":b}, reply)
core._handle({"type":"save_file_finish"}, reply)
assert out[-1]["type"]=="save_failed", out
# settings
core._handle({"type":"save_settings","settings":{"a":1}}, reply); assert core._read_settings()=={"a":1}
core._handle({"type":"reset_settings"}, reply); assert core._read_settings() is None
# bed failure path (no preset bundle in fake host)
out.clear(); core._handle({"type":"get_bed"}, reply); assert out[0]["type"]=="bed_failed"
assert m._area_extent(["25x25","325x25","325x280","25x280"])==(300.0,255.0)
print("python plugin tests PASS")
