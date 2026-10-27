// pele: renders a Mermaid diagram to SVG. Runs on QuickJS and is compiled to one binary.
import * as std from 'std';
import './url-polyfill.js';
import { PeleError, detectType, render } from 'pele';

// Replaced by the build with the version of the Pele sources the binary was made from.
const VERSION = typeof PELE_VERSION === 'string' ? PELE_VERSION : 'dev';

const HELP = `pele ${VERSION} - renders Mermaid diagrams to SVG

Usage:
  pele [options] [file]        read the diagram from a file, or stdin when no file or "-"
  pele [options] -e <text>     take the diagram text from the argument

Output:
  -o, --output <file>          write the SVG to a file instead of stdout
      --json                   print a JSON object: type, mermaidType, width, height, links, svg
      --detect                 print the diagram type and exit

Text:
      --font <family>          font the labels are measured and drawn in (default: sans-serif)
      --font-mono <family>     monospace font (default: monospace)
      --font-size <px>         base font size (default: 16)
      --monospace <parts>      draw these parts in monospace: members,attributes,files,messages

Layout:
      --max-width <px>         width available to the diagram
      --padding <px>           space around the diagram
      --responsive             size the SVG to its container instead of its own pixels
      --no-auto-direction      never redraw a wide diagram running down to fit max-width
      --direction-breakpoint <px>  width under which that happens (default: 640)
      --id-prefix <text>       prefix for the ids inside the SVG

Theme:
      --var <name>=<value>     set a --pele-* CSS variable on the SVG, e.g. --var bg=#fffcf0
                               (repeatable; names: bg fg muted line surface surface-alt border
                               accent critical font font-mono radius series-1..series-8)

Links:
      --no-links               leave out links
      --no-images              leave out images
      --link-rel <value>       rel attribute of links (default: noopener; "" omits it)
      --link-schemes <list>    allowed link schemes (default: http,https,mailto,tel)
      --image-schemes <list>   allowed image schemes (default: http,https)

Limits:
      --limit <n>              most characters of diagram text accepted
      --output-limit <n>       most characters of SVG produced
      --max-edges <n>          most edges a flowchart may have

Other:
      --now <date>             the time gantt charts treat as now (ISO 8601)
  -h, --help                   show this help
  -v, --version                show the version

Exit status: 0 on success, 1 when the diagram cannot be rendered, 2 on a usage or file error.
`;

function fail(message, status = 2) {
  std.err.puts(`pele: ${message}\n`);
  std.exit(status);
}

function readInput(path) {
  if (path === undefined || path === '-') return std.in.readAsString();
  const text = std.loadFile(path);
  if (text === null) fail(`cannot read ${path}`);
  return text;
}

function writeOutput(path, text) {
  if (path === undefined) {
    std.out.puts(text);
    return;
  }
  const error = {};
  const file = std.open(path, 'w', error);
  if (!file) fail(`cannot write ${path}: ${std.strerror(error.errno)}`);
  file.puts(text);
  file.close();
}

// Inserts the chosen --pele-* variables into the root element's style, before the
// `var(--pele-*, fallback)` references that read them.
function withVars(svg, decls) {
  if (!decls) return svg;
  const m = /^<svg\b[^>]*?\sstyle="/.exec(svg);
  if (m) return svg.slice(0, m[0].length) + decls + svg.slice(m[0].length);
  return svg.replace(/^<svg\b/, `<svg style="${decls}"`);
}

