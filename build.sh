#!/usr/bin/env bash
# Builds dist/pele: Pele bundled with a CLI, compiled to QuickJS bytecode and linked into
# one executable that depends on nothing but libc (or on nothing at all with STATIC=1).
#
#   PELE_DIR     the Pele checkout to build from          (default: ../pele)
#   QJS_VERSION  the QuickJS release to use               (default: 2025-04-26)
#   QJS_DIR      a QuickJS tree already built, with qjsc and libquickjs.a
#   STATIC       1 links fully static, 0 links libc dynamically (default: 1)
#   CC           the C compiler                           (default: cc)
set -euo pipefail
cd "$(dirname "$0")"

PELE_DIR="${PELE_DIR:-../pele}"
QJS_VERSION="${QJS_VERSION:-2025-04-26}"
QJS_DIR="${QJS_DIR:-build/quickjs-$QJS_VERSION}"
STATIC="${STATIC:-1}"
CC="${CC:-cc}"

mkdir -p build dist

# 1. QuickJS: the compiler that turns JavaScript into bytecode and the library that runs it.
if [ ! -x "$QJS_DIR/qjsc" ] || [ ! -f "$QJS_DIR/libquickjs.a" ]; then
  echo "building QuickJS $QJS_VERSION in $QJS_DIR"
  if [ ! -d "$QJS_DIR" ]; then
    curl -sSL -o build/quickjs.tar.xz "https://bellard.org/quickjs/quickjs-$QJS_VERSION.tar.xz"
    tar xf build/quickjs.tar.xz -C build
  fi
  make -C "$QJS_DIR" -j"$(nproc)" qjsc libquickjs.a >/dev/null
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
"$QJS_DIR/qjsc" -e -m -s -o build/pele.c build/pele.js
LIBS="-lm -ldl -lpthread"
if [ "$STATIC" = 1 ]; then LIBS="-static $LIBS"; fi
# shellcheck disable=SC2086
"$CC" -O2 -s -o dist/pele build/pele.c -I"$QJS_DIR" -L"$QJS_DIR" -lquickjs $LIBS

ls -la dist/pele
