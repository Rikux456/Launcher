# Derisomod Launcher

Launcher que mantiene el modpack **Derisomod** (Minecraft 1.21.1 · NeoForge) siempre actualizado.
El jugador abre el launcher, le da a **Actualizar** y después a **Jugar**.

## Para jugadores

1. Descarga el launcher desde [Releases](../../releases/latest):
   - `Derisomod-Launcher-Windows.zip`: descomprímelo y abre `Derisomod Launcher.exe` (lleva Java incluido).
   - `Derisomod-Launcher.jar`: si ya tienes Java 21.
2. La primera vez te pregunta con qué juegas y **crea la instancia solo, con NeoForge incluido**:
   - **Modrinth**: se abre Modrinth App pidiendo confirmar la instalación del perfil "Derisomod". Acéptala.
     *Jugar* arranca el juego directamente con ese perfil.
   - **Prism Launcher**: igual, Prism pide confirmar la importación. *Jugar* arranca el juego directamente.
   - **Launcher oficial**: al darle a *Jugar* instala NeoForge solo y crea el perfil "Derisomod".
   - **Ninguno**: te ofrece instalar Modrinth o el launcher oficial y sigue solo cuando lo detecta.
   Puedes cambiarlo cuando quieras en **Instalar en**, debajo del título.
3. Dale a **Actualizar** y luego a **Jugar**.

El launcher busca actualizaciones al abrirse, cada 10 minutos y cuando pulsas **Comprobar**.
**El propio launcher se actualiza solo** (desde la 1.4.0): descarga la versión nueva y te ofrece reiniciar.

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

### Publicar una versión nueva del launcher

1. Sube `LAUNCHER_VERSION` en `launcher-src/Launcher.java` (por ejemplo a `1.4.1`) y guarda.
2. La Action *Compilar launcher* genera el `.exe` y el `.jar` y crea la release `v1.4.1` sola.
3. Los launchers 1.4.0 o más nuevos la descargan solos y ofrecen reiniciar (el `.exe` abre un arrancador,
   `Bootstrap`, que usa la versión más nueva: la descargada o la de dentro). Los anteriores a la 1.4.0
   solo avisan y abren la página de descarga.

### Cambiar la versión de NeoForge

Edita `NEOFORGE` en `.github/scripts/generate_manifest.py`. Las instancias nuevas usarán esa versión.

### Cambiar el nombre o el repositorio

Las constantes están al principio de `launcher-src/Launcher.java` (`PACK_NAME`, `REPO`, `RAM`…).
