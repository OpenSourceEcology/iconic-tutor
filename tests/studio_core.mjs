import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clone,
  validateAsset,
  validateProject,
  seedProject,
  addInstance,
  replaceInstance,
  compositionSvg,
  footprint,
  stackAbove,
  worldCorners,
  contributionFiles,
} from "../web/js/studio-core.js";

const catalog = JSON.parse(
  readFileSync(new URL("../web/data/studio/catalog.json", import.meta.url)),
).assets;
catalog.forEach(validateAsset);
assert.equal(catalog.length, 9);
const house = seedProject("house", catalog),
  machines = seedProject(
    "machines",
    catalog.filter((a) => a.source_id.startsWith("axis_")),
  );
assert.equal(house.instances.length, 12);
assert.equal(machines.instances.length, 3);
const saved = JSON.stringify(machines),
  variant = {
    ...clone(machines.assets.find((a) => a.source_id === "axis_idler_spacer")),
    id: "my_spacer",
    title: "My spacer",
    draft: true,
  };
const added = addInstance(machines, variant, [0, 20, 5]);
assert.equal(
  JSON.stringify(machines),
  saved,
  "adding a variant leaves the original document intact",
);
assert.equal(added.instances.length, 4);
assert.equal(added.assets.length, 4);
assert.deepEqual(
  validateProject(JSON.parse(JSON.stringify(added))),
  added,
  "a portable project carries complete geometry",
);
assert.throws(() => addInstance(house, variant, [0, 0, 0]), /Switch lessons/);
const original = house.instances[0];
const replacement = {
  ...clone(house.assets[0]),
  id: "new_wall",
  title: "New wall",
};
const changed = replaceInstance(house, original.id, replacement);
assert.deepEqual(changed.instances[0].position, original.position);
assert.deepEqual(changed.instances[0].rotation, original.rotation);
assert.equal(changed.instances[0].asset_id, "new_wall");
for (const corrupt of [
  (p) => (p.instances[0].position[0] = null),
  (p) => (p.instances[0].asset_id = "missing"),
  (p) => (p.assets[0].source_url = "javascript:alert(1)"),
  (p) => (p.assets[0].parts[0].mesh.indices[0] = -1),
  (p) => (p.assets[0].validation.engineering = "approved"),
  (p) => p.assets.push(p.assets[0]),
]) {
  const invalid = clone(machines);
  corrupt(invalid);
  assert.throws(() => validateProject(invalid));
  assert.equal(JSON.stringify(machines), saved);
}
const malicious = clone(variant);
malicious.title = '<script>alert("hello")</script>';
const svg = compositionSvg(addInstance(machines, malicious, [10, 20, 0]));
assert(!svg.includes("<script>"));
assert(svg.includes("&lt;script&gt;"));
const files = contributionFiles(variant);
for (const name of [
  "schema.py",
  "schema.json",
  "compiler.py",
  "meta.json",
  "validation.json",
  "wiki-draft.txt",
])
  assert(name in files);
assert.equal(JSON.parse(files["meta.json"]).engineering_status, "unreviewed");
assert.equal(
  Object.keys(files).filter((n) => n.endsWith(".brp")).length,
  variant.parts.length,
);
console.log(
  "PASS studio core: portable geometry, immutable edits, replacement placement, validation, SVG escaping, contribution package",
);

// A box turned about X must project its height, not its original depth.
const tilted = footprint(
  { position: [10, 20, 30], rotation: [90, 0, 0] },
  { bounds: [0, 0, 0, 2, 3, 4] },
);
assert(Math.abs(Math.min(...tilted.map((p) => p[1])) - 16) < 1e-9);
assert(Math.abs(Math.max(...tilted.map((p) => p[1])) - 20) < 1e-9);
const tiltedProject = clone(machines);
tiltedProject.instances[0].rotation = [20, 35, 10];
tiltedProject.instances[2].rotation = [35, 20, 0];
const stacked = stackAbove(tiltedProject, "instance_3", "instance_1", 3);
const cornersFor = (id) => {
  const i = stacked.instances.find((i) => i.id === id);
  return worldCorners(
    i,
    stacked.assets.find((a) => a.id === i.asset_id),
  );
};
assert(
  Math.abs(
    Math.min(...cornersFor("instance_3").map((p) => p[2])) -
      Math.max(...cornersFor("instance_1").map((p) => p[2])) -
      3,
  ) < 1e-8,
);
assert.notDeepEqual(
  stacked.instances[2].position,
  tiltedProject.instances[2].position,
);
assert.throws(() => stackAbove(machines, "instance_3", "instance_3", 0));
assert.throws(() => stackAbove(machines, "instance_3", "instance_1", -1));
console.log(
  "PASS rotated plan projection and stacking with preserved orientation",
);

const mount = seedProject("machines", catalog);
assert.equal(mount.instances.length, 3);
assert.equal(mount.assets.length, 3);
assert(mount.assets.some((a) => a.source_id === "motor_mount_plate"));
