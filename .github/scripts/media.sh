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
for z in "$DEST"/*.zip; do [[ -e "$z" ]] || continue; echo "descomprimiendo $(basename "$z")"; tar -xf "$z" -C "$DEST" && rm -f "$z"; done
# por si el zip trae una carpeta dentro
find "$DEST" -mindepth 2 -type f \( -name '*.ogg' -o -name '*.webm' \) -exec mv -f {} "$DEST"/ \; 2>/dev/null || true
for f in intro_launcher.webm musica_menu_bucle.ogg; do
  if [[ ! -s "$DEST/$f" ]]; then echo "::warning::Falta $f en 'media-privado'."; [[ -n "$REQ" ]] && exit 1; fi
done
exit 0
