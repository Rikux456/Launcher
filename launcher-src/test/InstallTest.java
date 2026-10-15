/** Prueba usada por la Action "Probar instalación": instala NeoForge en una .minecraft vacía. */
public class InstallTest {
    public static void main(String[] a) throws Exception {
        java.nio.file.Path mc = Launcher.minecraftDir();
        java.nio.file.Files.createDirectories(mc);
        // Sin launcher_profiles.json: simula un launcher oficial instalado pero nunca abierto
        System.out.println("java.home = " + System.getProperty("java.home"));
        System.out.println("mrpack = " + Launcher.buildMrpack(new Launcher.Manifest("t", "1.21.1", a[0], "main", java.util.List.of(), java.util.List.of("mods"))));
        Launcher.installNeoForge(a[0], (t, f) -> { });
        System.out.println("Versión detectada: " + Launcher.findNeoForge("1.21.1"));
        System.out.println("Perfil: " + (Launcher.ensureProfile(java.nio.file.Paths.get("C:/test-pack"), "1.21.1") == null ? "OK" : "FALLO"));
    }
}
