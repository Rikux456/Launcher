import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.io.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.List;

/**
 * Launcher del modpack.
 * Lee manifest.json del repositorio de GitHub, descarga lo que falta o ha cambiado
 * y deja la carpeta del modpack igual que la del repositorio.
 *
 * Para cambiar el nombre o el repositorio, edita solo las constantes de abajo.
 */
public class Launcher {

    // ====== CONFIGURACIÓN ======
    static final String PACK_NAME = "Derisomod";
    static final String REPO = "Rikux456/Launcher";      // usuario/repositorio de GitHub
    static final String BRANCH = "main";
    static final String LAUNCHER_VERSION = "1.4.0";     // súbelo al publicar un launcher nuevo
    static final String RAM = "-Xmx4G";                  // memoria para el perfil de Minecraft
    // ===========================

    /** Solo para pruebas: -Dlauncher.raw=http://localhost:8000 */
    static final String RAW_BASE = System.getProperty("launcher.raw", "https://raw.githubusercontent.com/" + REPO);
    /** Solo para pruebas: -Dlauncher.api=http://localhost:8000 */
    static final String API_BASE = System.getProperty("launcher.api", "https://api.github.com/repos/" + REPO);
    /** Carpeta del arrancador (Bootstrap); si es null, el launcher no se puede actualizar solo. */
    static final Path APP_DIR = System.getProperty("derisomod.appdir") != null ? Paths.get(System.getProperty("derisomod.appdir")) : null;
    static final String PROFILE_ID = PACK_NAME.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "") + "-launcher";
    static final HttpClient HTTP = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(15)).build();

    // ---------- Rutas ----------

    static boolean isWindows() { return System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win"); }
    static boolean isMac() { return System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("mac"); }

    static Path minecraftDir() {
        String home = System.getProperty("user.home");
        if (isWindows()) {
            String appdata = System.getenv("APPDATA");
            return Paths.get(appdata != null ? appdata : home, ".minecraft");
        }
        if (isMac()) return Paths.get(home, "Library", "Application Support", "minecraft");
        return Paths.get(home, ".minecraft");
    }

    static Path defaultGameDir() {
        String folder = "." + PACK_NAME.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "") + "-modpack";
        return minecraftDir().getParent().resolve(folder);
    }

    // ---------- Modelo ----------

    record PackFile(String path, String sha1, long size) {}
    record Manifest(String version, String minecraft, String neoforge, String commit, List<PackFile> files, List<String> mirrorDirs) {}
    record Plan(Manifest manifest, List<PackFile> downloads, List<Path> deletions, long bytes) {
        boolean upToDate() { return downloads.isEmpty() && deletions.isEmpty(); }
    }

    interface Progress { void update(String text, double fraction); }

    // ---------- Red ----------

    static String getText(String url) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30))
                .header("User-Agent", PACK_NAME + "-Launcher/" + LAUNCHER_VERSION).build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (r.statusCode() != 200) throw new IOException("HTTP " + r.statusCode() + " en " + url);
        return r.body();
    }

    static String rawUrl(Manifest m, String path) {
        StringBuilder sb = new StringBuilder(RAW_BASE).append('/').append(m.commit());
        for (String seg : ("modpack/" + path).split("/"))
            sb.append('/').append(URLEncoder.encode(seg, StandardCharsets.UTF_8).replace("+", "%20"));
        if (m.commit().equals(BRANCH)) sb.append("?v=").append(m.version()); // manifest antiguo sin commit
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    static Manifest fetchManifest() throws Exception {
        // El manifest se lee de la rama, con un parámetro distinto cada vez para saltarse la caché de 5 min
        // de GitHub, y SIN la API (que sin cuenta solo deja 60 consultas por hora).
        // Dentro trae "commit": la publicación de la que salió; los archivos se bajan de ese commit,
        // así que siempre coinciden con el manifest aunque justo se esté publicando otra versión.
        String url = RAW_BASE + "/" + BRANCH + "/manifest.json?t=" + System.currentTimeMillis();
        Map<String, Object> m = (Map<String, Object>) Json.parse(getText(url));
        Object c = m.get("commit");
        String commit = c != null && c.toString().matches("[0-9a-f]{40}") ? c.toString() : BRANCH;
        List<PackFile> files = new ArrayList<>();
        for (Object o : (List<Object>) m.get("files")) {
            Map<String, Object> f = (Map<String, Object>) o;
            files.add(new PackFile((String) f.get("path"), (String) f.get("sha1"), Long.parseLong(f.get("size").toString())));
        }
        List<String> mirror = new ArrayList<>();
        Object md = m.get("mirrorDirs");
        if (md instanceof List<?> l) for (Object o : l) mirror.add(o.toString());
        else mirror.add("mods");
        return new Manifest(String.valueOf(m.get("version")), String.valueOf(m.getOrDefault("minecraft", "1.21.1")),
                String.valueOf(m.getOrDefault("neoforge", "21.1.262")), commit, files, mirror);
    }

    // ---------- Sincronización ----------

    static String sha1(Path p) throws IOException {
        try (InputStream in = Files.newInputStream(p)) {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            return HexFormat.of().formatHex(md.digest());
        } catch (java.security.NoSuchAlgorithmException e) { throw new IOException(e); }
    }

    static Path safeResolve(Path root, String rel) throws IOException {
        Path p = root.resolve(rel).normalize();
        if (!p.startsWith(root.normalize())) throw new IOException("Ruta no válida en el manifest: " + rel);
        return p;
    }

    static Properties loadState(Path gameDir) {
        Properties p = new Properties();
        Path f = gameDir.resolve(".launcher").resolve("state.properties");
        if (Files.exists(f)) try (Reader r = Files.newBufferedReader(f)) { p.load(r); } catch (IOException ignored) { }
        return p;
    }

    static void saveState(Path gameDir, Properties p) throws IOException {
        Path f = gameDir.resolve(".launcher").resolve("state.properties");
        Files.createDirectories(f.getParent());
        try (Writer w = Files.newBufferedWriter(f)) { p.store(w, PACK_NAME + " launcher"); }
    }

    static Plan plan(Path gameDir, Manifest m) throws IOException {
        Properties state = loadState(gameDir);
        List<PackFile> downloads = new ArrayList<>();
        long bytes = 0;
        Set<Path> wanted = new HashSet<>();
        for (PackFile f : m.files()) {
            Path local = safeResolve(gameDir, f.path());
            wanted.add(local);
            boolean mirrored = m.mirrorDirs().stream().anyMatch(d -> f.path().startsWith(d + "/"));
            boolean need;
            if (!Files.exists(local)) need = true;
            else {
                String localSha = sha1(local);
                if (localSha.equals(f.sha1())) need = false;
                else if (mirrored) need = true;
                // config y demás: si ya instalamos esta misma versión y el jugador la cambió, la respetamos
                else need = !f.sha1().equals(state.getProperty(f.path()));
            }
            if (need) { downloads.add(f); bytes += f.size(); }
        }
        List<Path> deletions = new ArrayList<>();
        for (String d : m.mirrorDirs()) {
            Path dir = safeResolve(gameDir, d);
            if (!Files.isDirectory(dir)) continue;
            try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir)) {
                for (Path p : ds) if (Files.isRegularFile(p) && !wanted.contains(p.normalize())) deletions.add(p);
            }
        }
        return new Plan(m, downloads, deletions, bytes);
    }

    static void apply(Path gameDir, Plan plan, Progress progress) throws Exception {
        Files.createDirectories(gameDir);
        Properties state = loadState(gameDir);
        long done = 0, total = Math.max(1, plan.bytes());
        int i = 0;
        for (PackFile f : plan.downloads()) {
            i++;
            String name = f.path().substring(f.path().lastIndexOf('/') + 1);
            progress.update("Descargando " + name + " (" + i + "/" + plan.downloads().size() + ")", (double) done / total);
            Path target = safeResolve(gameDir, f.path());
            Files.createDirectories(target.getParent());
            Path tmp = target.resolveSibling(target.getFileName() + ".part");
            HttpRequest req = HttpRequest.newBuilder(URI.create(rawUrl(plan.manifest(), f.path())))
                    .header("User-Agent", PACK_NAME + "-Launcher/" + LAUNCHER_VERSION).build();
            HttpResponse<InputStream> r = HTTP.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (r.statusCode() != 200) throw new IOException("No se pudo descargar " + f.path() + " (HTTP " + r.statusCode() + ")");
            try (InputStream in = r.body(); OutputStream out = Files.newOutputStream(tmp)) {
                byte[] buf = new byte[1 << 16];
                int n;
                long fileDone = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    fileDone += n;
                    progress.update("Descargando " + name + " (" + i + "/" + plan.downloads().size() + ")",
                            Math.min(1.0, (double) (done + fileDone) / total));
                }
            }
            if (!sha1(tmp).equals(f.sha1())) {
                Files.deleteIfExists(tmp);
                throw new IOException("El archivo " + f.path() + " llegó dañado. Vuelve a intentarlo.");
            }
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            state.setProperty(f.path(), f.sha1());
            done += f.size();
        }
        for (Path p : plan.deletions()) {
            progress.update("Quitando " + p.getFileName(), 1.0);
            Files.deleteIfExists(p);
        }
        for (PackFile f : plan.manifest().files()) state.putIfAbsent(f.path(), f.sha1());
        state.setProperty("_version", plan.manifest().version());
        saveState(gameDir, state);
        progress.update("Modpack actualizado", 1.0);
    }

    // ---------- Perfil del launcher oficial ----------

    /** Busca la versión de NeoForge instalada (p. ej. neoforge-21.1.209) para la versión de Minecraft del pack. */
    static String findNeoForge(String mcVersion) {
        String prefix = "neoforge-" + mcVersion.replaceFirst("^1\\.", "") + ".";
        Path versions = minecraftDir().resolve("versions");
        if (!Files.isDirectory(versions)) return null;
        String best = null;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(versions)) {
            for (Path p : ds) {
                String n = p.getFileName().toString();
                if (n.startsWith(prefix) && Files.exists(p.resolve(n + ".json")))
                    if (best == null || compareVersions(n, best) > 0) best = n;
            }
        } catch (IOException ignored) { }
        return best;
    }

    static int compareVersions(String a, String b) {
        String[] x = a.replaceAll("[^0-9.]", "").split("\\."), y = b.replaceAll("[^0-9.]", "").split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int u = i < x.length && !x[i].isEmpty() ? Integer.parseInt(x[i]) : 0;
            int v = i < y.length && !y[i].isEmpty() ? Integer.parseInt(y[i]) : 0;
            if (u != v) return Integer.compare(u, v);
        }
        return 0;
    }

    /** Crea o actualiza el perfil del modpack en el launcher oficial. Devuelve null si va bien, o el motivo. */
    @SuppressWarnings("unchecked")
    static String ensureProfile(Path gameDir, String mcVersion) {
        String neo = findNeoForge(mcVersion);
        if (neo == null) return "NEOFORGE";
        Path file = minecraftDir().resolve("launcher_profiles.json");
        if (!Files.exists(file)) return "No se encontró el launcher oficial de Minecraft (" + file + ").";
        try {
            Map<String, Object> root = (Map<String, Object>) Json.parse(Files.readString(file));
            Map<String, Object> profiles = (Map<String, Object>) root.computeIfAbsent("profiles", k -> new LinkedHashMap<>());
            Map<String, Object> p = (Map<String, Object>) profiles.get(PROFILE_ID);
            String now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString();
            if (p == null) {
                p = new LinkedHashMap<>();
                p.put("created", now);
                p.put("icon", "Furnace");
                p.put("javaArgs", RAM + " -XX:+UseG1GC");
                profiles.put(PROFILE_ID, p);
            }
            p.put("name", PACK_NAME);
            p.put("type", "custom");
            p.put("lastVersionId", neo);
            p.put("gameDir", gameDir.toAbsolutePath().toString());
            p.put("lastUsed", now);
            Path backup = file.resolveSibling("launcher_profiles.json.bak");
            Files.copy(file, backup, StandardCopyOption.REPLACE_EXISTING);
            Files.writeString(file, Json.write(root));
            return null;
        } catch (Exception e) {
            return "No se pudo crear el perfil: " + e.getMessage();
        }
    }

    static final String STORE_PACKAGE = "Microsoft.4297127D64EC6_8wekyb3d8bbwe";

    static String legacyLauncherExe() {
        for (String env : new String[]{"ProgramFiles(x86)", "ProgramFiles"}) {
            String pf = System.getenv(env);
            if (pf != null && Files.exists(Paths.get(pf, "Minecraft Launcher", "MinecraftLauncher.exe")))
                return Paths.get(pf, "Minecraft Launcher", "MinecraftLauncher.exe").toString();
        }
        return null;
    }

    /** ¿Está instalado el launcher oficial (Microsoft Store/Xbox o el instalador clásico)? */
    static boolean officialInstalled() {
        if (Files.exists(minecraftDir().resolve("launcher_profiles.json"))) return true;
        if (isWindows()) {
            String local = System.getenv("LOCALAPPDATA");
            return (local != null && Files.isDirectory(Paths.get(local, "Packages", STORE_PACKAGE))) || legacyLauncherExe() != null;
        }
        if (isMac()) return Files.exists(Paths.get("/Applications/Minecraft.app"));
        return false;
    }

    static void openOfficialLauncher() throws IOException {
        if (isWindows()) {
            String exe = legacyLauncherExe();
            String local = System.getenv("LOCALAPPDATA");
            boolean store = local != null && Files.isDirectory(Paths.get(local, "Packages", STORE_PACKAGE));
            if (exe != null && !store) new ProcessBuilder(exe).start();
            else new ProcessBuilder("explorer.exe", "shell:AppsFolder\\" + STORE_PACKAGE + "!Minecraft").start();
        } else if (isMac()) {
            new ProcessBuilder("open", "-a", "Minecraft").start();
        } else {
            new ProcessBuilder("minecraft-launcher").start();
        }
    }

    // ---------- Noticias y versión del launcher ----------

    @SuppressWarnings("unchecked")
    static String newsHtml() {
        try {
            Object parsed = Json.parse(getText(RAW_BASE + "/" + BRANCH + "/news.json"));
            StringBuilder sb = new StringBuilder();
            for (Object o : (List<Object>) parsed) {
                Map<String, Object> n = (Map<String, Object>) o;
                sb.append("<p style='margin:0 0 12px 0'><span style='font-family:\"Grenze Gotisch\";font-size:15px;color:#FFFFFF'>")
                  .append(esc(String.valueOf(n.getOrDefault("titulo", "")))).append("</span>")
                  .append(" &nbsp;<span style='color:#9A9AB2'>").append(esc(String.valueOf(n.getOrDefault("fecha", "")))).append("</span><br>")
                  .append(esc(String.valueOf(n.getOrDefault("texto", ""))).replace("\n", "<br>")).append("</p>");
            }
            return htmlWrap(sb.toString());
        } catch (Exception e) {
            return htmlWrap("<p style='color:#9A9AB2'>No se pudieron cargar las novedades.</p>");
        }
    }

    static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }

    record LauncherRelease(String version, String pageUrl, String jarUrl) {}

    /** La release más nueva del launcher, si es más nueva que esta. */
    @SuppressWarnings("unchecked")
    static LauncherRelease newerLauncher() {
        try {
            Map<String, Object> r = (Map<String, Object>) Json.parse(getText(API_BASE + "/releases/latest"));
            String tag = String.valueOf(r.get("tag_name")).replaceFirst("^[vV]", "");
            if (compareVersions(tag, LAUNCHER_VERSION) <= 0) return null;
            String jar = null;
            Object assets = r.get("assets");
            if (assets instanceof List<?> l)
                for (Object o : l) {
                    Map<String, Object> a = (Map<String, Object>) o;
                    if ("Derisomod-Launcher.jar".equals(a.get("name"))) jar = String.valueOf(a.get("browser_download_url"));
                }
            return new LauncherRelease(tag, String.valueOf(r.get("html_url")), jar);
        } catch (Exception ignored) { }
        return null;
    }

    /** ¿Ya está descargada (pendiente de reiniciar) esta versión? */
    static boolean launcherAlreadyDownloaded(String version) {
        try {
            Path v = APP_DIR.resolve("launcher-new.version");
            return Files.exists(v) && Files.exists(APP_DIR.resolve("launcher-new.jar")) && Files.readString(v).trim().equals(version);
        } catch (Exception e) { return false; }
    }

    /** Descarga el launcher nuevo junto al arrancador; se usará al abrirlo otra vez. */
    static void downloadLauncher(LauncherRelease rel) throws Exception {
        Files.createDirectories(APP_DIR);
        Path part = APP_DIR.resolve("launcher-new.jar.part");
        HttpRequest req = HttpRequest.newBuilder(URI.create(rel.jarUrl())).header("User-Agent", PACK_NAME + "-Launcher").build();
        HttpResponse<Path> r = HTTP.send(req, HttpResponse.BodyHandlers.ofFile(part));
        if (r.statusCode() != 200) throw new IOException("HTTP " + r.statusCode());
        try (var zip = new java.util.zip.ZipFile(part.toFile())) {
            if (zip.getEntry("Launcher.class") == null) throw new IOException("El jar descargado no es el launcher");
        }
        Files.move(part, APP_DIR.resolve("launcher-new.jar"), StandardCopyOption.REPLACE_EXISTING);
        Files.writeString(APP_DIR.resolve("launcher-new.version"), rel.version());
    }

    /** Cierra el launcher y lo vuelve a abrir (el arrancador cogerá la versión nueva). */
    static void restartLauncher() throws IOException {
        ProcessHandle.Info info = ProcessHandle.current().info();
        String cmd = info.command().orElseThrow(() -> new IOException("no se sabe cómo reiniciar"));
        List<String> c = new ArrayList<>();
        c.add(cmd);
        info.arguments().ifPresent(a -> c.addAll(Arrays.asList(a)));
        new ProcessBuilder(c).start();
        System.exit(0);
    }

    // ---------- Destinos: launcher oficial, Modrinth, Prism ----------

    enum Kind { OFFICIAL, MODRINTH, PRISM, CUSTOM }

    record Target(Kind kind, String name, Path dir, String instanceId) {
        String label() {
            return switch (kind) {
                case OFFICIAL -> "Launcher oficial";
                case MODRINTH -> "Modrinth · " + name;
                case PRISM -> "Prism · " + name;
                case CUSTOM -> "Carpeta · " + dir.getFileName();
            };
        }
    }

    static Path appData() {
        String home = System.getProperty("user.home");
        if (isWindows()) { String a = System.getenv("APPDATA"); return Paths.get(a != null ? a : home); }
        if (isMac()) return Paths.get(home, "Library", "Application Support");
        String xdg = System.getenv("XDG_DATA_HOME");
        return xdg != null ? Paths.get(xdg) : Paths.get(home, ".local", "share");
    }

    static List<Path> subdirs(Path dir) {
        List<Path> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, Files::isDirectory)) {
            for (Path p : ds) if (!p.getFileName().toString().startsWith(".") && !p.getFileName().toString().startsWith("_")) out.add(p);
        } catch (IOException ignored) { }
        out.sort(Comparator.comparing(p -> p.getFileName().toString().toLowerCase(Locale.ROOT)));
        return out;
    }

    /** Busca las instancias de Modrinth App y Prism Launcher que tenga el jugador. */
    static List<Target> detectTargets() {
        List<Target> t = new ArrayList<>();
        t.add(new Target(Kind.OFFICIAL, "Launcher oficial", defaultGameDir(), null));
        for (String app : List.of("ModrinthApp", "com.modrinth.theseus"))
            for (Path p : subdirs(appData().resolve(app).resolve("profiles")))
                t.add(new Target(Kind.MODRINTH, p.getFileName().toString(), p, null));
        List<Path> prismRoots = new ArrayList<>(List.of(appData().resolve("PrismLauncher").resolve("instances")));
        if (!isWindows() && !isMac()) prismRoots.add(Paths.get(System.getProperty("user.home"), ".var", "app",
                "org.prismlauncher.PrismLauncher", "data", "PrismLauncher", "instances"));
        for (Path root : prismRoots)
            for (Path p : subdirs(root)) {
                Path mc = Files.isDirectory(p.resolve("minecraft")) ? p.resolve("minecraft") : p.resolve(".minecraft");
                if (Files.exists(p.resolve("instance.cfg")))
                    t.add(new Target(Kind.PRISM, p.getFileName().toString(), mc, p.getFileName().toString()));
            }
        return t;
    }

    static Target targetFromSettings(Properties s, List<Target> detected) {
        String kind = s.getProperty("targetKind"), dir = s.getProperty("targetDir");
        if (kind != null && dir != null) {
            for (Target t : detected) if (t.kind().name().equals(kind) && t.dir().toString().equals(dir)) return t;
            if (kind.equals("CUSTOM")) return new Target(Kind.CUSTOM, dir, Paths.get(dir), null);
        }
        // Primera vez: si ya hay una instancia con el nombre del pack, usamos esa
        for (Target t : detected)
            if (t.kind() != Kind.OFFICIAL && t.name().toLowerCase(Locale.ROOT).contains(PACK_NAME.toLowerCase(Locale.ROOT))) return t;
        return detected.get(0);
    }

    static boolean tryStart(String... cmd) {
        try {
            if (cmd[0].contains(File.separator) && !Files.exists(Paths.get(cmd[0]))) return false;
            new ProcessBuilder(cmd).start();
            return true;
        } catch (IOException e) { return false; }
    }

    static boolean openModrinth() {
        if (isWindows()) {
            String local = System.getenv("LOCALAPPDATA"), pf = System.getenv("ProgramFiles");
            return (local != null && tryStart(local + "\\Modrinth App\\Modrinth App.exe"))
                    || (local != null && tryStart(local + "\\Programs\\Modrinth App\\Modrinth App.exe"))
                    || (pf != null && tryStart(pf + "\\Modrinth App\\Modrinth App.exe"));
        }
        if (isMac()) return tryStart("open", "-a", "Modrinth App");
        return tryStart("ModrinthApp") || tryStart("modrinth-app");
    }

    /**
     * Identificador interno de un perfil de Modrinth App.
     * Desde 2026 Modrinth guarda las instancias en app.db (SQLite) con un id tipo "local:<uuid>";
     * en versiones anteriores el id era el nombre de la carpeta.
     * Devuelve null si no se puede averiguar.
     */
    static String modrinthInstanceId(Path profileDir) {
        String folder = profileDir.getFileName().toString();
        Path appDir = profileDir.getParent() != null ? profileDir.getParent().getParent() : null;
        if (appDir == null || !Files.exists(appDir.resolve("app.db"))) return folder;
        Path tmp = null;
        try {
            Class.forName("org.sqlite.JDBC");
            // Copia de la base de datos (y su WAL) para no interferir con Modrinth mientras está abierto
            tmp = Files.createTempDirectory("mrdb");
            Files.copy(appDir.resolve("app.db"), tmp.resolve("app.db"));
            if (Files.exists(appDir.resolve("app.db-wal"))) Files.copy(appDir.resolve("app.db-wal"), tmp.resolve("app.db-wal"));
            try (java.sql.Connection c = java.sql.DriverManager.getConnection("jdbc:sqlite:" + tmp.resolve("app.db"))) {
                boolean hasTable;
                try (var rs = c.getMetaData().getTables(null, null, "instances", null)) { hasTable = rs.next(); }
                if (!hasTable) return folder; // Modrinth antiguo
                try (var st = c.prepareStatement("SELECT id, path FROM instances");
                     var rs = st.executeQuery()) {
                    while (rs.next()) {
                        String path = rs.getString(2).replace('\\', '/');
                        if (path.equals(folder) || path.endsWith("/" + folder)) return rs.getString(1);
                    }
                }
            }
            return null;
        } catch (Throwable e) {
            return null;
        } finally {
            if (tmp != null) try (var w = Files.walk(tmp)) {
                w.sorted(Comparator.reverseOrder()).forEach(x -> { try { Files.deleteIfExists(x); } catch (IOException ignored) { } });
            } catch (IOException ignored) { }
        }
    }

    /** Modrinth App arranca un perfil con el enlace modrinth://launch/instance/<id>. */
    static boolean launchModrinth(Target t) {
        String rawId = modrinthInstanceId(t.dir());
        if (rawId == null) return false;
        String id = URLEncoder.encode(rawId, StandardCharsets.UTF_8).replace("+", "%20");
        URI uri = URI.create("modrinth://launch/instance/" + id);
        try {
            if (isWindows()) { new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", uri.toString()).start(); return true; }
            if (isMac()) return tryStart("open", uri.toString());
            if (tryStart("xdg-open", uri.toString())) return true;
            Desktop.getDesktop().browse(uri);
            return true;
        } catch (Exception e) { return false; }
    }

    static boolean launchPrism(String instanceId) {
        if (isWindows()) {
            String local = System.getenv("LOCALAPPDATA"), pf = System.getenv("ProgramFiles");
            return (local != null && tryStart(local + "\\Programs\\PrismLauncher\\prismlauncher.exe", "--launch", instanceId))
                    || (pf != null && tryStart(pf + "\\PrismLauncher\\prismlauncher.exe", "--launch", instanceId));
        }
        if (isMac()) return tryStart("/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher", "--launch", instanceId);
        return tryStart("prismlauncher", "--launch", instanceId)
                || tryStart("flatpak", "run", "org.prismlauncher.PrismLauncher", "--launch", instanceId);
    }

    // ---------- Crear la instancia automáticamente ----------

    static boolean modrinthInstalled() {
        return Files.isDirectory(appData().resolve("ModrinthApp")) || Files.isDirectory(appData().resolve("com.modrinth.theseus"));
    }

    static boolean prismInstalled() {
        return Files.isDirectory(appData().resolve("PrismLauncher"))
                || Files.isDirectory(Paths.get(System.getProperty("user.home"), ".var", "app", "org.prismlauncher.PrismLauncher"));
    }

    static Path cacheDir() throws IOException {
        Path d = defaultGameDir().resolveSibling("." + PROFILE_ID + "-cache");
        Files.createDirectories(d);
        return d;
    }

    /**
     * Crea un .mrpack mínimo (formato de Modrinth) que solo dice "Minecraft X + NeoForge Y".
     * Modrinth y Prism lo importan y crean la instancia con NeoForge ya instalado;
     * después este launcher se encarga de los mods.
     */
    static Path buildMrpack(Manifest m) throws IOException {
        Map<String, Object> deps = new LinkedHashMap<>();
        deps.put("minecraft", m.minecraft());
        deps.put("neoforge", m.neoforge());
        Map<String, Object> idx = new LinkedHashMap<>();
        idx.put("formatVersion", new Json.Num("1"));
        idx.put("game", "minecraft");
        idx.put("versionId", m.version());
        idx.put("name", PACK_NAME);
        idx.put("summary", "Instancia del modpack " + PACK_NAME + ". Los mods los instala " + PACK_NAME + " Launcher.");
        idx.put("files", new ArrayList<>());
        idx.put("dependencies", deps);
        Path out = cacheDir().resolve(PACK_NAME + ".mrpack");
        try (var zip = new java.util.zip.ZipOutputStream(Files.newOutputStream(out))) {
            zip.putNextEntry(new java.util.zip.ZipEntry("modrinth.index.json"));
            zip.write(Json.write(idx).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return out;
    }

    static boolean openWithModrinth(Path mrpack) {
        if (isWindows()) {
            String local = System.getenv("LOCALAPPDATA"), pf = System.getenv("ProgramFiles");
            for (String exe : new String[]{local + "\\Modrinth App\\Modrinth App.exe", local + "\\Programs\\Modrinth App\\Modrinth App.exe",
                    pf + "\\Modrinth App\\Modrinth App.exe"})
                if (tryStart(exe, mrpack.toString())) return true;
        }
        if (isMac() && tryStart("open", "-a", "Modrinth App", mrpack.toString())) return true;
        try { Desktop.getDesktop().open(mrpack.toFile()); return true; } catch (Exception e) { return false; }
    }

    static boolean openWithPrism(Path mrpack) {
        String p = mrpack.toString();
        if (isWindows()) {
            String local = System.getenv("LOCALAPPDATA"), pf = System.getenv("ProgramFiles");
            return (local != null && tryStart(local + "\\Programs\\PrismLauncher\\prismlauncher.exe", "--import", p))
                    || (pf != null && tryStart(pf + "\\PrismLauncher\\prismlauncher.exe", "--import", p));
        }
        if (isMac()) return tryStart("/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher", "--import", p);
        return tryStart("prismlauncher", "--import", p) || tryStart("flatpak", "run", "org.prismlauncher.PrismLauncher", "--import", p);
    }

    /** Descarga el instalador oficial de NeoForge y lo ejecuta sin ventanas sobre .minecraft. */
    static void installNeoForge(String version, Progress progress) throws Exception {
        Path mc = minecraftDir();
        if (!Files.exists(mc.resolve("launcher_profiles.json"))) {
            // Launcher oficial instalado pero nunca abierto: el instalador de NeoForge solo necesita que exista este archivo
            Files.createDirectories(mc);
            Files.writeString(mc.resolve("launcher_profiles.json"), "{\n  \"profiles\" : {},\n  \"settings\" : {},\n  \"version\" : 3\n}\n");
        }
        String url = "https://maven.neoforged.net/releases/net/neoforged/neoforge/" + version + "/neoforge-" + version + "-installer.jar";
        Path jar = cacheDir().resolve("neoforge-" + version + "-installer.jar");
        progress.update("Descargando NeoForge " + version + "…", 0.05);
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).header("User-Agent", PACK_NAME + "-Launcher").build();
        HttpResponse<Path> r = HTTP.send(req, HttpResponse.BodyHandlers.ofFile(jar));
        if (r.statusCode() != 200) throw new IOException("No se pudo descargar NeoForge (HTTP " + r.statusCode() + ")");
        Path java = Paths.get(System.getProperty("java.home"), "bin", isWindows() ? "java.exe" : "java");
        if (!Files.exists(java)) throw new IOException("No se encontró Java para ejecutar el instalador de NeoForge.");
        progress.update("Instalando NeoForge " + version + " (puede tardar un par de minutos)…", 0.3);
        Process proc = new ProcessBuilder(java.toString(), "-jar", jar.toString(), "--install-client", mc.toString())
                .directory(cacheDir().toFile()).redirectErrorStream(true)
                .redirectOutput(cacheDir().resolve("neoforge-install.log").toFile()).start();
        double f = 0.3;
        while (proc.isAlive()) {
            Thread.sleep(500);
            f = Math.min(0.95, f + 0.004);
            progress.update("Instalando NeoForge " + version + " (puede tardar un par de minutos)…", f);
        }
        if (proc.exitValue() != 0 || findNeoForge("1." + version.substring(0, version.lastIndexOf('.'))) == null)
            throw new IOException("La instalación de NeoForge falló. Mira el registro en:\n" + cacheDir().resolve("neoforge-install.log"));
        progress.update("NeoForge instalado", 1);
    }

    // ---------- Estilo ----------

    static final Color BG_TOP = new Color(0x0D0D1F), BG_BOTTOM = new Color(0x38384A);
    static final Color TEXT = new Color(0xECECF4), MUTED = new Color(0x9A9AB2), LINE = new Color(255, 255, 255, 40);
    static Font gothicBold, gothicMedium, body;

    static Font loadFont(String res, float fallbackSize) {
        try (InputStream in = Launcher.class.getResourceAsStream("/" + res)) {
            Font f = Font.createFont(Font.TRUETYPE_FONT, in);
            GraphicsEnvironment.getLocalGraphicsEnvironment().registerFont(f);
            return f;
        } catch (Exception e) { return new Font(Font.SERIF, Font.BOLD, (int) fallbackSize); }
    }

    static void loadStyle() {
        gothicBold = loadFont("GrenzeGotisch-Bold.ttf", 48);
        gothicMedium = loadFont("GrenzeGotisch-Medium.ttf", 20);
        String fam = Arrays.asList(GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames()).contains("Segoe UI")
                ? "Segoe UI" : Font.SANS_SERIF;
        body = new Font(fam, Font.PLAIN, 13);
        Color panel = new Color(0x1E1E30);
        for (String k : List.of("OptionPane.background", "Panel.background")) UIManager.put(k, panel);
        UIManager.put("OptionPane.messageForeground", TEXT);
        UIManager.put("Label.foreground", TEXT);
        UIManager.put("PopupMenu.background", panel);
        UIManager.put("PopupMenu.border", BorderFactory.createLineBorder(LINE));
        UIManager.put("MenuItem.background", panel);
        UIManager.put("MenuItem.foreground", TEXT);
        UIManager.put("MenuItem.selectionBackground", new Color(0x45455C));
        UIManager.put("MenuItem.selectionForeground", Color.WHITE);
        UIManager.put("Separator.foreground", LINE);
    }

    static Image appIcon() {
        try (InputStream in = Launcher.class.getResourceAsStream("/icon.png")) { return javax.imageio.ImageIO.read(in); }
        catch (Exception e) { return null; }
    }

    /** Fondo con degradado. */
    static final class Backdrop extends JPanel {
        Backdrop(LayoutManager l) { super(l); setOpaque(true); }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setPaint(new GradientPaint(0, 0, BG_TOP, getWidth() * 0.35f, getHeight(), BG_BOTTOM));
            g2.fillRect(0, 0, getWidth(), getHeight());
            g2.dispose();
        }
    }

    /** El sigilo: gira mientras se descarga y frena suavemente al terminar. */
    static final class Sigil extends JComponent {
        private final Image img;
        private double angle, speed, targetSpeed;
        private final javax.swing.Timer timer;

        Sigil() {
            Image i = null;
            try (InputStream in = Launcher.class.getResourceAsStream("/sigil.png")) { i = javax.imageio.ImageIO.read(in); }
            catch (Exception ignored) { }
            img = i;
            setOpaque(false);
            timer = new javax.swing.Timer(16, e -> {
                speed += (targetSpeed - speed) * 0.04;
                if (targetSpeed == 0 && speed < 0.01) { speed = 0; ((javax.swing.Timer) e.getSource()).stop(); }
                angle = (angle + speed) % 360;
                repaint();
            });
        }

        void spin(boolean on) {
            targetSpeed = on ? 2.2 : 0;
            if (on && !timer.isRunning()) timer.start();
            if (!on && speed > 0 && !timer.isRunning()) timer.start();
        }

        @Override protected void paintComponent(Graphics g) {
            if (img == null) return;
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g2.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            int size = Math.min(getWidth(), getHeight()) - 20;
            double cx = getWidth() / 2.0, cy = getHeight() / 2.0;
            // halo suave detrás
            float r = size * 0.5f;
            g2.setPaint(new RadialGradientPaint(new java.awt.geom.Point2D.Double(cx, cy), r,
                    new float[]{0f, 1f}, new Color[]{new Color(255, 255, 255, 26), new Color(255, 255, 255, 0)}));
            g2.fill(new java.awt.geom.Ellipse2D.Double(cx - r, cy - r, r * 2, r * 2));
            g2.rotate(Math.toRadians(angle), cx, cy);
            g2.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.92f));
            g2.drawImage(img, (int) (cx - size / 2.0), (int) (cy - size / 2.0), size, size, null);
            g2.dispose();
        }
    }

    /** Barra de progreso fina. */
    static final class Bar extends JComponent {
        double value;
        Bar() { setPreferredSize(new Dimension(10, 8)); }
        void set(double v) { value = Math.max(0, Math.min(1, v)); repaint(); }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            int h = getHeight(), w = getWidth();
            g2.setColor(new Color(255, 255, 255, 30));
            g2.fillRoundRect(0, 0, w, h, h, h);
            int fw = (int) Math.round(w * value);
            if (fw > 0) {
                g2.setPaint(new GradientPaint(0, 0, new Color(0xB8B8D0), w, 0, Color.WHITE));
                g2.fillRoundRect(0, 0, Math.max(fw, h), h, h, h);
            }
            g2.dispose();
        }
    }

    /** Botón plano: relleno blanco (principal) o contorno (secundario). */
    static final class FlatButton extends JButton {
        private final boolean primary;
        private boolean hover;
        FlatButton(String text, boolean primary) {
            super(text);
            this.primary = primary;
            setFont(gothicMedium.deriveFont(primary ? 20f : 17f));
            setContentAreaFilled(false); setBorderPainted(false); setFocusPainted(false); setOpaque(false);
            setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
            setBorder(new EmptyBorder(6, primary ? 26 : 16, 6, primary ? 26 : 16));
            addMouseListener(new java.awt.event.MouseAdapter() {
                public void mouseEntered(java.awt.event.MouseEvent e) { hover = true; repaint(); }
                public void mouseExited(java.awt.event.MouseEvent e) { hover = false; repaint(); }
            });
        }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            int w = getWidth(), h = getHeight();
            boolean on = isEnabled();
            if (primary) {
                g2.setColor(!on ? new Color(255, 255, 255, 45) : hover ? Color.WHITE : new Color(0xE6E6F0));
                g2.fillRoundRect(0, 0, w, h, 10, 10);
                g2.setColor(on ? BG_TOP : new Color(255, 255, 255, 110));
            } else {
                g2.setColor(hover && on ? new Color(255, 255, 255, 28) : new Color(0, 0, 0, 0));
                g2.fillRoundRect(0, 0, w, h, 10, 10);
                g2.setColor(on ? new Color(255, 255, 255, 90) : new Color(255, 255, 255, 35));
                g2.drawRoundRect(0, 0, w - 1, h - 1, 10, 10);
                g2.setColor(on ? TEXT : new Color(255, 255, 255, 80));
            }
            FontMetrics fm = g2.getFontMetrics(getFont());
            g2.setFont(getFont());
            g2.drawString(getText(), (w - fm.stringWidth(getText())) / 2, (h - fm.getHeight()) / 2 + fm.getAscent());
            g2.dispose();
        }
    }

    static JLabel label(String text, Font f, Color c) {
        JLabel l = new JLabel(text);
        l.setFont(f);
        l.setForeground(c);
        return l;
    }

    // ---------- Interfaz ----------

    static Target target;
    static Path gameDir;
    static JLabel status, targetLabel;
    static Bar bar;
    static Sigil sigil;
    static FlatButton updateBtn, playBtn;
    static JEditorPane news;
    static Plan currentPlan;
    static Properties settings;
    static boolean checking;
    static volatile boolean busy;           // descargando el modpack o creando instancias
    static FlatButton checkBtn;
    static String launcherOffered;          // versión del launcher ya avisada en esta sesión

    public static void main(String[] args) throws Exception {
        if (args.length >= 1 && args[0].equals("--version")) {
            System.out.println(LAUNCHER_VERSION + " desde " + Launcher.class.getProtectionDomain().getCodeSource().getLocation());
            return;
        }
        if (args.length >= 2 && args[0].equals("--sync")) { headless(Paths.get(args[1])); return; }
        System.setProperty("awt.useSystemAAFontSettings", "on");
        SwingUtilities.invokeLater(Launcher::buildUi);
    }

    /** Modo sin ventana para pruebas: java Launcher.java --sync <carpeta> */
    static void headless(Path dir) throws Exception {
        Manifest m = fetchManifest();
        Plan p = plan(dir, m);
        System.out.println("Versión " + m.version() + " (commit " + m.commit() + "): " + p.downloads().size()
                + " descargas, " + p.deletions().size() + " borrados, " + p.bytes() / 1024 + " KB");
        apply(dir, p, (t, f) -> { });
        System.out.println("Tras actualizar: " + (plan(dir, m).upToDate() ? "todo al día" : "FALTAN COSAS"));
    }

    static void buildUi() {
        loadStyle();
        settings = loadSettings();
        setTarget(targetFromSettings(settings, detectTargets()), false);

        JFrame f = new JFrame(PACK_NAME + " Launcher");
        f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        Image icon = appIcon();
        if (icon != null) f.setIconImage(icon);

        Backdrop root = new Backdrop(new BorderLayout(24, 0));
        root.setBorder(new EmptyBorder(22, 22, 22, 26));

        sigil = new Sigil();
        sigil.setPreferredSize(new Dimension(340, 340));
        root.add(sigil, BorderLayout.WEST);

        JPanel right = new JPanel(new BorderLayout(0, 12));
        right.setOpaque(false);

        JPanel header = new JPanel();
        header.setOpaque(false);
        header.setLayout(new BoxLayout(header, BoxLayout.Y_AXIS));
        header.add(label(PACK_NAME, gothicBold.deriveFont(60f), Color.WHITE));
        header.add(label("Modpack · Minecraft 1.21.1 · NeoForge · launcher " + LAUNCHER_VERSION, body.deriveFont(12f), MUTED));
        right.add(header, BorderLayout.NORTH);

        news = new JEditorPane("text/html", "");
        news.setEditable(false);
        news.setOpaque(false);
        news.setBackground(new Color(0, 0, 0, 0));
        news.putClientProperty(JEditorPane.HONOR_DISPLAY_PROPERTIES, Boolean.TRUE);
        news.setFont(body);
        news.setText(htmlWrap("<p style='color:#9A9AB2'>Cargando novedades…</p>"));
        JScrollPane sp = new JScrollPane(news);
        sp.setOpaque(false);
        sp.getViewport().setOpaque(false);
        sp.setBorder(BorderFactory.createEmptyBorder());
        JPanel newsBox = new JPanel(new BorderLayout(0, 6));
        newsBox.setOpaque(false);
        JLabel newsTitle = label("Novedades", gothicMedium.deriveFont(24f), Color.WHITE);
        newsTitle.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createMatteBorder(0, 0, 1, 0, LINE), new EmptyBorder(0, 0, 4, 0)));
        newsBox.add(newsTitle, BorderLayout.NORTH);
        newsBox.add(sp, BorderLayout.CENTER);
        right.add(newsBox, BorderLayout.CENTER);

        status = label("Comprobando actualizaciones…", body.deriveFont(13f), TEXT);
        bar = new Bar();
        updateBtn = new FlatButton("Actualizar", true);
        playBtn = new FlatButton("Jugar", true);
        FlatButton folderBtn = new FlatButton("Abrir carpeta", false);
        checkBtn = new FlatButton("Comprobar", false);
        checkBtn.setToolTipText("Buscar actualizaciones ahora");
        checkBtn.addActionListener(e -> check());
        updateBtn.setEnabled(false);
        playBtn.setEnabled(false);
        updateBtn.addActionListener(e -> { if (currentPlan == null) check(); else doUpdate(); });
        playBtn.addActionListener(e -> doPlay());
        folderBtn.addActionListener(e -> {
            try { Files.createDirectories(gameDir); Desktop.getDesktop().open(gameDir.toFile()); }
            catch (Exception ex) { error(ex.getMessage()); }
        });

        targetLabel = label("", body.deriveFont(12f), MUTED);
        targetLabel.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        targetLabel.addMouseListener(new java.awt.event.MouseAdapter() {
            public void mouseClicked(java.awt.event.MouseEvent e) { showTargetMenu(f, targetLabel); }
        });
        refreshTargetLabel();
        targetLabel.setBorder(new EmptyBorder(6, 0, 0, 0));
        header.add(targetLabel);

        JPanel statusRow = new JPanel(new BorderLayout());
        statusRow.setOpaque(false);
        statusRow.add(status, BorderLayout.WEST);

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 0));
        buttons.setOpaque(false);
        buttons.add(checkBtn);
        buttons.add(folderBtn);
        buttons.add(updateBtn);
        buttons.add(playBtn);

        JPanel actionRow = new JPanel(new BorderLayout());
        actionRow.setOpaque(false);
        actionRow.add(buttons, BorderLayout.EAST);

        JPanel bottom = new JPanel(new BorderLayout(0, 10));
        bottom.setOpaque(false);
        bottom.add(statusRow, BorderLayout.NORTH);
        bottom.add(bar, BorderLayout.CENTER);
        bottom.add(actionRow, BorderLayout.SOUTH);
        right.add(bottom, BorderLayout.SOUTH);

        root.add(right, BorderLayout.CENTER);
        f.setContentPane(root);
        f.setSize(940, 520);
        f.setMinimumSize(new Dimension(820, 460));
        f.setLocationRelativeTo(null);
        f.setVisible(true);
        firstRun(f);
    }

    /** Primera vez: si tiene Modrinth o Prism y no hay instancia del pack, ofrece crearla. */
    static boolean anyLauncherInstalled() { return modrinthInstalled() || prismInstalled() || officialInstalled(); }

    /** PC sin ningún launcher: ofrece instalar uno y sigue solo en cuanto aparece. */
    static void noLauncher(JFrame f) {
        String[] opts = {"Instalar Modrinth (recomendado)", "Instalar launcher oficial", "Cancelar"};
        int r = JOptionPane.showOptionDialog(f, "Para jugar necesitas un launcher de Minecraft y no hay ninguno en este PC.\n\n"
                        + "Instala uno (y entra con tu cuenta de Microsoft). Cuando termine, este launcher seguirá solo.",
                PACK_NAME, JOptionPane.DEFAULT_OPTION, JOptionPane.INFORMATION_MESSAGE, null, opts, opts[0]);
        if (r == 0 || r == 1) {
            try { Desktop.getDesktop().browse(URI.create(r == 0 ? "https://modrinth.com/app" : "https://www.minecraft.net/download")); }
            catch (Exception ignored) { }
        }
        status.setText("Esperando a que instales un launcher de Minecraft…");
        if (waitTimer != null) waitTimer.stop();
        waitTimer = new javax.swing.Timer(3000, e -> {
            if (anyLauncherInstalled()) {
                ((javax.swing.Timer) e.getSource()).stop();
                setTarget(targetFromSettings(new Properties(), detectTargets()), false);
                refreshTargetLabel();
                firstRun(f);
            }
        });
        waitTimer.start();
        check();
    }

    static void firstRun(JFrame f) {
        boolean firstTime = settings.getProperty("targetKind") == null;
        if (firstTime && !anyLauncherInstalled()) { noLauncher(f); return; }
        boolean m = modrinthInstalled(), p = prismInstalled();
        if (!firstTime || target.kind() != Kind.OFFICIAL || (!m && !p)) { check(); return; }
        List<String> opts = new ArrayList<>();
        if (m) opts.add("Modrinth");
        if (p) opts.add("Prism");
        opts.add("Launcher oficial");
        int r = JOptionPane.showOptionDialog(f, "¿Con qué launcher juegas?\n\nSe creará la instancia de " + PACK_NAME
                        + " con NeoForge ya instalado; no tienes que configurar nada.",
                PACK_NAME, JOptionPane.DEFAULT_OPTION, JOptionPane.QUESTION_MESSAGE, null, opts.toArray(), opts.get(0));
        String pick = r >= 0 ? opts.get(r) : "Launcher oficial";
        if (pick.equals("Modrinth")) createInstance(Kind.MODRINTH);
        else if (pick.equals("Prism")) createInstance(Kind.PRISM);
        else chooseTarget(target);
    }

    static javax.swing.Timer waitTimer;

    /** Genera el .mrpack, lo abre en Modrinth/Prism y espera a que aparezca la instancia nueva. */
    static void createInstance(Kind kind) {
        String app = kind == Kind.MODRINTH ? "Modrinth" : "Prism";
        Set<Path> before = new HashSet<>();
        for (Target t : detectTargets()) before.add(t.dir());
        updateBtn.setEnabled(false);
        playBtn.setEnabled(false);
        busy = true;
        status.setText("Preparando la instancia para " + app + "…");
        new SwingWorker<Boolean, Void>() {
            protected Boolean doInBackground() throws Exception {
                Manifest m = currentPlan != null ? currentPlan.manifest() : fetchManifest();
                Path pack = buildMrpack(m);
                return kind == Kind.MODRINTH ? openWithModrinth(pack) : openWithPrism(pack);
            }
            protected void done() {
                boolean ok;
                try { ok = get(); } catch (Exception e) { ok = false; }
                if (!ok) {
                    busy = false;
                    error("No se pudo abrir " + app + ". Comprueba que está instalado.");
                    check();
                    return;
                }
                status.setText("Confirma la instalación en " + app + "… este launcher la detectará solo.");
                sigil.spin(true);
                long start = System.currentTimeMillis();
                if (waitTimer != null) waitTimer.stop();
                waitTimer = new javax.swing.Timer(2000, e -> {
                    for (Target t : detectTargets()) {
                        if (t.kind() == kind && !before.contains(t.dir())) {
                            ((javax.swing.Timer) e.getSource()).stop();
                            sigil.spin(false);
                            busy = false;
                            chooseTarget(t);
                            return;
                        }
                    }
                    if (System.currentTimeMillis() - start > 15 * 60_000) {
                        ((javax.swing.Timer) e.getSource()).stop();
                        sigil.spin(false);
                        busy = false;
                        status.setText("No apareció la instancia. Elígela en \"Instalar en\" cuando esté creada.");
                    }
                });
                waitTimer.start();
            }
        }.execute();
    }

    static String htmlWrap(String inner) {
        return "<html><body style='font-family:\"" + body.getFamily() + "\";font-size:11px;color:#ECECF4;margin:0'>" + inner + "</body></html>";
    }

    static void setTarget(Target t, boolean save) {
        target = t;
        gameDir = t.dir();
        if (save) {
            settings.setProperty("targetKind", t.kind().name());
            settings.setProperty("targetDir", t.dir().toString());
            saveSettings(settings);
        }
    }

    static void refreshTargetLabel() {
        targetLabel.setText("<html>Instalar en: <u>" + esc(target.label()) + "</u> ▾</html>");
    }

    static void showTargetMenu(Component parent, JComponent anchor) {
        JPopupMenu menu = new JPopupMenu();
        List<Target> list = detectTargets();
        for (Target t : list) {
            JMenuItem it = new JMenuItem((t.equals(target) ? "✓ " : "   ") + t.label());
            it.setFont(body);
            it.addActionListener(e -> chooseTarget(t));
            menu.add(it);
        }
        menu.addSeparator();
        if (modrinthInstalled()) {
            JMenuItem it = new JMenuItem("＋ Crear perfil en Modrinth");
            it.setFont(body);
            it.addActionListener(e -> createInstance(Kind.MODRINTH));
            menu.add(it);
        }
        if (prismInstalled()) {
            JMenuItem it = new JMenuItem("＋ Crear instancia en Prism");
            it.setFont(body);
            it.addActionListener(e -> createInstance(Kind.PRISM));
            menu.add(it);
        }
        JMenuItem other = new JMenuItem("   Otra carpeta…");
        other.setFont(body);
        other.addActionListener(e -> {
            JFileChooser ch = new JFileChooser(gameDir.toFile());
            ch.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
            if (ch.showOpenDialog(parent) == JFileChooser.APPROVE_OPTION) {
                Path p = ch.getSelectedFile().toPath();
                chooseTarget(new Target(Kind.CUSTOM, p.toString(), p, null));
            }
        });
        menu.add(other);
        menu.show(anchor, 0, anchor.getHeight());
    }

    static JMenuItem disabledItem(String text) {
        JMenuItem i = new JMenuItem(text);
        i.setFont(body.deriveFont(11f));
        i.setEnabled(false);
        return i;
    }

    static void chooseTarget(Target t) {
        if (waitTimer != null && waitTimer.isRunning()) { waitTimer.stop(); sigil.spin(false); }
        busy = false;
        setTarget(t, true);
        refreshTargetLabel();
        check();
    }

    static void check() { check(false); }

    static javax.swing.Timer autoCheck;

    /** Comprobación cada 10 minutos mientras el launcher está abierto (sin tocar nada si no hay cambios). */
    static void startAutoCheck() {
        if (autoCheck != null) return;
        autoCheck = new javax.swing.Timer(10 * 60_000, e -> {
            if (!busy && !checking && currentPlan != null) check(true);
        });
        autoCheck.start();
    }

    static void check(boolean quiet) {
        if (checking || busy) return;
        checking = true;
        checkBtn.setEnabled(false);
        if (!quiet) {
            currentPlan = null;
            updateBtn.setEnabled(false);
            playBtn.setEnabled(false);
            status.setText("Comprobando actualizaciones…");
        }
        startAutoCheck();
        new SwingWorker<Plan, Void>() {
            String html;
            LauncherRelease rel;
            protected Plan doInBackground() throws Exception {
                Manifest m = fetchManifest();
                html = newsHtml();
                if (!quiet) rel = newerLauncher();   // única consulta a la API: al abrir y con Comprobar
                return plan(gameDir, m);
            }
            protected void done() {
                checking = false;
                checkBtn.setEnabled(true);
                if (busy) return;
                try {
                    Plan p = get();
                    if (quiet && currentPlan != null && p.upToDate() == currentPlan.upToDate()
                            && p.manifest().version().equals(currentPlan.manifest().version()) && rel == null) return;
                    currentPlan = p;
                    updateBtn.setText("Actualizar");
                    updateBtn.setEnabled(false);
                    playBtn.setEnabled(false);
                    news.setText(html);
                    news.setCaretPosition(0);
                    if (currentPlan.upToDate()) {
                        status.setText("Todo al día · versión " + currentPlan.manifest().version());
                        bar.set(1);
                        playBtn.setEnabled(true);
                    } else {
                        status.setText("Actualización disponible · " + currentPlan.downloads().size() + " archivo(s), "
                                + mb(currentPlan.bytes()));
                        bar.set(0);
                        updateBtn.setEnabled(true);
                    }
                    if (rel != null) offerLauncherUpdate(rel);
                } catch (Exception e) {
                    if (quiet) return;
                    status.setText("No se pudo comprobar. ¿Tienes internet?");
                    updateBtn.setText("Reintentar");
                    updateBtn.setEnabled(true);
                }
            }
        }.execute();
    }

    /** Hay launcher nuevo: con el arrancador se descarga solo y se ofrece reiniciar; sin él, la página. */
    static void offerLauncherUpdate(LauncherRelease rel) {
        if (rel.version().equals(launcherOffered)) return;
        launcherOffered = rel.version();
        if (APP_DIR == null || rel.jarUrl() == null) {
            int r = JOptionPane.showConfirmDialog(null, "Hay una versión nueva del launcher (" + rel.version() + "). ¿Abrir la página de descarga?",
                    PACK_NAME, JOptionPane.YES_NO_OPTION);
            if (r == JOptionPane.YES_OPTION) try { Desktop.getDesktop().browse(URI.create(rel.pageUrl())); } catch (Exception ignored) { }
            return;
        }
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception {
                if (!launcherAlreadyDownloaded(rel.version())) downloadLauncher(rel);
                return null;
            }
            protected void done() {
                try { get(); } catch (Exception e) { launcherOffered = null; return; } // se reintenta en la próxima comprobación
                if (busy) {
                    status.setText(status.getText() + " · launcher " + rel.version() + " listo al reabrir");
                    return;
                }
                int r = JOptionPane.showConfirmDialog(null, "Se ha descargado el launcher " + rel.version() + ".\n¿Reiniciar ahora para usarlo?",
                        PACK_NAME, JOptionPane.YES_NO_OPTION);
                if (r == JOptionPane.YES_OPTION) {
                    try { restartLauncher(); }
                    catch (Exception e) { error("Cierra y vuelve a abrir el launcher para usar la versión " + rel.version() + "."); }
                } else status.setText(status.getText() + " · launcher " + rel.version() + " listo al reabrir");
            }
        }.execute();
    }

    static void doUpdate() {
        List<Path> del = currentPlan.deletions();
        if (!del.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < Math.min(8, del.size()); i++) sb.append("\n  • ").append(del.get(i).getFileName());
            if (del.size() > 8) sb.append("\n  … y ").append(del.size() - 8).append(" más");
            int r = JOptionPane.showConfirmDialog(null, "En " + target.label() + " hay " + del.size()
                            + " mod(s) que no son del modpack y se quitarán:" + sb + "\n\n¿Continuar?",
                    PACK_NAME, JOptionPane.OK_CANCEL_OPTION, JOptionPane.WARNING_MESSAGE);
            if (r != JOptionPane.OK_OPTION) return;
        }
        updateBtn.setText("Actualizar");
        updateBtn.setEnabled(false);
        checkBtn.setEnabled(false);
        busy = true;
        sigil.spin(true);
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception {
                apply(gameDir, currentPlan, (text, frac) -> SwingUtilities.invokeLater(() -> {
                    status.setText(text);
                    bar.set(frac);
                }));
                return null;
            }
            protected void done() {
                sigil.spin(false);
                busy = false;
                checkBtn.setEnabled(true);
                try {
                    get();
                    currentPlan = new Plan(currentPlan.manifest(), List.of(), List.of(), 0);
                    status.setText("Todo al día · versión " + currentPlan.manifest().version());
                    bar.set(1);
                    playBtn.setEnabled(true);
                } catch (Exception e) {
                    Throwable c = e.getCause() != null ? e.getCause() : e;
                    status.setText("Error al actualizar");
                    error(c.getMessage());
                    updateBtn.setEnabled(true);
                }
            }
        }.execute();
    }

    static void doPlay() {
        switch (target.kind()) {
            case MODRINTH -> {
                if (launchModrinth(target)) status.setText("Iniciando " + target.name() + " en Modrinth…");
                else if (openModrinth()) status.setText("Abriendo Modrinth… dale a Jugar en el perfil \"" + target.name() + "\".");
                else status.setText("Abre Modrinth y dale a Jugar en el perfil \"" + target.name() + "\".");
            }
            case PRISM -> {
                if (launchPrism(target.instanceId())) status.setText("Iniciando " + target.name() + " con Prism…");
                else status.setText("Abre Prism y dale a Jugar en \"" + target.name() + "\".");
            }
            case CUSTOM -> JOptionPane.showMessageDialog(null, "Modpack listo en:\n" + gameDir
                    + "\n\nAbre tu launcher y juega con la instancia que usa esa carpeta.", PACK_NAME, JOptionPane.INFORMATION_MESSAGE);
            case OFFICIAL -> {
                if (!officialInstalled()) {
                    if (modrinthInstalled() || prismInstalled()) {
                        error("El launcher oficial no está instalado. Elige Modrinth o Prism en \"Instalar en\".");
                    } else noLauncher((JFrame) SwingUtilities.getWindowAncestor(playBtn));
                    return;
                }
                playOfficial();
            }
        }
    }

    static void playOfficial() {
        String res = ensureProfile(gameDir, currentPlan.manifest().minecraft());
        if ("NEOFORGE".equals(res)) {
            String neo = currentPlan.manifest().neoforge();
            playBtn.setEnabled(false);
            sigil.spin(true);
            new SwingWorker<Void, Void>() {
                protected Void doInBackground() throws Exception {
                    installNeoForge(neo, (text, frac) -> SwingUtilities.invokeLater(() -> { status.setText(text); bar.set(frac); }));
                    return null;
                }
                protected void done() {
                    sigil.spin(false);
                    playBtn.setEnabled(true);
                    try { get(); playOfficial(); }
                    catch (Exception e) {
                        Throwable c = e.getCause() != null ? e.getCause() : e;
                        status.setText("No se pudo instalar NeoForge");
                        error(c.getMessage());
                    }
                }
            }.execute();
            return;
        }
        if (res != null) {
            JOptionPane.showMessageDialog(null, res + "\n\nPuedes jugar igualmente: crea un perfil de NeoForge en tu launcher\n"
                    + "con esta carpeta de juego:\n" + gameDir, PACK_NAME, JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        try {
            openOfficialLauncher();
            status.setText("Abriendo Minecraft… elige el perfil \"" + PACK_NAME + "\" y dale a Jugar.");
        } catch (Exception e) {
            JOptionPane.showMessageDialog(null, "Perfil \"" + PACK_NAME + "\" listo. Abre el launcher de Minecraft y elígelo.",
                    PACK_NAME, JOptionPane.INFORMATION_MESSAGE);
        }
    }

    static String mb(long b) { return String.format(Locale.ROOT, "%.1f MB", b / 1048576.0); }

    static void error(String msg) { JOptionPane.showMessageDialog(null, msg, PACK_NAME, JOptionPane.ERROR_MESSAGE); }

    static Path settingsFile() { return defaultGameDir().resolveSibling("." + PROFILE_ID + ".properties"); }

    static Properties loadSettings() {
        Properties p = new Properties();
        try (Reader r = Files.newBufferedReader(settingsFile())) { p.load(r); } catch (IOException ignored) { }
        return p;
    }

    static void saveSettings(Properties p) {
        try (Writer w = Files.newBufferedWriter(settingsFile())) { p.store(w, null); } catch (IOException ignored) { }
    }

    // ---------- JSON mínimo (sin dependencias) ----------

    static final class Json {
        private final String s;
        private int i;
        private Json(String s) { this.s = s; }

        static Object parse(String text) {
            Json j = new Json(text);
            j.ws();
            Object v = j.value();
            j.ws();
            if (j.i != j.s.length()) throw new IllegalArgumentException("JSON con basura al final");
            return v;
        }

        private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        private Object value() {
            char c = s.charAt(i);
            if (c == '{') {
                i++; Map<String, Object> m = new LinkedHashMap<>(); ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) {
                    ws(); String k = str(); ws(); expect(':'); ws();
                    m.put(k, value()); ws();
                    if (s.charAt(i) == ',') { i++; continue; }
                    expect('}'); return m;
                }
            }
            if (c == '[') {
                i++; List<Object> l = new ArrayList<>(); ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) {
                    ws(); l.add(value()); ws();
                    if (s.charAt(i) == ',') { i++; continue; }
                    expect(']'); return l;
                }
            }
            if (c == '"') return str();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            if (st == i) throw new IllegalArgumentException("JSON no válido en la posición " + i);
            return new Num(s.substring(st, i));
        }

        private void expect(char c) {
            if (s.charAt(i) != c) throw new IllegalArgumentException("Se esperaba '" + c + "' en la posición " + i);
            i++;
        }

        private String str() {
            expect('"');
            StringBuilder b = new StringBuilder();
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n' -> b.append('\n'); case 't' -> b.append('\t'); case 'r' -> b.append('\r');
                        case 'b' -> b.append('\b'); case 'f' -> b.append('\f');
                        case 'u' -> { b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
                        default -> b.append(e);
                    }
                } else b.append(c);
            }
        }

        /** Número guardado tal cual, para no alterar archivos ajenos al reescribirlos. */
        record Num(String raw) { public String toString() { return raw; } }

        static String write(Object v) { StringBuilder b = new StringBuilder(); write(v, b, 0); return b.append('\n').toString(); }

        @SuppressWarnings("unchecked")
        private static void write(Object v, StringBuilder b, int ind) {
            if (v == null) b.append("null");
            else if (v instanceof Boolean || v instanceof Num) b.append(v);
            else if (v instanceof Number) b.append(v);
            else if (v instanceof String str) quote(str, b);
            else if (v instanceof Map<?, ?> m) {
                if (m.isEmpty()) { b.append("{}"); return; }
                b.append("{\n");
                Iterator<? extends Map.Entry<?, ?>> it = m.entrySet().iterator();
                while (it.hasNext()) {
                    Map.Entry<?, ?> e = it.next();
                    b.append("  ".repeat(ind + 1)); quote(e.getKey().toString(), b); b.append(" : ");
                    write(e.getValue(), b, ind + 1);
                    if (it.hasNext()) b.append(',');
                    b.append('\n');
                }
                b.append("  ".repeat(ind)).append('}');
            } else if (v instanceof List<?> l) {
                if (l.isEmpty()) { b.append("[]"); return; }
                b.append("[\n");
                for (int k = 0; k < l.size(); k++) {
                    b.append("  ".repeat(ind + 1)); write(l.get(k), b, ind + 1);
                    if (k < l.size() - 1) b.append(',');
                    b.append('\n');
                }
                b.append("  ".repeat(ind)).append(']');
            } else quote(v.toString(), b);
        }

        private static void quote(String s, StringBuilder b) {
            b.append('"');
            for (char c : s.toCharArray()) {
                switch (c) {
                    case '"' -> b.append("\\\""); case '\\' -> b.append("\\\\");
                    case '\n' -> b.append("\\n"); case '\r' -> b.append("\\r"); case '\t' -> b.append("\\t");
                    default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
                }
            }
            b.append('"');
        }
    }
}
