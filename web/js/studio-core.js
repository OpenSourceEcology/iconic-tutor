import { rotationMatrixXYZ } from "./machine-core.js";
// Pure document operations for the two guided composition studies.
export const DOMAIN_LABELS = {
  house: "A house, one module at a time",
  machines: "Mount a motor to a frame",
};
export const SOURCES = [
  "wall_4x8_2x6_16oc",
  "window_4x8_2x6_36x48",
  "door_4x8_2x6_38x83",
  "axis_2007_carriage",
  "axis_2007_idler",
  "axis_idler_spacer",
  "nema17_motor_reference",
  "mount_frame_rails",
  "motor_mount_plate",
];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const triple = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((x) => finite(x) && Math.abs(x) <= 1e6);
const identifier = (v) =>
  typeof v === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(v);
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const escapeXml = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function validateAsset(asset) {
  if (
    !asset ||
    !identifier(asset.id) ||
    !SOURCES.includes(asset.source_id) ||
    !["house", "machines"].includes(asset.domain)
  )
    throw new Error("Unknown asset identity or domain.");
  if (
    asset.domain !==
    (SOURCES.indexOf(asset.source_id) < 3 ? "house" : "machines")
  )
    throw new Error("Asset domain does not match its source.");
  if (
    typeof asset.title !== "string" ||
    !asset.title.trim() ||
    asset.title.length > 120
  )
    throw new Error("Asset needs a short title.");
  if (
    !Array.isArray(asset.bounds) ||
    asset.bounds.length !== 6 ||
    !asset.bounds.every(finite) ||
    asset.bounds.slice(0, 3).some((x, i) => x >= asset.bounds[i + 3])
  )
    throw new Error("Asset bounds are invalid.");
  if (
    typeof asset.source_url !== "string" ||
    !/^https:\/\//.test(asset.source_url)
  )
    throw new Error("Asset needs an HTTPS source link.");
  if (
    typeof asset.source_revision !== "string" ||
    !asset.recipe ||
    !asset.parameters ||
    Array.isArray(asset.parameters) ||
    typeof asset.parameters !== "object" ||
    !asset.parameter_specs ||
    typeof asset.parameter_specs !== "object" ||
    asset.recipe.source_id !== asset.source_id
  )
    throw new Error("Asset is missing its recipe or provenance.");
  const parameterKeys =
    asset.source_id === "axis_idler_spacer"
      ? ["outer_diameter_mm", "bore_mm", "thickness_mm"]
      : asset.source_id === "window_4x8_2x6_36x48"
        ? ["opening_width_in", "opening_height_in", "sill_height_in"]
        : asset.source_id === "motor_mount_plate"
          ? ["width_mm", "height_mm", "thickness_mm"]
          : [];
  if (
    Object.keys(asset.parameters).sort().join() !==
      [...parameterKeys].sort().join() ||
    Object.keys(asset.parameter_specs).sort().join() !==
      [...parameterKeys].sort().join()
  )
    throw new Error("Asset contains unsupported parameter fields.");
  for (const key of parameterKeys) {
    const spec = asset.parameter_specs[key],
      value = asset.parameters[key];
    if (
      !spec ||
      !finite(value) ||
      !finite(spec.min) ||
      !finite(spec.max) ||
      spec.min <= 0 ||
      spec.max < spec.min ||
      value < spec.min ||
      value > spec.max
    )
      throw new Error("Asset has invalid parameter values or bounds.");
  }
  if (
    !asset.validation ||
    asset.validation.geometry !== "passed" ||
    asset.validation.engineering !== "unreviewed" ||
    !Number.isInteger(asset.validation.solid_count) ||
    asset.validation.solid_count < 1 ||
    !finite(asset.validation.volume_mm3) ||
    asset.validation.volume_mm3 <= 0
  )
    throw new Error(
      "Asset must carry its geometry report and pending engineering status.",
    );
  if (
    !Array.isArray(asset.parts) ||
    !asset.parts.length ||
    asset.parts.length > 250
  )
    throw new Error("Asset needs 1–250 parts.");
  const ids = new Set();
  for (const part of asset.parts) {
    if (!part || !identifier(part.id) || ids.has(part.id))
      throw new Error("Part identities must be unique.");
    ids.add(part.id);
    const { vertices, indices } = part.mesh || {};
    if (
      !Array.isArray(vertices) ||
      !vertices.length ||
      vertices.length % 3 ||
      vertices.length > 2000000 ||
      !vertices.every(finite) ||
      !Array.isArray(indices) ||
      !indices.length ||
      indices.length % 3 ||
      indices.length > 4000000 ||
      !indices.every(
        (v) => Number.isInteger(v) && v >= 0 && v < vertices.length / 3,
      )
    )
      throw new Error("Invalid triangle mesh.");
    if (
      typeof part.brep !== "string" ||
      !part.brep.includes("CASCADE Topology") ||
      part.brep.length > 5000000
    )
      throw new Error("Missing export geometry.");
    if (!/^#[a-fA-F0-9]{6}$/.test(part.color))
      throw new Error("Invalid part color.");
  }
  return asset;
}

export function validateProject(project) {
  if (
    !project ||
    project.format !== "ose-composition-studio" ||
    project.version !== 1 ||
    !["house", "machines"].includes(project.domain)
  )
    throw new Error("Choose a Composition Studio project file.");
  if (
    project.goal !== undefined &&
    (typeof project.goal !== "string" || project.goal.length > 500)
  )
    throw new Error("Keep the project goal under 500 characters.");
  if (
    !Array.isArray(project.assets) ||
    !project.assets.length ||
    project.assets.length > 60 ||
    !Array.isArray(project.instances) ||
    project.instances.length > 200
  )
    throw new Error("This demo supports 60 assets and 200 instances.");
  const assets = new Map();
  for (const asset of project.assets) {
    validateAsset(asset);
    if (asset.domain !== project.domain || assets.has(asset.id))
      throw new Error("Project has duplicate assets or mixed domains.");
    assets.set(asset.id, asset);
  }
  const ids = new Set();
  for (const inst of project.instances) {
    if (
      !identifier(inst.id) ||
      ids.has(inst.id) ||
      !assets.has(inst.asset_id) ||
      !triple(inst.position) ||
      !triple(inst.rotation)
    )
      throw new Error("Project contains an invalid placement.");
    ids.add(inst.id);
  }
  if (project.annotations != null) {
    if (!Array.isArray(project.annotations) || project.annotations.length > 100)
      throw new Error("A diagram supports up to 100 annotations.");
    for (const item of project.annotations) {
      if (!["text", "arrow"].includes(item.kind) || !triple(item.position))
        throw new Error("Invalid diagram annotation.");
      if (
        item.kind === "text" &&
        (typeof item.text !== "string" ||
          !item.text.trim() ||
          item.text.length > 120)
      )
        throw new Error("A diagram label needs 1–120 characters.");
      if (item.kind === "arrow" && !triple(item.to))
        throw new Error("Invalid diagram arrow.");
    }
  }
  return project;
}

export function seedProject(domain, catalog) {
  const mount =
    domain === "machines" &&
    catalog.some((a) => a.source_id === "motor_mount_plate");
  const assets = catalog.filter(
    (a) =>
      a.domain === domain &&
      (!mount ||
        [
          "nema17_motor_reference",
          "mount_frame_rails",
          "motor_mount_plate",
        ].includes(a.source_id)),
  );
  const bySource = (source) => assets.find((a) => a.source_id === source);
  const instances = [];
  const add = (source, position, angle = 0) =>
    instances.push({
      id: `instance_${instances.length + 1}`,
      asset_id: bySource(source).id,
      position,
      rotation: [0, 0, angle],
    });
  if (domain === "house") {
    const w = 1219.2,
      d = 139.7,
      l = w * 3;
    for (let i = 0; i < 3; i++) {
      add(
        i === 1
          ? "door_4x8_2x6_38x83"
          : i === 0
            ? "window_4x8_2x6_36x48"
            : "wall_4x8_2x6_16oc",
        [i * w, 0, 0],
      );
      add("wall_4x8_2x6_16oc", [l + d, d + i * w, 0], 90);
      add(
        i === 1 ? "window_4x8_2x6_36x48" : "wall_4x8_2x6_16oc",
        [l - i * w, l + 2 * d, 0],
        180,
      );
      add("wall_4x8_2x6_16oc", [-d, l + d - i * w, 0], 270);
    }
  } else if (mount) {
    add("nema17_motor_reference", [0, 0, 0]);
    add("mount_frame_rails", [0, 0, 0]);
    add("motor_mount_plate", [0, 0, 0]);
  } else {
    // A source-parts study, with separated parts. These are not mating transforms.
    add("axis_2007_carriage", [0, 0, 0]);
    add("axis_2007_idler", [180, 0, 0]);
    add("axis_idler_spacer", [100, -65, 0]);
  }
  return validateProject({
    format: "ose-composition-studio",
    version: 1,
    domain,
    assets,
    instances,
  });
}

export function addInstance(project, asset, position) {
  validateAsset(asset);
  const next = clone(project);
  if (asset.domain !== next.domain)
    throw new Error("Switch lessons to place this component.");
  if (!next.assets.some((a) => a.id === asset.id))
    next.assets.push(clone(asset));
  let index = 1;
  while (next.instances.some((i) => i.id === `instance_${index}`)) index++;
  next.instances.push({
    id: `instance_${index}`,
    asset_id: asset.id,
    position: [...position],
    rotation: [0, 0, 0],
  });
  return validateProject(next);
}

export function replaceInstance(project, instanceId, asset) {
  const inst = project.instances.find((i) => i.id === instanceId);
  if (!inst) throw new Error("Select a placed component first.");
  validateAsset(asset);
  if (asset.domain !== project.domain)
    throw new Error("Variant belongs to another lesson.");
  const next = clone(project);
  if (!next.assets.some((a) => a.id === asset.id))
    next.assets.push(clone(asset));
  next.instances.find((i) => i.id === instanceId).asset_id = asset.id;
  return validateProject(next);
}

export function worldCorners(instance, asset) {
  const m = rotationMatrixXYZ(...instance.rotation);
  const points = [];
  for (const x of [asset.bounds[0], asset.bounds[3]])
    for (const y of [asset.bounds[1], asset.bounds[4]])
      for (const z of [asset.bounds[2], asset.bounds[5]])
        points.push(
          [0, 1, 2].map(
            (axis) =>
              instance.position[axis] +
              m[axis * 3] * x +
              m[axis * 3 + 1] * y +
              m[axis * 3 + 2] * z,
          ),
        );
  return points;
}
export function stackAbove(project, selectedId, targetId, gap = 0) {
  if (
    selectedId === targetId ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    gap > 10000
  )
    throw new Error("Choose another part and a gap from 0 to 10,000 mm.");
  const next = clone(project);
  const selected = next.instances.find((i) => i.id === selectedId),
    target = next.instances.find((i) => i.id === targetId);
  if (!selected || !target) throw new Error("Select two placed parts.");
  const bounds = (i) => {
    const corners = worldCorners(
      i,
      next.assets.find((a) => a.id === i.asset_id),
    );
    return [0, 1, 2].map((axis) => [
      Math.min(...corners.map((p) => p[axis])),
      Math.max(...corners.map((p) => p[axis])),
    ]);
  };
  const a = bounds(selected),
    b = bounds(target);
  selected.position[0] += (b[0][0] + b[0][1] - a[0][0] - a[0][1]) / 2;
  selected.position[1] += (b[1][0] + b[1][1] - a[1][0] - a[1][1]) / 2;
  selected.position[2] += b[2][1] + gap - a[2][0];
  return validateProject(next);
}
export function footprint(instance, asset) {
  // Convex hull of all eight rotated box corners, projected onto the XY plane.
  const points = worldCorners(instance, asset)
    .map((p) => p.slice(0, 2))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const hull = [];
    for (const p of list) {
      while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), p) <= 0)
        hull.pop();
      hull.push(p);
    }
    return hull;
  };
  const lower = half(points),
    upper = half([...points].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function compositionSvg(project, selectedId = null, camera = null) {
  const entries = project.instances.map((inst) => ({
    inst,
    asset: project.assets.find((a) => a.id === inst.asset_id),
  }));
  const points = [
    ...entries.flatMap(({ inst, asset }) => footprint(inst, asset)),
    ...(project.annotations || []).flatMap((a) => [
      a.position,
      ...(a.to ? [a.to] : []),
    ]),
  ];
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const minx = Math.min(0, ...xs),
    miny = Math.min(0, ...ys),
    maxx = Math.max(project.domain === "house" ? 400 : 40, ...xs),
    maxy = Math.max(project.domain === "house" ? 400 : 40, ...ys);
  const span = Math.max(maxx - minx, maxy - miny),
    pad = span * 0.16,
    font = (camera ? Math.max(camera[2], camera[3]) / 1.32 : span) * 0.027;
  const shapes = entries
    .map(({ inst, asset }, index) => {
      const p = footprint(inst, asset),
        cx = p.reduce((a, b) => a + b[0], 0) / p.length,
        cy = p.reduce((a, b) => a + b[1], 0) / p.length;
      const picked = inst.id === selectedId;
      return `<g data-instance="${escapeXml(inst.id)}" tabindex="0" role="button" aria-label="${escapeXml(asset.title)} ${index + 1}"><title>${escapeXml(asset.title)}</title><polygon points="${p.map((p) => p.join(",")).join(" ")}" fill="${picked ? "#dcebab" : asset.draft ? "#c2dfd8" : "#e7e1d5"}" stroke="${picked ? "#516b26" : "#858d7d"}" stroke-width="${span * 0.003}"/><circle cx="${cx}" cy="${cy}" r="${font * 0.8}" fill="${picked ? "#324522" : "#65725e"}"/><text x="${cx}" y="${cy + font * 0.32}" text-anchor="middle" font-family="system-ui" font-size="${font}" fill="white" pointer-events="none">${index + 1}</text></g>`;
    })
    .join("");
  const annotations = (project.annotations || [])
    .map((a) =>
      a.kind === "text"
        ? `<text x="${a.position[0]}" y="${a.position[1]}" font-family="system-ui" font-size="${font}" fill="#304831">${escapeXml(a.text)}</text>`
        : `<line x1="${a.position[0]}" y1="${a.position[1]}" x2="${a.to[0]}" y2="${a.to[1]}" stroke="#657e47" stroke-width="${span * 0.003}" marker-end="url(#arrow-tip)"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(camera || [minx - pad, miny - pad, maxx - minx + 2 * pad, maxy - miny + 2 * pad]).join(" ")}" aria-label="Composition plan"><defs><marker id="arrow-tip" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#657e47" stroke-width="1.3"/></marker></defs>${shapes}${annotations}</svg>`;
}

export function contributionFiles(asset) {
  validateAsset(asset);
  const metadata = {
    id: asset.id,
    title: asset.title,
    status: "wip",
    engineering_status: "unreviewed",
    source: asset.source_url,
    source_revision: asset.source_revision,
    recipe: asset.recipe,
    license_review: asset.license_review,
  };
  const schema = {
    schema_name: asset.id,
    units: "mm",
    source_id: asset.source_id,
    parameters: asset.parameters,
    parts: asset.parts.map((p) => ({ id: p.id, file: p.id + ".brp" })),
  };
  return {
    "schema.json": JSON.stringify(schema, null, 2),
    "schema.py": `import json\nfrom pathlib import Path\nSCHEMA = json.loads(Path(__file__).with_name('schema.json').read_text())\n`,
    "meta.json": JSON.stringify(metadata, null, 2),
    "validation.json": JSON.stringify(asset.validation, null, 2),
    "compiler.py": `from pathlib import Path\nimport Part\n\ndef compile(schema, doc):\n    objects = []\n    root = Path(__file__).resolve().parent\n    for part in schema['parts']:\n        path = (root / part['file']).resolve()\n        if path.parent != root:\n            raise ValueError('Part must be inside this entry')\n        shape = Part.Shape()\n        shape.read(str(path))\n        if not shape.isValid() or not shape.isClosed() or shape.Volume <= 0:\n            raise ValueError('Invalid saved solid')\n        obj = doc.addObject('Part::Feature', part['id'])\n        obj.Shape = shape\n        objects.append(obj)\n    doc.recompute()\n    return objects\n`,
    "README.txt":
      "Draft contribution from OSE Composition Studio.\ncompiler.py restores the saved geometry. Re-generate dimensional changes in the studio using the source recipe; changing schema.json alone does not rebuild these BREPs.\nGeometry checks are not engineering approval. Review fit, interfaces, materials and source terms before publication or fabrication.\n",
    "wiki-draft.txt": `= ${asset.title.replaceAll(/[[\]{}<>|\n\r]/g, " ")} =\nStatus: Draft; engineering review pending.\n\n== Source ==\n${asset.source_url}\nSource revision: ${asset.source_revision}\n\n== Parameters ==\n<pre>${escapeXml(JSON.stringify(asset.parameters, null, 2))}</pre>\n\n== Validation ==\nValid closed source solids; preview and BREP generated together.\nAssembly fit and engineering performance have not been assessed.\n\n== Reproduction ==\nRecipe in meta.json; geometry and source schema packaged with this contribution.\n`,
    ...Object.fromEntries(asset.parts.map((p) => [p.id + ".brp", p.brep])),
  };
}
