import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.*;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Puente del launcher Java (1.4) al launcher nuevo (2.x, animado).
 * Los launchers 1.4 se actualizan solos descargando "Derisomod-Launcher.jar" de la última release:
 * en la 2.x ese jar es este puente, que descarga el instalador nuevo, lo ejecuta y se cierra.
 * El launcher nuevo usa los mismos ajustes y carpetas, así que no hay que volver a bajar el modpack.
 */
public class Launcher {
    static final String LAUNCHER_VERSION = "2.0.0";
    static final String REPO = "Rikux456/Launcher";
    static final String PAGE = "https://github.com/" + REPO + "/releases/latest";

    public static void main(String[] args) {
        if (args.length > 0 && args[0].equals("--version")) { System.out.println(LAUNCHER_VERSION + " (puente)"); return; }
        try { UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()); } catch (Exception ignored) { }
        JFrame f = new JFrame("Derisomod Launcher");
        f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        JPanel p = new JPanel(new BorderLayout(0, 14));
        p.setBackground(new Color(0x0D0D1F));
        p.setBorder(new EmptyBorder(28, 32, 28, 32));
        JLabel title = new JLabel("Llega el launcher nuevo");
        title.setForeground(Color.WHITE);
        title.setFont(title.getFont().deriveFont(Font.BOLD, 22f));
        JLabel status = new JLabel("Descargando el instalador…");
        status.setForeground(new Color(0xC6CFF5));
        JProgressBar bar = new JProgressBar(0, 1000);
        p.add(title, BorderLayout.NORTH); p.add(status, BorderLayout.CENTER); p.add(bar, BorderLayout.SOUTH);
        f.setContentPane(p); f.setSize(520, 180); f.setLocationRelativeTo(null); f.setVisible(true);

        new Thread(() -> {
            try {
                HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(20)).build();
                String json = http.send(HttpRequest.newBuilder(URI.create("https://api.github.com/repos/" + REPO + "/releases/latest"))
                        .header("User-Agent", "Derisomod-Launcher").build(), HttpResponse.BodyHandlers.ofString()).body();
                Matcher m = Pattern.compile("\"browser_download_url\"\\s*:\\s*\"([^\"]*Derisomod-Launcher-Setup-[^\"]*\\.exe)\"").matcher(json);
                if (!m.find()) throw new IOException("No se encontró el instalador en la última versión.");
                Path exe = Files.createTempDirectory("derisomod").resolve("Derisomod-Launcher-Setup.exe");
                HttpResponse<java.io.InputStream> r = http.send(HttpRequest.newBuilder(URI.create(m.group(1))).header("User-Agent", "Derisomod-Launcher").build(),
                        HttpResponse.BodyHandlers.ofInputStream());
                if (r.statusCode() != 200) throw new IOException("HTTP " + r.statusCode());
                long total = r.headers().firstValueAsLong("Content-Length").orElse(-1);
                try (var in = r.body(); var out = Files.newOutputStream(exe)) {
                    byte[] buf = new byte[1 << 16]; long done = 0; int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n); done += n;
                        if (total > 0) { int v = (int) (done * 1000 / total); SwingUtilities.invokeLater(() -> bar.setValue(v)); }
                    }
                }
                SwingUtilities.invokeLater(() -> status.setText("Instalando… (se abrirá solo)"));
                new ProcessBuilder(exe.toString()).start();
                Thread.sleep(1500);
                System.exit(0);
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> {
                    int r = JOptionPane.showConfirmDialog(f, "No se pudo instalar el launcher nuevo (" + e.getMessage() + ").\n¿Abrir la página de descarga?",
                            "Derisomod Launcher", JOptionPane.YES_NO_OPTION);
                    if (r == JOptionPane.YES_OPTION) try { Desktop.getDesktop().browse(URI.create(PAGE)); } catch (Exception ignored) { }
                    System.exit(0);
                });
            }
        }).start();
    }
}
