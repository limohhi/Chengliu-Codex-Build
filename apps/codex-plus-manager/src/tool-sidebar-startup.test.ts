import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

it("sidebar tools load during startup without waiting for external ads", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("    void refreshTools(true);"));
  const startup = effect.slice(0, effect.indexOf("  }, []);"));
  assert.ok(startup.includes("void refreshTools(true);"));
  assert.doesNotMatch(startup, /refreshAds|\/ads|top_ad|topAds/);
  assert.ok(startup.includes("await refreshOverview(true);"));
});
