# Derisomod Launcher

Launcher que mantiene el modpack **Derisomod** (Minecraft 1.21.1 · NeoForge) siempre actualizado.
El jugador abre el launcher, le da a **Actualizar** y después a **Jugar**.

## Para jugadores

1. Instala **NeoForge para Minecraft 1.21.1** (solo una vez): https://neoforged.net/ → instalador → *Install client*.
2. Descarga el launcher desde [Releases](../../releases/latest):
   - `Derisomod-Launcher-Windows.zip`: descomprímelo y abre `Derisomod Launcher.exe` (lleva Java incluido).
   - `Derisomod-Launcher.jar`: si ya tienes Java 21.
3. Dale a **Actualizar** y luego a **Jugar**. El launcher crea un perfil "Derisomod" en el launcher oficial de Minecraft
   que usa su propia carpeta, así que no toca tus otros mods ni mundos.

## Para el creador del modpack

| Quieres… | Haz esto |
|---|---|
| Añadir o actualizar un mod | Sube el `.jar` a `modpack/mods/` (y borra el viejo) |
| Quitar un mod | Bórralo de `modpack/mods/`: se les borra a todos al actualizar |
| Cambiar una config | Sube el archivo a `modpack/config/` |
| Publicar una noticia | Edita `news.json` |

`manifest.json` se regenera solo (GitHub Action *Actualizar manifest*). No hace falta tocarlo.

**Archivos de más de 25 MB** (como Essential): la web de GitHub no deja subirlos arrastrando.
Usa [GitHub Desktop](https://desktop.github.com/) o `git push`. El límite real por archivo es 100 MB.

### Cómo se actualiza cada carpeta

- `mods/`: queda **idéntica** a la del repositorio (lo que sobra se borra).
- `config/`, `defaultconfigs/` y el resto: se añaden o reemplazan los archivos del repositorio, sin borrar nada.
  Si un jugador cambia una config, se respeta hasta que tú subas una versión nueva de ese archivo.

### Publicar una versión nueva del launcher

1. Sube `LAUNCHER_VERSION` en `launcher-src/Launcher.java`.
2. Crea un tag (por ejemplo `v1.0.1`) desde *Releases → Draft a new release*.
3. La Action *Compilar launcher* genera el `.exe` y el `.jar` y los adjunta a la release.
   Los launchers viejos avisarán de que hay una versión nueva.

### Cambiar el nombre o el repositorio

Las constantes están al principio de `launcher-src/Launcher.java` (`PACK_NAME`, `REPO`, `RAM`…).
