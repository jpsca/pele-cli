#!/usr/bin/env bash
# Builds dist/pele (dist/pele.exe for Windows): Pele bundled with a CLI, compiled to QuickJS
# bytecode and linked into one executable that depends on nothing but libc, or on nothing
# at all where a fully static link is possible.
#
#   TARGET       linux, darwin or windows                      (default: the host OS)
#                  windows cross-compiles from Linux with x86_64-w64-mingw32-gcc.
#   PELE_DIR     the Pele checkout to build from               (default: ../pele)
#   QJS_VERSION  the QuickJS release to use                    (default: 2025-04-26)
#   QJS_DIR      a QuickJS tree already built for the target, with qjsc (host-qjsc for
#                windows) and libquickjs.a
#   STATIC       1 links fully static, 0 links libc dynamically
#                  (default: 1; 0 on darwin, where Apple's linker cannot link libSystem statically)
#   CC           the C compiler                               (default: cc; x86_64-w64-mingw32-gcc for windows)
set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)" in
  Darwin) HOST=darwin ;;
  MINGW* | MSYS* | CYGWIN*) HOST=windows ;;
  *) HOST=linux ;;
esac
TARGET="${TARGET:-$HOST}"
PELE_DIR="${PELE_DIR:-../pele}"
QJS_VERSION="${QJS_VERSION:-2025-04-26}"
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

EXE=""
case "$TARGET" in
  linux)
    STATIC="${STATIC:-1}"
    CC="${CC:-cc}"
    QJS_DIR="${QJS_DIR:-build/quickjs-$QJS_VERSION}"
    ;;
  darwin)
    STATIC="${STATIC:-0}"
    CC="${CC:-cc}"
    QJS_DIR="${QJS_DIR:-build/quickjs-$QJS_VERSION}"
    ;;
  windows)
    STATIC="${STATIC:-1}"
    CC="${CC:-x86_64-w64-mingw32-gcc}"
    QJS_DIR="${QJS_DIR:-build/quickjs-$QJS_VERSION-windows}"
    EXE=.exe
    ;;
  *)
    echo "build.sh: unknown TARGET '$TARGET' (linux, darwin or windows)" >&2
    exit 2
    ;;
esac

mkdir -p build dist

# Puts the QuickJS sources in $1 unless they are already there.
fetch_quickjs() {
  [ -d "$1" ] && return
  if [ ! -f build/quickjs.tar.xz ]; then
    curl -sSL -o build/quickjs.tar.xz "https://bellard.org/quickjs/quickjs-$QJS_VERSION.tar.xz"
  fi
  rm -rf build/.quickjs-src && mkdir -p build/.quickjs-src
  tar xf build/quickjs.tar.xz -C build/.quickjs-src
  mv "build/.quickjs-src/quickjs-$QJS_VERSION" "$1"
  rmdir build/.quickjs-src
}

# 1. QuickJS: the compiler that turns JavaScript into bytecode and the library that runs it.
#    For windows the compiler runs on the host (host-qjsc), the library is for the target.
if [ "$TARGET" = windows ]; then QJSC="$QJS_DIR/host-qjsc"; else QJSC="$QJS_DIR/qjsc"; fi
if [ ! -x "$QJSC" ] || [ ! -f "$QJS_DIR/libquickjs.a" ]; then
  echo "building QuickJS $QJS_VERSION in $QJS_DIR"
  fetch_quickjs "$QJS_DIR"
  if [ "$TARGET" = windows ]; then
    make -C "$QJS_DIR" -j"$JOBS" CONFIG_WIN32=y CROSS_PREFIX="${CC%gcc}" host-qjsc libquickjs.a >/dev/null
  else
    make -C "$QJS_DIR" -j"$JOBS" qjsc libquickjs.a >/dev/null
  fi
fi

# 2. One JavaScript file: the CLI, the URL polyfill and Pele from its TypeScript sources.
VERSION="$(node -p "require('./$PELE_DIR/package.json').version")"
npx esbuild src/cli.js \
  --bundle --format=esm --target=es2022 --minify --charset=utf8 \
  --external:std --external:os \
  "--alias:pele=./$PELE_DIR/src/index.ts" \
  "--define:PELE_VERSION=\"$VERSION\"" \
  --outfile=build/pele.js --log-level=warning

# 3. Bytecode wrapped in a C main(), then the executable.
"$QJSC" -e -m -s -o build/pele.c build/pele.js

# Links build/pele.c against the libquickjs.a in $2 into $1; further arguments go to the compiler.
link() {
  local out="$1" libdir="$2"
  shift 2
  local libs="-lm"
  [ "$TARGET" = windows ] || libs="$libs -ldl -lpthread"
  [ "$STATIC" = 1 ] && libs="-static $libs"
  # shellcheck disable=SC2086
  "$CC" -O2 "$@" -o "$out" build/pele.c -I"$QJS_DIR" -L"$libdir" -lquickjs $libs
}

case "$TARGET" in
  darwin)
    link dist/pele "$QJS_DIR"
    strip dist/pele
    ;;
  *)
    link "dist/pele$EXE" "$QJS_DIR" -s
    ;;
esac

ls -la "dist/pele$EXE"
