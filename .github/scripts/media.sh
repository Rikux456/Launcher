#!/usr/bin/env bash
# Baja la intro y la música del borrador de release "media-privado" (no están en el código: la música no es nuestra).
# Uso: media.sh <carpeta> [obligatorio]
set -euo pipefail
DEST="$1"; REQ="${2:-}"
mkdir -p "$DEST"
id=$(gh api "repos/$GITHUB_REPOSITORY/releases?per_page=100" --jq '[.[] | select(.name=="media-privado" or .tag_name=="media-privado")][0].id // empty')
if [[ -z "$id" ]]; then
  echo "::warning::No hay borrador 'media-privado' con la intro y la música."
  [[ -n "$REQ" ]] && exit 1 || exit 0
fi
gh api "repos/$GITHUB_REPOSITORY/releases/$id/assets" --jq '.[] | "\(.id) \(.name)"' | while read -r aid name; do
  echo "media: $name"
  gh api -H "Accept: application/octet-stream" "repos/$GITHUB_REPOSITORY/releases/assets/$aid" > "$DEST/$name"
done
# también vale si se arrastraron al texto del borrador (enlaces de github.com/user-attachments)
gh api "repos/$GITHUB_REPOSITORY/releases/$id" --jq '.body // ""' | grep -oE '\[[^]]+\]\(https://github\.com/user-attachments/[^)]+\)' | while read -r link; do
  name=$(echo "$link" | sed -E 's/^\[([^]]+)\].*/\1/'); url=$(echo "$link" | sed -E 's/.*\((https[^)]+)\)$/\1/')
  [[ -s "$DEST/$name" ]] && continue
  echo "media (enlace): $name"
  curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -o "$DEST/$name" "$url" || curl -fsSL -o "$DEST/$name" "$url"
done
# los .zip se descomprimen (GitHub a veces no deja subir .ogg sueltos)
for z in "$DEST"/*.zip; do [[ -e "$z" ]] || continue; echo "descomprimiendo $(basename "$z")"; (python3 -m zipfile -e "$z" "$DEST" 2>/dev/null || python -m zipfile -e "$z" "$DEST") && rm -f "$z"; done
# por si el zip trae una carpeta dentro
find "$DEST" -mindepth 2 -type f \( -name '*.ogg' -o -name '*.webm' -o -name '*.mp4' \) -exec mv -f {} "$DEST"/ \; 2>/dev/null || true
# la intro: Rikux456 la renderiza grande (p. ej. intro_launcher_2560.mp4); aquí se pasa a 1880x1040 (el tamaño del
# launcher) en H.264, que pesa la tercera parte y cualquier PC la mueve. Si hay varias, la más nueva del borrador.
src=$(ls -t "$DEST"/intro_launcher_*.mp4 2>/dev/null | head -1 || true)
if [[ -n "$src" ]]; then
  if ! command -v ffmpeg >/dev/null; then echo "instalando ffmpeg"; choco install ffmpeg -y --no-progress >/dev/null || sudo apt-get install -y ffmpeg >/dev/null; export PATH="$PATH:/c/ProgramData/chocolatey/bin"; fi
  echo "convirtiendo $(basename "$src") a intro_launcher.mp4"
  ffmpeg -v error -y -i "$src" -vf "scale=1880:1040:flags=lanczos" -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -movflags +faststart "$DEST/intro_launcher.mp4"
  rm -f "$DEST"/intro_launcher_*.mp4 "$DEST/intro_launcher.webm"
fi
for f in intro_launcher.mp4 musica_menu_bucle.ogg; do
  if [[ ! -s "$DEST/$f" ]]; then echo "::warning::Falta $f en 'media-privado'."; [[ -n "$REQ" ]] && exit 1; fi
done
exit 0
