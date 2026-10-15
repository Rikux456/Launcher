"""Genera manifest.json a partir de la carpeta modpack/. Lo ejecuta la GitHub Action."""
import hashlib, json, os, sys

ROOT = "modpack"
MIRROR_DIRS = ["mods"]          # carpetas que quedan idénticas a GitHub (se borra lo que sobre)
SKIP = {".gitkeep", ".DS_Store", "Thumbs.db"}
SKIP_EXT = (".bak", ".part")

files = []
for dirpath, _, names in os.walk(ROOT):
    for n in names:
        if n in SKIP or n.endswith(SKIP_EXT):
            continue
        full = os.path.join(dirpath, n)
        rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
        with open(full, "rb") as fh:
            sha = hashlib.sha1(fh.read()).hexdigest()
        files.append({"path": rel, "sha1": sha, "size": os.path.getsize(full)})
files.sort(key=lambda f: f["path"].lower())

version = hashlib.sha1("".join(f["path"] + f["sha1"] for f in files).encode()).hexdigest()[:8]
manifest = {
    "name": "Derisomod",
    "minecraft": "1.21.1",
    "loader": "neoforge",
    "version": version,
    "mirrorDirs": MIRROR_DIRS,
    "files": files,
}
with open("manifest.json", "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(f"manifest.json: {len(files)} archivos, versión {version}")
