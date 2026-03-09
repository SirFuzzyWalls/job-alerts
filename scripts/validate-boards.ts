import { loadRegistry } from "../src/registry.js";
import { probeBoard } from "./prober.js";

const CONCURRENCY = 5;

async function main() {
  const registry = loadRegistry();
  console.log(`Validating ${registry.length} boards...`);

  const results: Array<{ name: string; ok: boolean; detail: string }> = new Array(registry.length);
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= registry.length) break;
      const entry = registry[i];
      const result = await probeBoard(entry);
      results[i] = {
        name: entry.name,
        ok: result.ok,
        detail: result.ok ? `${result.count} jobs` : result.error ?? "unknown error",
      };
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  let failures = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  [PASS] ${r.name} (${r.detail})`);
    } else {
      console.log(`  [FAIL] ${r.name}: ${r.detail}`);
      failures++;
    }
  }

  const passed = registry.length - failures;
  console.log(`\nSummary: ${passed}/${registry.length} boards healthy`);

  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
