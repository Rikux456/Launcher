import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.*;

/**
 * Arrancador del launcher (es lo que abre el .exe).
 *
 * El launcher se actualiza solo: cuando sale una versión nueva, la descarga como
 * <carpeta>/launcher-new.jar. Al abrirse otra vez, el arrancador la pone en su sitio y
 * arranca la versión más nueva entre la descargada y la que viene dentro del .exe.
 * Si la descargada falla al cargar, se borra y se usa la de dentro.
 */
public class Bootstrap {

    public static void main(String[] args) throws Throwable {
        Path dir = appDir();
        System.setProperty("derisomod.appdir", dir.toString());
        Path cur = dir.resolve("launcher.jar"), curV = dir.resolve("launcher.version");
        Path nw = dir.resolve("launcher-new.jar"), nwV = dir.resolve("launcher-new.version");
        try {
            Files.createDirectories(dir);
            if (Files.exists(nw) && Files.exists(nwV)) {
                Files.move(nw, cur, StandardCopyOption.REPLACE_EXISTING);
                Files.move(nwV, curV, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception ignored) { }

        String bundled = Launcher.LAUNCHER_VERSION;
        String downloaded = null;
        try { if (Files.exists(cur) && Files.exists(curV)) downloaded = Files.readString(curV).trim(); } catch (Exception ignored) { }

        if (downloaded != null && Launcher.compareVersions(downloaded, bundled) > 0) {
            try {
                URLClassLoader cl = new URLClassLoader(new URL[]{cur.toUri().toURL()}, ClassLoader.getPlatformClassLoader());
                Thread.currentThread().setContextClassLoader(cl);
                Class<?> c = Class.forName("Launcher", true, cl);
                Method m = c.getMethod("main", String[].class);
                m.invoke(null, (Object) args);
                return;
            } catch (Throwable t) {
                // La versión descargada está rota: fuera, y seguimos con la de dentro
                try { Files.deleteIfExists(cur); Files.deleteIfExists(curV); } catch (Exception ignored) { }
                Thread.currentThread().setContextClassLoader(Bootstrap.class.getClassLoader());
            }
        }
        Launcher.main(args);
    }

    static Path appDir() {
        String home = System.getProperty("user.home");
        String os = System.getProperty("os.name").toLowerCase();
        Path base;
        if (os.contains("win")) {
            String a = System.getenv("APPDATA");
            base = Paths.get(a != null ? a : home);
        } else if (os.contains("mac")) {
            base = Paths.get(home, "Library", "Application Support");
        } else {
            base = Paths.get(home);
        }
        return base.resolve(".derisomod-launcher").resolve("app");
    }
}
