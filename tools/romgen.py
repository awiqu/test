"""Генератор «прошивки» ПЗУ: ассемблер -> плитки B-плоскости (факелы/воздух) -> датапак-функция load_rom.
python3 tools/romgen.py программа.asm --meta rc8_meta.pkl --out DIR [--name rc8]
Результат: DIR/<name>_rom/ — датапак с функцией <name>_rom:load (ставит факелы по ячейкам банков и обновляет блоки)."""
import sys, os, pickle, argparse, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from redcomp.asm import assemble
from redcomp.system import mod_rom
from redcomp.rom import program_tile, BANKS
from redcomp.export import structure_nbt, bounds

ap = argparse.ArgumentParser()
ap.add_argument("asm")
ap.add_argument("--meta", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--name", default="rc8")
a = ap.parse_args()

words = assemble(open(a.asm).read())
meta = pickle.load(open(a.meta, "rb"))
ox, oz = meta["plan"]["rom"]
m = mod_rom(words)
geo = m.info["geo"]
ns = a.name + "_rom"
root = os.path.join(a.out, ns)
os.makedirs(os.path.join(root, "data", ns, "structure"), exist_ok=True)
os.makedirs(os.path.join(root, "data", ns, "function"), exist_ok=True)
with open(os.path.join(root, "pack.mcmeta"), "w") as f:
    json.dump({"pack": {"description": "ROM program for RC-8", "min_format": [107, 1], "max_format": [107, 1]}}, f)
lines = [f"# прошивка ПЗУ RC-8: {os.path.basename(a.asm)}, {len(words)} слов; ~ ~ ~ = та же точка, что у {a.name}:build"]
upd = []
for b in range(BANKS):
    g = program_tile(geo, words, b)
    (x0, y0, z0), (x1, y1, z1) = bounds(g)
    size = (x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1)
    with open(os.path.join(root, "data", ns, "structure", f"b{b}.nbt"), "wb") as f:
        f.write(structure_nbt(g.b, (x0, y0, z0), size))
    dx, dy, dz = x0 + ox, y0, z0 + oz
    lines.append(f"place template {ns}:b{b} ~{dx} ~{dy} ~{dz}")
    upd.append(f"clone ~{dx} ~{dy} ~{dz} ~{dx+size[0]-1} ~{dy+size[1]-1} ~{dz+size[2]-1} ~{dx} ~{dy} ~{dz} replace force")
lines += upd
with open(os.path.join(root, "data", ns, "function", "load.mcfunction"), "w") as f:
    f.write("\n".join(lines) + "\n")
print("ПЗУ:", len(words), "слов ->", root)
