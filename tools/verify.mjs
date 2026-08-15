#!/usr/bin/env node
/* verify — run the runtime validators over the generated data files.
 *
 * `pool-to-tables` checks the POOL as it folds it in; this checks the OUTPUT with the same
 * functions the module uses at load, so a mistake in the generator itself has somewhere to show up.
 *
 *   node tools/verify.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEffects, validateFumbles, validateLethal } from "../src/catalog/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));

let failed = false;
for (const [name, validate] of [["effects.json", validateEffects], ["fumbles.json", validateFumbles], ["lethal.json", validateLethal]]) {
  const data = read(name);
  const result = validate(data);
  // `validateLethal` reports a flat `problems` list; the other two split errors from warnings.
  const errors = result.errors ?? result.problems ?? [];
  const warnings = result.warnings ?? [];
  const kept = result.entries?.length ?? "?";
  console.error(`${name.padEnd(14)} ${errors.length} error(s), ${warnings.length} warning(s), ${kept} entries kept of ${data.entries?.length ?? "?"}`);
  for (const e of errors.slice(0, 12)) console.error(`  ! ${e}`);
  for (const w of warnings.slice(0, 12)) console.error(`  - ${w}`);
  if (errors.length > 12) console.error(`  … ${errors.length - 12} more errors`);
  if (warnings.length > 12) console.error(`  … ${warnings.length - 12} more warnings`);
  if (errors.length) failed = true;
}
process.exit(failed ? 1 : 0);
