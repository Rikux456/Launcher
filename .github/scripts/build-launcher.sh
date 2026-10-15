#!/usr/bin/env bash
# Compila el launcher en un único .jar (con sqlite-jdbc dentro) y, en Windows, el .exe con Java incluido.
# Uso: build-launcher.sh <versión> [archivos .java extra para pruebas]
set -euo pipefail
VERSION="$1"; shift || true
SQLITE=3.46.1.0
SLF4J=2.0.16
rm -rf build dist && mkdir -p build/classes build/lib dist
M=https://repo1.maven.org/maven2
curl -fsSL -o build/lib/sqlite-jdbc.jar "$M/org/xerial/sqlite-jdbc/$SQLITE/sqlite-jdbc-$SQLITE.jar"
curl -fsSL -o build/lib/slf4j-api.jar   "$M/org/slf4j/slf4j-api/$SLF4J/slf4j-api-$SLF4J.jar"
curl -fsSL -o build/lib/slf4j-nop.jar   "$M/org/slf4j/slf4j-nop/$SLF4J/slf4j-nop-$SLF4J.jar"

SEP=":"; [[ "${OS:-}" == "Windows_NT" ]] && SEP=";"
javac -encoding UTF-8 -cp "build/lib/sqlite-jdbc.jar${SEP}build/lib/slf4j-api.jar" -d build/classes launcher-src/Launcher.java "$@"

# Meter las librerías dentro del .jar
( cd build/classes && for j in ../lib/*.jar; do jar xf "$j"; done && rm -rf META-INF/MANIFEST.MF META-INF/*.SF META-INF/*.RSA META-INF/versions module-info.class )
printf "Main-Class: Launcher\n" > build/manifest.txt
jar cfm dist/Derisomod-Launcher.jar build/manifest.txt -C build/classes . -C launcher-src/resources .

if [[ "${OS:-}" == "Windows_NT" ]]; then
  jpackage --type app-image --name "Derisomod Launcher" --app-version "$VERSION" \
    --input dist --main-jar Derisomod-Launcher.jar --main-class Launcher --icon launcher-src/icon.ico \
    --add-modules java.se,jdk.crypto.ec,jdk.zipfs,jdk.unsupported,jdk.charsets,jdk.localedata \
    --jlink-options "--strip-debug --no-man-pages --no-header-files" --dest build/app
fi