const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function parseArgs(argv) {
  const opts = {};
  let file;
  let code;
  let output;
  let json = false;
  let detect = false;
  let vars = '';

  const takesValue = new Set([
    'e', 'code', 'o', 'output', 'font', 'font-mono', 'font-size', 'monospace', 'max-width', 'padding',
    'direction-breakpoint', 'id-prefix', 'var', 'link-rel', 'link-schemes', 'image-schemes',
    'limit', 'output-limit', 'max-edges', 'now',
  ]);

  const number = (name, value) => {
    const n = Number(value);
    if (value === '' || !Number.isFinite(n) || n < 0) fail(`--${name} needs a non-negative number, got "${value}"`);
    return n;
  };
  const list = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--') {
      if (file !== undefined) fail('only one file can be given');
      file = argv[i + 1];
      break;
    }
    if (arg[0] !== '-' || arg === '-') {
      if (file !== undefined) fail('only one file can be given');
      file = arg;
      continue;
    }
    let name;
    let value;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (eq >= 0) value = arg.slice(eq + 1);
    } else {
      name = arg.slice(1);
      if (name.length > 1) fail(`unknown option ${arg}`);
    }
    if (takesValue.has(name) && value === undefined) {
      if (i + 1 >= argv.length) fail(`--${name} needs a value`);
      value = argv[++i];
    }

    switch (name) {
      case 'h':
      case 'help':
        std.out.puts(HELP);
        std.exit(0);
      case 'v':
      case 'version':
        std.out.puts(VERSION + '\n');
        std.exit(0);
      case 'e':
      case 'code':
        code = value;
        break;
      case 'o':
      case 'output':
        output = value;
        break;
      case 'json':
        json = true;
        break;
      case 'detect':
        detect = true;
        break;
      case 'font':
        opts.fontFamily = value;
        break;
      case 'font-mono':
        opts.fontFamilyMono = value;
        break;
      case 'font-size':
        opts.fontSize = number(name, value);
        break;
      case 'monospace':
        opts.monospace = list(value);
        break;
      case 'max-width':
        opts.maxWidth = number(name, value);
        break;
      case 'padding':
        opts.padding = number(name, value);
        break;
      case 'responsive':
        opts.responsive = true;
        break;
      case 'no-auto-direction':
        opts.autoDirection = false;
        break;
      case 'direction-breakpoint':
        opts.directionBreakpoint = number(name, value);
        break;
      case 'id-prefix':
        opts.idPrefix = value;
        break;
      case 'var': {
        const eq = value.indexOf('=');
        if (eq <= 0) fail(`--var needs name=value, got "${value}"`);
        let varName = value.slice(0, eq).trim();
        const varValue = value.slice(eq + 1).trim();
        if (!varName.startsWith('--')) varName = '--pele-' + varName;
        if (!/^--[a-zA-Z0-9_-]+$/.test(varName)) fail(`--var: "${varName}" is not a valid variable name`);
        if (/[;{}]/.test(varValue)) fail(`--var: the value of ${varName} cannot contain ; { or }`);
        vars += `${varName}:${escAttr(varValue)};`;
        break;
      }
      case 'no-links':
        opts.links = false;
        break;
      case 'no-images':
        opts.images = false;
        break;
      case 'link-rel':
        opts.linkRel = value;
        break;
      case 'link-schemes':
        opts.linkSchemes = list(value);
        break;
      case 'image-schemes':
        opts.imageSchemes = list(value);
        break;
      case 'limit':
        opts.limit = number(name, value);
        break;
      case 'output-limit':
        opts.outputLimit = number(name, value);
        break;
      case 'max-edges':
        opts.maxEdges = number(name, value);
        break;
      case 'now': {
        const t = Date.parse(value);
        if (Number.isNaN(t)) fail(`--now needs an ISO 8601 date, got "${value}"`);
        opts.now = t;
        break;
      }
      default:
        fail(`unknown option ${arg}`);
    }
  }
  if (code !== undefined && file !== undefined) fail('give either a file or -e, not both');
  return { opts, file, code, output, json, detect, vars };
}

function main() {
  const { opts, file, code, output, json, detect, vars } = parseArgs(scriptArgs.slice(1));
  const text = code !== undefined ? code : readInput(file);

  if (detect) {
    const type = detectType(text);
    if (type === null) fail('unsupported or unrecognized diagram', 1);
    writeOutput(output, type + '\n');
    return;
  }

  let result;
  try {
    result = render(text, opts);
  } catch (e) {
    if (e instanceof PeleError) {
      const where = e.line ? ` at line ${e.line}, column ${e.column}` : '';
      let message = `${e.code} error${where}: ${e.message}`;
      if (e.snippet && !e.message.includes(e.snippet)) message += `\n${e.snippet}`;
      fail(message, 1);
    }
    fail(`internal error: ${e && e.stack ? e.stack : e}`, 1);
  }

  const svg = withVars(result.svg, vars);
  if (json) {
    const { type, mermaidType, width, height, links } = result;
    writeOutput(output, JSON.stringify({ type, mermaidType, width, height, links, svg }) + '\n');
  } else {
    writeOutput(output, svg.endsWith('\n') ? svg : svg + '\n');
  }
}

main();
