// Renders every example in Pele's test corpus with the binary and with Pele in Node, and
// compares the SVGs. Run `npm run build` in the Pele checkout first, so dist/pele.js exists.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const peleDir = resolve(process.env.PELE_DIR ?? '../pele');
const binary = resolve(process.env.PELE_BIN ?? 'dist/pele');
const { render } = await import(resolve(peleDir, 'dist/pele.js'));
const NOW = '2023-11-14T22:13:20Z';
const now = Date.parse(NOW);

const corpus = resolve(peleDir, 'tests/corpus');
let same = 0;
let different = 0;
let errors = 0;
let errorsDiffer = 0;
for (const file of readdirSync(corpus).filter((f) => f.endsWith('.json')).sort()) {
  // Most files hold diagram texts; agentflow-reference.json holds {src, model} pairs.
  const items = JSON.parse(readFileSync(resolve(corpus, file), 'utf8')).map((item) => (typeof item === 'string' ? item : item.src));
  items.forEach((text, i) => {
    let expected;
    let expectedError;
    try {
      expected = render(text, { now }).svg;
    } catch (e) {
      expectedError = e.message;
    }
    const run = spawnSync(binary, ['--now', NOW], { input: text, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (expectedError !== undefined) {
      errors++;
      if (run.status !== 1 || !run.stderr.includes(expectedError)) {
        errorsDiffer++;
        console.log(`${file}#${i}: node failed with "${expectedError}", binary exited ${run.status}: ${run.stderr.trim()}`);
      }
      return;
    }
    if (run.status === 0 && run.stdout === expected + '\n') same++;
    else {
      different++;
      console.log(`${file}#${i}: output differs (exit ${run.status}) ${run.stderr.trim()}`);
    }
  });
}
console.log(`${same} identical, ${different} different, ${errors} errors in both (${errorsDiffer} with different messages)`);
process.exit(different || errorsDiffer ? 1 : 0);
