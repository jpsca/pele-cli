# Pele-cli

[Pele](https://github.com/obsidianmd/pele) renders Mermaid diagrams to SVG you can freely style,
but you could only use it from a browser... until now!

This script bundles Pele with a small command line wrapper, compiles the result to
[QuickJS](https://bellard.org/quickjs/) bytecode and links it with the QuickJS engine
into one statically linked executable of about 3 MB.

It depends on no runtime and on no shared library. A render takes about 10 ms.

## Build

Needs: a Pele checkout next to this directory (or `PELE_DIR` pointing to one), Node 20+, a C
compiler, `make`, `curl` and `tar`. The first build downloads and compiles QuickJS into `build/`.

```sh
npm install
npm run build     # -> dist/pele
```

Variables: `PELE_DIR` (default `../pele`), `QJS_VERSION` (default `2025-04-26`), `QJS_DIR` (a
QuickJS tree already built), `STATIC=0` to link libc dynamically, `CC`.

## Use

```sh
pele diagram.mmd                          # SVG to stdout
pele diagram.mmd -o diagram.svg           # SVG to a file
cat diagram.mmd | pele                    # from stdin
pele -e 'flowchart LR
  A --> B'                                # from an argument
pele --json diagram.mmd                   # {type, mermaidType, width, height, links, svg}
pele --detect diagram.mmd                 # prints the diagram type
pele --var bg=#fffcf0 --var fg=#100f0f --font Inter diagram.mmd
```

`pele --help` lists every option. They map one to one onto Pele's `RenderOptions`, plus:

- `--var name=value` sets a `--pele-*` CSS variable on the root `<svg>`. The SVG uses CSS
  variables with fallbacks for its colors and fonts. In a browser the page can set them; in a
  standalone file this is the only way.
- `--font` sets the font labels are measured and drawn in; use it rather than `--var font=`
  when the font is not Arial-like, so that the layout fits the text.
- `--now` fixes the time Gantt charts treat as now, which makes output reproducible.

Exit status: 0 on success, 1 when the diagram cannot be rendered (the message goes to stderr
with line and column), 2 on a usage or file error.

## Check

`npm run check` renders every example in Pele's test corpus (`tests/corpus`) with the binary
and with Pele under Node and compares the SVGs. It needs `npm run build` done in the Pele
checkout. All 702 renderable examples are identical; the 59 that fail do so with the same
message in both.

## What differs from Pele in a browser

- QuickJS has no `URL` global, which Pele uses once, to normalize http and https link targets.
  `src/url-polyfill.js` provides the part Pele uses, following the WHATWG URL standard. Not
  covered: internationalized hostnames are lowercased but not punycoded, and IPv4 addresses
  written in hex or octal are not normalized.
- Text is measured from Pele's built-in Arial width table, as it is anywhere without a canvas.
