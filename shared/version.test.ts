import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PLUGIN_VERSION } from "./version.ts";

// npm test runs from the package root.
test("the version reported to clients matches package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(PLUGIN_VERSION, pkg.version);
});
