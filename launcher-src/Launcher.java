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
    static final String LAUNCHER_VERSION = "1.0.0";     // súbelo al publicar un launcher nuevo
    static final String RAM = "-Xmx4G";                  // memoria para el perfil de Minecraft
    // ===========================

    /** Solo para pruebas: -Dlauncher.raw=http://localhost:8000 */
    static final String RAW_BASE = System.getProperty("launcher.raw", "https://raw.githubusercontent.com/" + REPO);
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
    record Manifest(String version, String minecraft, String commit, List<PackFile> files, List<String> mirrorDirs) {}
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

    /** Commit más reciente de la rama: así los archivos nunca llegan desde una caché vieja. */
    static String latestCommit() {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.github.com/repos/" + REPO + "/commits/" + BRANCH))
                    .timeout(Duration.ofSeconds(15))
                    .header("Accept", "application/vnd.github.sha")
                    .header("User-Agent", PACK_NAME + "-Launcher").build();
            HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            String sha = r.body().trim();
            if (r.statusCode() == 200 && sha.matches("[0-9a-f]{40}")) return sha;
        } catch (Exception ignored) { }
        return BRANCH; // si la API falla (límite de peticiones), usamos la rama
    }

    static String rawUrl(String commit, String path) {
        StringBuilder sb = new StringBuilder(RAW_BASE).append('/').append(commit);
        for (String seg : ("modpack/" + path).split("/"))
            sb.append('/').append(URLEncoder.encode(seg, StandardCharsets.UTF_8).replace("+", "%20"));
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    static Manifest fetchManifest() throws Exception {
        String commit = latestCommit();
        String url = RAW_BASE + "/" + commit + "/manifest.json";
        Map<String, Object> m = (Map<String, Object>) Json.parse(getText(url));
        List<PackFile> files = new ArrayList<>();
        for (Object o : (List<Object>) m.get("files")) {
            Map<String, Object> f = (Map<String, Object>) o;
            files.add(new PackFile((String) f.get("path"), (String) f.get("sha1"), Long.parseLong(f.get("size").toString())));
        }
        List<String> mirror = new ArrayList<>();
        Object md = m.get("mirrorDirs");
        if (md instanceof List<?> l) for (Object o : l) mirror.add(o.toString());
        else mirror.add("mods");
        return new Manifest(String.valueOf(m.get("version")), String.valueOf(m.getOrDefault("minecraft", "1.21.1")), commit, files, mirror);
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
            HttpRequest req = HttpRequest.newBuilder(URI.create(rawUrl(plan.manifest().commit(), f.path())))
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

    static void openOfficialLauncher() throws IOException {
        if (isWindows()) {
            // Launcher de la Microsoft Store / Xbox app
            new ProcessBuilder("explorer.exe", "shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft").start();
        } else if (isMac()) {
            new ProcessBuilder("open", "-a", "Minecraft").start();
        } else {
            new ProcessBuilder("minecraft-launcher").start();
        }
    }

    // ---------- Noticias y versión del launcher ----------

    @SuppressWarnings("unchecked")
    static String newsHtml(String commit) {
        try {
            Object parsed = Json.parse(getText(RAW_BASE + "/" + commit + "/news.json"));
            StringBuilder sb = new StringBuilder("<html><body style='font-family:sans-serif;font-size:11px;'>");
            for (Object o : (List<Object>) parsed) {
                Map<String, Object> n = (Map<String, Object>) o;
                sb.append("<p><b>").append(esc(String.valueOf(n.getOrDefault("titulo", "")))).append("</b>")
                  .append(" <span style='color:gray'>").append(esc(String.valueOf(n.getOrDefault("fecha", "")))).append("</span><br>")
                  .append(esc(String.valueOf(n.getOrDefault("texto", ""))).replace("\n", "<br>")).append("</p>");
            }
            return sb.append("</body></html>").toString();
        } catch (Exception e) {
            return "<html><body style='font-family:sans-serif;color:gray'>No se pudieron cargar las noticias.</body></html>";
        }
    }

    static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }

    @SuppressWarnings("unchecked")
    static String newerLauncherUrl() {
        try {
            Map<String, Object> r = (Map<String, Object>) Json.parse(getText("https://api.github.com/repos/" + REPO + "/releases/latest"));
            String tag = String.valueOf(r.get("tag_name")).replaceFirst("^[vV]", "");
            if (compareVersions(tag, LAUNCHER_VERSION) > 0) return String.valueOf(r.get("html_url"));
        } catch (Exception ignored) { }
        return null;
    }

    // ---------- Interfaz ----------

    static Path gameDir;
    static JLabel status;
    static JProgressBar bar;
    static JButton updateBtn, playBtn;
    static Plan currentPlan;

    public static void main(String[] args) throws Exception {
        if (args.length >= 2 && args[0].equals("--sync")) { headless(Paths.get(args[1])); return; }
        try { UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()); } catch (Exception ignored) { }
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
        Properties settings = loadSettings();
        gameDir = Paths.get(settings.getProperty("gameDir", defaultGameDir().toString()));

        JFrame f = new JFrame(PACK_NAME + " Launcher");
        f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        JPanel root = new JPanel(new BorderLayout(10, 10));
        root.setBorder(new EmptyBorder(16, 16, 16, 16));

        JLabel title = new JLabel(PACK_NAME);
        title.setFont(title.getFont().deriveFont(Font.BOLD, 26f));
        JLabel sub = new JLabel("Launcher " + LAUNCHER_VERSION);
        sub.setForeground(Color.GRAY);
        JPanel header = new JPanel(new BorderLayout());
        header.add(title, BorderLayout.WEST);
        header.add(sub, BorderLayout.EAST);
        root.add(header, BorderLayout.NORTH);

        JEditorPane news = new JEditorPane("text/html", "<html><body style='font-family:sans-serif;color:gray'>Cargando noticias…</body></html>");
        news.setEditable(false);
        JScrollPane sp = new JScrollPane(news);
        sp.setBorder(BorderFactory.createTitledBorder("Novedades"));
        root.add(sp, BorderLayout.CENTER);

        status = new JLabel("Comprobando actualizaciones…");
        bar = new JProgressBar(0, 1000);
        bar.setStringPainted(false);
        updateBtn = new JButton("Actualizar");
        updateBtn.setEnabled(false);
        playBtn = new JButton("Jugar");
        playBtn.setEnabled(false);
        JButton folderBtn = new JButton("Abrir carpeta");
        JButton changeBtn = new JButton("Cambiar carpeta…");

        updateBtn.addActionListener(e -> doUpdate());
        playBtn.addActionListener(e -> doPlay());
        folderBtn.addActionListener(e -> {
            try { Files.createDirectories(gameDir); Desktop.getDesktop().open(gameDir.toFile()); }
            catch (Exception ex) { error(ex.getMessage()); }
        });
        changeBtn.addActionListener(e -> {
            JFileChooser ch = new JFileChooser(gameDir.toFile());
            ch.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
            if (ch.showOpenDialog(f) == JFileChooser.APPROVE_OPTION) {
                gameDir = ch.getSelectedFile().toPath();
                settings.setProperty("gameDir", gameDir.toString());
                saveSettings(settings);
                check(news);
            }
        });

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
        buttons.add(changeBtn);
        buttons.add(folderBtn);
        buttons.add(updateBtn);
        buttons.add(playBtn);
        JPanel bottom = new JPanel(new BorderLayout(6, 6));
        bottom.add(status, BorderLayout.NORTH);
        bottom.add(bar, BorderLayout.CENTER);
        bottom.add(buttons, BorderLayout.SOUTH);
        root.add(bottom, BorderLayout.SOUTH);

        f.setContentPane(root);
        f.setSize(640, 440);
        f.setLocationRelativeTo(null);
        f.setVisible(true);
        check(news);
    }

    static void check(JEditorPane news) {
        updateBtn.setEnabled(false);
        playBtn.setEnabled(false);
        status.setText("Comprobando actualizaciones…");
        new SwingWorker<Plan, Void>() {
            String html, launcherUrl;
            protected Plan doInBackground() throws Exception {
                Manifest m = fetchManifest();
                html = newsHtml(m.commit());
                launcherUrl = newerLauncherUrl();
                return plan(gameDir, m);
            }
            protected void done() {
                try {
                    currentPlan = get();
                    news.setText(html);
                    news.setCaretPosition(0);
                    if (currentPlan.upToDate()) {
                        status.setText("Todo al día · versión " + currentPlan.manifest().version());
                        bar.setValue(1000);
                        playBtn.setEnabled(true);
                    } else {
                        status.setText("Hay una actualización: " + currentPlan.downloads().size() + " archivo(s), "
                                + mb(currentPlan.bytes()) + (currentPlan.deletions().isEmpty() ? "" : ", " + currentPlan.deletions().size() + " a quitar"));
                        bar.setValue(0);
                        updateBtn.setEnabled(true);
                    }
                    if (launcherUrl != null) {
                        int r = JOptionPane.showConfirmDialog(null, "Hay una versión nueva del launcher. ¿Abrir la página de descarga?",
                                PACK_NAME, JOptionPane.YES_NO_OPTION);
                        if (r == JOptionPane.YES_OPTION) Desktop.getDesktop().browse(URI.create(launcherUrl));
                    }
                } catch (Exception e) {
                    status.setText("No se pudo comprobar. ¿Tienes internet?");
                    updateBtn.setText("Reintentar");
                    updateBtn.setEnabled(true);
                    for (var l : updateBtn.getActionListeners()) updateBtn.removeActionListener(l);
                    updateBtn.addActionListener(ev -> {
                        for (var l : updateBtn.getActionListeners()) updateBtn.removeActionListener(l);
                        updateBtn.setText("Actualizar");
                        updateBtn.addActionListener(x -> doUpdate());
                        check(news);
                    });
                }
            }
        }.execute();
    }

    static void doUpdate() {
        updateBtn.setEnabled(false);
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception {
                apply(gameDir, currentPlan, (text, frac) -> SwingUtilities.invokeLater(() -> {
                    status.setText(text);
                    bar.setValue((int) (frac * 1000));
                }));
                return null;
            }
            protected void done() {
                try {
                    get();
                    status.setText("Todo al día · versión " + currentPlan.manifest().version());
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
        String res = ensureProfile(gameDir, currentPlan.manifest().minecraft());
        if ("NEOFORGE".equals(res)) {
            int r = JOptionPane.showConfirmDialog(null,
                    "Necesitas instalar NeoForge para Minecraft " + currentPlan.manifest().minecraft() + " (solo una vez).\n"
                            + "Descarga el instalador, elige \"Install client\" y vuelve a darle a Jugar.\n\n¿Abrir la página de NeoForge?",
                    PACK_NAME, JOptionPane.YES_NO_OPTION);
            if (r == JOptionPane.YES_OPTION) {
                try { Desktop.getDesktop().browse(URI.create("https://neoforged.net/")); } catch (Exception ignored) { }
            }
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
