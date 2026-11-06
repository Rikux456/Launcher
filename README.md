# Derisomod Launcher

Launcher que mantiene el modpack **Derisomod** (Minecraft 1.21.1 · NeoForge) siempre actualizado.
El jugador abre el launcher, le da a **Actualizar** y después a **Jugar**.

## Para jugadores

1. Descarga e instala **`Derisomod-Launcher-Setup-…exe`** desde [Releases](../../releases/latest).
   Si Windows avisa ("Windows protegió su PC"): *Más información → Ejecutar de todas formas* (no está firmado).
   Quien ya tenga el launcher 1.4 no tiene que hacer nada: se instala solo el nuevo.
2. La primera vez te pregunta con qué juegas y **crea la instancia solo, con NeoForge incluido**:
   - **Modrinth**: se abre Modrinth App pidiendo confirmar la instalación del perfil "Derisomod". Acéptala.
     *Jugar* arranca el juego directamente con ese perfil.
   - **Prism Launcher**: igual, Prism pide confirmar la importación. *Jugar* arranca el juego directamente.
   - **Launcher oficial**: al darle a *Jugar* instala NeoForge solo y crea el perfil "Derisomod".
   - **Ninguno**: te ofrece instalar Modrinth o el launcher oficial y sigue solo cuando lo detecta.
   Puedes cambiarlo cuando quieras en **Instalar en**, debajo del título.
3. Dale a **Actualizar** y luego a **Jugar**.

El launcher busca actualizaciones al abrirse, cada 10 minutos y cuando pulsas **Comprobar**, y **se actualiza solo**
(descarga la versión nueva y ofrece reiniciar). La intro sale entera la primera vez de cada versión (clic o Esc la
salta); en ⚙ se puede ver siempre, cambiar el volumen o volver a verla; ♪ silencia la música.

Los mods de esa instancia quedan idénticos a los del modpack: si hay otros mods, el launcher avisa antes de quitarlos.

## Para el creador del modpack

| Quieres… | Haz esto |
|---|---|
| Añadir o actualizar un mod | Sube el `.jar` a `modpack/mods/` (y borra el viejo) |
| Quitar un mod | Bórralo de `modpack/mods/`: se les borra a todos al actualizar |
| Cambiar una config | Sube el archivo a `modpack/config/` |
| Publicar una noticia | Edita `news.json` |

**Desde el repositorio del mod** (`Deriso-Mod/Deriso`): `publicar-launcher.bat` compila el Derisomod y sus addons (Characters, Roguelike, Ylvia),
copia los jar a `modpack/mods/` quitando las versiones viejas y lo sube. Con un texto (`publicar-launcher.bat "Novedades..."`)
añade también una noticia.

`manifest.json` se regenera solo (GitHub Action *Actualizar manifest*). No hace falta tocarlo.

**Archivos de más de 25 MB** (como Essential): la web de GitHub no deja subirlos arrastrando.
Usa [GitHub Desktop](https://desktop.github.com/) o `git push`. El límite real por archivo es 100 MB.

### Cómo se actualiza cada carpeta

- `mods/`: queda **idéntica** a la del repositorio (lo que sobra se borra).
- `config/`, `defaultconfigs/` y el resto: se añaden o reemplazan los archivos del repositorio, sin borrar nada.
  Si un jugador cambia una config, se respeta hasta que tú subas una versión nueva de ese archivo.

### El launcher (carpeta `app/`, Electron)

- La interfaz es una página web (`app/renderer/`): el fondo animado, la intro y el rey. La lógica (modpack, Modrinth,
  Prism, NeoForge) está en `app/core.js`.
- La intro y la música **no están en el código** (la música no es nuestra): están en el borrador de release
  `media-privado` (`intro_launcher.webm` y `musica_menu_bucle.ogg`, o en un `.zip`). Para cambiarlas, se cambian ahí.
- **Probar**: Actions → *Probar launcher* → Run workflow. Arranca el launcher en Windows, saca capturas (rama
  `ci-capturas`) y deja el instalador para descargarlo (Artifacts).
- **Publicar una versión nueva**: sube `version` en `app/package.json` (por ejemplo a `2.0.1`). La Action
  *Compilar launcher* monta el instalador y crea la release `v2.0.1`; todos los launchers se actualizan solos.
- `launcher-src/` es el launcher Java antiguo (1.4); `launcher-src/bridge/` es el puente que hace que los 1.4
  instalen el nuevo.

### Cambiar la versión de NeoForge

Edita `NEOFORGE` en `.github/scripts/generate_manifest.py`. Las instancias nuevas usarán esa versión.

### Cambiar el nombre o el repositorio

Las constantes están al principio de `app/core.js` (`PACK_NAME`, `REPO`, `RAM`…) y en `app/package.json`.
