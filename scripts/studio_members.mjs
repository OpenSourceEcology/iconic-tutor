// Use the existing framing enumerator for a proposed window variant.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = process.env.STUDIO_ICONIC_ROOT || fileURLToPath(new URL("../upstream/iconic-cad/", import.meta.url));
const { ALL_MODULES } = await import(pathToFileURL(resolve(root, "web/js/constants.js")));
const { enumerateMembers } = await import(pathToFileURL(resolve(root, "web/js/members.js")));
const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const mod = structuredClone(
  ALL_MODULES.find((m) => m.id === request.source_id),
);
if (!mod?.aperture || mod.aperture.type !== "window")
  throw new Error("Expected the supported window module.");
Object.assign(mod.aperture, {
  ro_w_in: request.parameters.opening_width_in,
  ro_h_in: request.parameters.opening_height_in,
  sill_in: request.parameters.sill_height_in,
});
process.stdout.write(JSON.stringify(enumerateMembers(mod)));
