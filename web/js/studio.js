import { saveSession, loadSession } from "./studio-storage.js";
import {
  DOMAIN_LABELS,
  clone,
  validateAsset,
  validateProject,
  seedProject,
  addInstance,
  replaceInstance,
  compositionSvg,
  stackAbove,
  contributionFiles,
  escapeXml,
} from "./studio-core.js";
import { mountAlignment } from "./mount-preview.js";
import { createStudioView } from "./studio-view.js?v=20260912-village-4";
import {
  rigidTransformBrep,
  machineDocumentXml,
  machineGuiDocumentXml,
} from "./machine-fcstd.js";
import JSZip from "../vendor/jszip.min.mjs";

const $ = (id) => document.getElementById(id);
let catalog = [],
  domain = "house",
  projects = {},
  histories = {},
  futures = {},
  lessons = { house: 0, machines: 0 },
  selectedId = null,
  paletteId = null,
  candidate = null,
  candidateBase = null,
  reviewed = false,
  busy = false,
  chatBusy = false;
let service = { generation: false, tutor: false },
  view = null,
  comparisonView = null,
  noticeTimer = null;
const historyLimit = 20;
const planCameras = {};
let archivedAxis = null;
const conversations = { house: [], machines: [] };
const labels = {
  width_mm: "Plate width",
  height_mm: "Plate height",
  opening_width_in: "Opening width",
  opening_height_in: "Opening height",
  sill_height_in: "Sill height",
  outer_diameter_mm: "Outer diameter",
  bore_mm: "Bore diameter",
  thickness_mm: "Thickness",
};
const steps = ["Choose", "Change", "Check", "Reuse"];
const project = () => projects[domain];
const instance = () => project()?.instances.find((i) => i.id === selectedId);
const asset = () =>
  project()?.assets.find((a) => a.id === (instance()?.asset_id || paletteId)) ||
  catalog.find((a) => a.id === paletteId);
const targetSource = () =>
  domain === "house" ? "window_4x8_2x6_36x48" : "motor_mount_plate";
function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => ($("notice").textContent = ""),
    error ? 9000 : 4500,
  );
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function addChat(text, user = false, sources = [], record = true) {
  if (record) {
    conversations[domain].push({
      role: user ? "user" : "assistant",
      content: text.slice(0, 1200),
      sources,
    });
    conversations[domain] = conversations[domain].slice(-20);
    remember();
  }
  const message = document.createElement("div");
  message.className = "chat-message" + (user ? " user" : "");
  const who = document.createElement("strong");
  who.textContent = user ? "YOU" : service.tutor ? "OSE TUTOR" : "LESSON GUIDE";
  message.append(who, document.createTextNode(text));
  for (const source of sources) {
    if (
      !/^https:\/\/(wiki\.opensourceecology\.org|github\.com)\//.test(
        source.url,
      )
    )
      continue;
    const link = document.createElement("a");
    link.href = source.url;
    link.textContent = source.title;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "chat-source";
    message.append(link);
  }
  $("chat-log").append(message);
  while ($("chat-log").children.length > 20) $("chat-log").firstChild.remove();
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}
function remember() {
  saveSession({ projects, lessons, conversations, archivedAxis }).catch(() =>
    notice(
      "Browser storage is unavailable. Save a project file to keep your work.",
      true,
    ),
  );
}
function restoreChat() {
  $("chat-log").replaceChildren();
  for (const item of conversations[domain])
    addChat(item.content, item.role === "user", item.sources || [], false);
}
function projectSummary() {
  const p = project();
  const used = new Map();
  for (const i of p.instances) {
    const a = p.assets.find((a) => a.id === i.asset_id);
    const key = JSON.stringify({
      source: a.source_id,
      parameters: a.parameters,
      draft: !!a.draft,
    });
    used.set(key, (used.get(key) || 0) + 1);
  }
  return {
    goal: p.goal || "",
    placed_count: p.instances.length,
    placed_types: [...used]
      .slice(0, 12)
      .map(([key, count]) => ({ ...JSON.parse(key), count })),
    draft_count: p.assets.filter((a) => a.draft).length,
    selected_instance: instance()
      ? {
          id: instance().id,
          position_mm: instance().position,
          rotation_deg: instance().rotation,
        }
      : null,
    candidate: candidate
      ? {
          parameters: candidate.parameters,
          base_parameters: candidateBase.parameters,
          solid_count: candidate.validation.solid_count,
          engineering: "unreviewed",
          placed: false,
        }
      : null,
    annotations: (p.annotations || [])
      .filter((a) => a.kind === "text")
      .slice(-3)
      .map((a) => a.text),
  };
}
function reconcileLesson() {
  const drafts = new Set(
    project()
      .assets.filter((a) => a.draft)
      .map((a) => a.id),
  );
  if (drafts.size)
    lessons[domain] = project().instances.some((i) => drafts.has(i.asset_id))
      ? 4
      : 3;
  else lessons[domain] = Math.min(lessons[domain], 1);
}
function change(next) {
  validateProject(next);
  histories[domain].push(project());
  if (histories[domain].length > historyLimit) histories[domain].shift();
  futures[domain] = [];
  projects[domain] = next;
  remember();
  render();
}
function setBusy(value) {
  busy = value;
  document
    .querySelectorAll("[data-domain]")
    .forEach((b) => (b.disabled = value));
  $("generate").disabled =
    value ||
    !service.generation ||
    !Object.keys(asset()?.parameters || {}).length;
  $("reset-lesson").disabled = value;
  $("open-project").disabled = value;
  $("mount-fit").disabled = value;
  $("edit-mount").disabled = value;
  $("parameter-fields")
    .querySelectorAll("input")
    .forEach((i) => (i.disabled = value));
}
function icon(a) {
  const common =
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"';
  let shape;
  if (a.source_id === "motor_mount_plate")
    shape =
      '<path d="M5 9h38v30H5z"/><circle cx="24" cy="24" r="7"/><circle cx="11" cy="15" r="2"/><circle cx="37" cy="15" r="2"/><circle cx="11" cy="33" r="2"/><circle cx="37" cy="33" r="2"/>';
  else if (a.source_id.includes("spacer"))
    shape =
      '<ellipse cx="24" cy="27" rx="18" ry="11"/><ellipse cx="24" cy="24" rx="18" ry="11"/><ellipse cx="24" cy="24" rx="9" ry="5.5"/><path d="M6 24v3m36-3v3"/>';
  else if (a.domain === "machines")
    shape =
      '<path d="m7 15 23-7 12 8-23 8zM7 15v19l12 8V24m0 18 23-7V16M15 18l23-7"/><circle cx="30" cy="28" r="4"/>';
  else
    shape = `<path d="M6 7h36v34H6zM8 11h32M8 37h32M11 11v26m26-26v26"/>${a.source_id.startsWith("window") ? '<path d="M16 18h16v14H16zM16 15v22m16-22v22"/>' : a.source_id.startsWith("door") ? '<path d="M16 18h16v23M16 15v26m16-26v26"/>' : '<path d="M20 11v26m9-26v26"/>'}`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g ${common}>${shape}</g></svg>`;
}
function renderPalette() {
  const all = new Map(
    [
      ...catalog.filter(
        (a) =>
          a.domain === domain &&
          (domain !== "machines" ||
            !project().assets.some(
              (x) => x.source_id === "motor_mount_plate",
            ) ||
            [
              "nema17_motor_reference",
              "mount_frame_rails",
              "motor_mount_plate",
            ].includes(a.source_id)),
      ),
      ...project().assets,
    ].map((a) => [a.draft ? a.id : a.source_id, a]),
  );
  $("asset-palette").replaceChildren();
  for (const a of all.values()) {
    const b = document.createElement("button");
    b.className = "asset-card";
    b.draggable = true;
    b.dataset.asset = a.id;
    b.setAttribute("aria-pressed", String(a.id === asset()?.id));
    b.innerHTML = icon(a) + "<span><strong></strong><small></small></span>";
    b.querySelector("strong").textContent = a.title;
    b.querySelector("small").textContent = a.draft
      ? "Your saved variant"
      : Object.keys(a.parameters).length
        ? "Editable parameters"
        : "Source geometry";
    b.addEventListener("click", () => {
      if (busy) return;
      candidate = null;
      selectedId =
        project().instances.find((i) => i.asset_id === a.id)?.id || null;
      paletteId = a.id;
      render();
      if (!selectedId) {
        notice(
          "Selected library component. Drag it into the plan or use Place selected.",
        );
      }
    });
    b.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-ose-asset", a.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    $("asset-palette").append(b);
  }
}
function renderInspector() {
  const a = asset();
  if (!a) return;
  const mount =
    domain === "machines" &&
    project().assets.some((x) => x.source_id === "motor_mount_plate");
  $(
    mount && a.source_id === "motor_mount_plate"
      ? "mount-controls-slot"
      : "standard-controls-slot",
  ).append($("parameter-form"));
  $("edit-mount").hidden = a.source_id === "motor_mount_plate";
  $("selected-title").textContent = a.title;
  $("selected-summary").textContent =
    a.domain === "house"
      ? "A 48 × 96 in wall module. Openings change inside its fixed outer envelope."
      : a.source_id === "motor_mount_plate"
        ? "Your adapter joins the motor’s fixed hole pattern to the wider frame rails."
        : a.source_id === "nema17_motor_reference"
          ? "Motor reference: the four face holes are 31 mm apart. Edit the gold mounting plate to fit the frame."
          : a.source_id.startsWith("axis_")
            ? "Archived Axis reference geometry. No mating connection is established."
            : "The frame’s hole centers are 76 mm apart across and 46 mm along the rails.";
  $("source-link").href = a.source_url;
  $("source-link").textContent = mount
    ? "Read the motor drawing ↗"
    : "Read its wiki source ↗";
  $("source-revision").textContent =
    "Source revision " +
    a.source_revision.slice(0, 12) +
    " · geometry report retained";
  $("parameter-fields").replaceChildren();
  const entries = Object.entries(a.parameters);
  for (const [key, value] of entries) {
    const div = document.createElement("div");
    div.className = "field";
    const label = document.createElement("label");
    label.htmlFor = "param-" + key;
    label.textContent =
      (labels[key] || key) +
      (a.source_id === "motor_mount_plate" ? " (mm)" : "");
    const input = document.createElement("input");
    input.type = "number";
    input.id = "param-" + key;
    input.name = key;
    input.value = value;
    input.min = a.parameter_specs[key].min;
    input.max = a.parameter_specs[key].max;
    input.step = "any";
    input.required = true;
    div.append(label, input);
    if (a.source_id === "motor_mount_plate") {
      const slider = document.createElement("input");
      Object.assign(slider, {
        type: "range",
        id: "range-" + key,
        min: input.min,
        max: input.max,
        step: key === "thickness_mm" ? "0.5" : "1",
        value: input.value,
      });
      slider.setAttribute("aria-label", labels[key] || key);
      slider.addEventListener("input", () => {
        input.value = slider.value;
        previewMount();
      });
      input.addEventListener("input", () => {
        slider.value = input.value;
        previewMount();
      });
      div.append(slider);
    }
    $("parameter-fields").append(div);
  }
  $("parameter-units").textContent = entries.length
    ? domain === "house"
      ? "INCHES"
      : "MILLIMETRES"
    : "";
  $("parameter-note").textContent = entries.length
    ? "Ranges bound this lesson. They are not fabrication-approved limits."
    : "This component retains fixed source geometry. Choose " +
      (domain === "house" ? "Window wall" : "Motor mounting plate") +
      " to create a dimensional variant.";
  $("generate").disabled = busy || !service.generation || !entries.length;
  $("generation-status").textContent = busy
    ? "FreeCAD is generating…"
    : service.generation
      ? "FreeCAD connected"
      : "Generation needs the local service";
  if (mount) {
    const placed = project()
      .instances.map((i) => project().assets.find((a) => a.id === i.asset_id))
      .find((a) => a.source_id === "motor_mount_plate");
    if (placed) updateMountFeedback(placed.parameters, false);
  }
  renderCandidate();
}
function updateMountFeedback(parameters, preview) {
  const error = mountAlignment(parameters);
  $("mount-feedback").textContent =
    error < 0.01
      ? "✓ All four frame-hole centers line up."
      : `Frame holes miss by ${error.toFixed(1)} mm. Try a wider plate.`;
  const items = project().instances.filter((i) =>
    [
      "motor_mount_plate",
      "nema17_motor_reference",
      "mount_frame_rails",
    ].includes(project().assets.find((a) => a.id === i.asset_id)?.source_id),
  );
  const inPlace =
    items.length === 3 &&
    items.every(
      (i) =>
        i.rotation.every((v) => Math.abs(v % 360) < 1e-6) &&
        i.position.every((v, k) => Math.abs(v - items[0].position[k]) < 1e-6),
    );
  if (!inPlace)
    $("mount-feedback").textContent =
      `Hole-pattern offset: ${error.toFixed(1)} mm. Parts have moved; check their placement separately.`;
  $("mount-feedback").classList.toggle("aligned", error < 0.01 && inPlace);
  $("mount-preview-label").textContent = preview
    ? "Live preview · generate to create checked CAD."
    : "Showing saved geometry. Drag a slider to try a change.";
}
function previewMount() {
  if (busy || asset()?.source_id !== "motor_mount_plate") return;
  const values = Object.fromEntries(
    [...$("parameter-fields").querySelectorAll("input[name]")].map((i) => [
      i.name,
      Number(i.value),
    ]),
  );
  if (
    [...$("parameter-fields").querySelectorAll("input[name]")].some(
      (i) => !i.checkValidity(),
    )
  )
    return;
  candidate = null;
  reviewed = false;
  $("comparison-panel").hidden = true;
  renderCandidate();
  setView(false);
  view?.previewPlate?.(values);
  updateMountFeedback(values, true);
}
$("edit-mount").addEventListener("click", selectLessonTarget);
$("mount-fit").addEventListener("click", () => {
  if (asset()?.source_id !== "motor_mount_plate") selectLessonTarget();
  for (const [key, value] of Object.entries({ width_mm: 90, height_mm: 60 })) {
    $("param-" + key).value = value;
    $("range-" + key).value = value;
  }
  previewMount();
});
$("mount-assembly").addEventListener("click", () => {
  setView(false);
  view?.setExploded?.(false);
  view?.cameraPreset?.("assembly");
});
$("mount-exploded").addEventListener("click", () => {
  setView(false);
  view?.setExploded?.(true);
  view?.cameraPreset?.("assembly");
});
$("mount-top").addEventListener("click", () => {
  setView(false);
  view?.setExploded?.(false);
  view?.cameraPreset?.("top");
});
$("download-axis").addEventListener("click", () => {
  if (archivedAxis)
    download(
      JSON.stringify(archivedAxis),
      "previous-axis-study.json",
      "application/json",
    );
});
function renderCandidate() {
  const a =
    candidate ||
    project()?.assets.find((a) => a.id === paletteId && a.draft) ||
    (asset()?.draft ? asset() : null);
  $("candidate-actions").hidden = !candidate;
  $("save-draft").disabled = !reviewed;
  $("export-contribution").disabled = !a?.draft;
  if (!a) {
    $("candidate-summary").textContent =
      "Change a supported parameter to create your first reusable variant.";
    return;
  }
  $("candidate-summary").replaceChildren();
  const p = document.createElement("p");
  p.textContent = a.draft
    ? "Saved in your palette. Place it again, or share a draft contribution package."
    : "New geometry is ready. Compare the original on the left with your variant on the right.";
  const detail = document.createElement("p");
  detail.textContent = `${a.validation.solid_count} valid solids · engineering review pending`;
  $("candidate-summary").append(p, detail);
  if (candidate) {
    $("draft-name").value = candidate.title;
    $("export-contribution").disabled = true;
  }
}
function renderLesson() {
  if (
    domain === "machines" &&
    !project().assets.some((a) => a.source_id === "motor_mount_plate")
  ) {
    $("step-label").textContent = "ARCHIVED AXIS STUDY";
    $("step-title").textContent = "Your earlier work is retained";
    $("step-copy").textContent =
      "You can arrange and export this study. The new motor mounting lesson shows a complete connection and lets you resize its plate.";
    $("lesson-action").textContent = "Open motor mounting lesson";
    $("lesson-action").disabled = busy;
    return;
  }
  if (lessons[domain] === 2 && !candidate) lessons[domain] = 1;
  const step = lessons[domain];
  $("lesson-steps").innerHTML = steps
    .map(
      (s, i) =>
        `<li class="${i < step ? "done" : i === step ? "current" : ""}">${String(i + 1).padStart(2, "0")} ${s}</li>`,
    )
    .join("");
  const house = domain === "house";
  const titles = house
    ? [
        "Meet the window module",
        "Keep the wall. Change the opening.",
        "Look beyond the picture",
        "Let your new module travel",
      ]
    : [
        "The plate does not reach the frame",
        "Widen the plate. Keep the motor holes.",
        "Check the new plate",
        "Use it on the motor",
      ];
  const copies = house
    ? [
        "Select the window wall in this small house study. Its outside dimensions stay fixed, so we can explore a different opening inside the same building block.",
        "Try a 30-inch-wide opening. See how the framing changes while the 48-inch wall module stays the same size.",
        "Compare both versions and inspect the geometry checks. These checks describe solids; header selection and building performance still need engineering review.",
        "Save your variant to the palette, then use it in a second wall position. Export the design and the contribution together.",
      ]
    : [
        "The black motor sits between two blue frame rails. The gold plate attaches to the motor, but its outer holes miss the rails. Pull the parts apart to see how they meet.",
        "Drag Plate width from 60 to 90 mm. The outer holes move onto the frame. The motor’s 31 mm hole pattern stays fixed. Use Look down at holes to check alignment.",
        "Compare the plate dimensions, inspect the holes and review the FreeCAD checks. Hole alignment does not establish strength or fastener selection.",
        "Save the checked plate, then use it to replace the original in the assembly. Your motor and rails stay in place.",
      ];
  $("step-label").textContent =
    step >= 4 ? "LESSON COMPLETE" : `STEP ${step + 1} OF 4`;
  $("step-title").textContent =
    step >= 4 ? "A small contribution, ready to share." : titles[step];
  $("step-copy").textContent =
    step >= 4
      ? "You selected a source, generated a variant, inspected its checks, and reused it. Save your project or download the contribution for review."
      : copies[step];
  $("lesson-action").textContent =
    step >= 4
      ? "Download contribution"
      : step === 0
        ? "Select " + (house ? "window wall" : "mounting plate")
        : step === 1
          ? "Try " + (house ? "a 30 in opening" : "a 90 mm plate")
          : step === 2
            ? "Inspect the comparison"
            : "Use my saved variant";
  $("lesson-action").disabled = busy || (step === 1 && !service.generation);
  if (step === 1 && !service.generation)
    $("lesson-action").textContent = "Generate in the full version";
  $("chat-suggestions").replaceChildren();
  for (const text of [
    "What changes here?",
    "What should I check?",
    domain === "house" ? "Show machine parts" : "Show housing modules",
  ]) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", () => askTutor(text));
    $("chat-suggestions").append(b);
  }
}
function render({ fit = false } = {}) {
  if (!project()) return;
  document.body.classList.toggle("working", lessons[domain] > 0);
  if (!instance() && !asset()) {
    selectedId =
      (domain === "machines"
        ? project().instances.find(
            (i) =>
              project().assets.find((a) => a.id === i.asset_id)?.source_id ===
              "motor_mount_plate",
          )?.id
        : null) ||
      project().instances[0]?.id ||
      null;
    paletteId = project().assets[0]?.id || null;
  }
  $("project-goal").value = project().goal || "";
  $("project-goal").placeholder =
    domain === "house"
      ? "e.g. A 30 in rough opening in this wall"
      : "e.g. Mount this motor on the wider frame";
  $("workspace-title").textContent = DOMAIN_LABELS[domain];
  $("palette-title").textContent =
    domain === "house" ? "Housing library" : "Machine parts";
  $("instance-count").textContent =
    project().instances.length + " placed modules";
  $("design-note").textContent =
    domain === "house"
      ? "Wall-layout study only. Corners, roof, foundation and engineering remain to be resolved."
      : "Motor reference and demo frame. Slider previews are saved only after generation and review.";
  $("view-caption").textContent =
    domain === "house"
      ? "A 12-foot wall-layout study"
      : "Motor + mounting plate + frame";
  $("plan").innerHTML = compositionSvg(
    project(),
    selectedId,
    fit ? null : planCameras[domain],
  );
  planCameras[domain] = $("plan")
    .querySelector("svg")
    .getAttribute("viewBox")
    .split(" ")
    .map(Number);
  $("undo").disabled = busy || !histories[domain].length;
  $("redo").disabled = busy || !futures[domain].length;
  $("remove").disabled = busy || !instance();
  $("rotate").disabled = busy || !instance();
  $("comparison-panel").hidden = !candidate;
  $("machine-interface").hidden = domain !== "machines";
  const mount =
    domain === "machines" &&
    project().assets.some((a) => a.source_id === "motor_mount_plate");
  document.body.classList.toggle("motor-lesson", mount);
  $("machine-task").hidden = !mount;
  $("mount-tools").hidden = !mount;
  $("download-axis").hidden = !archivedAxis;
  renderPlacement();
  renderPalette();
  renderInspector();
  renderLesson();
  if (view) view.render(project(), selectedId, { fitView: fit });
  if (
    view &&
    asset()?.source_id === "motor_mount_plate" &&
    asset().draft &&
    !instance()
  ) {
    view.previewPlate?.(asset().parameters);
    updateMountFeedback(asset().parameters, true);
    $("mount-preview-label").textContent =
      "Saved draft preview · use your saved variant to update the assembly.";
  }
}
function applyPlacement(id, placement) {
  if (busy) {
    render();
    return;
  }
  try {
    const next = clone(project());
    const item = next.instances.find((i) => i.id === id);
    if (!item) return;
    item.position = placement.position;
    item.rotation = placement.rotation;
    selectedId = id;
    candidate = null;
    change(next);
  } catch (error) {
    notice(error.message, true);
    render();
  }
}
function renderPlacement() {
  const selected = instance();
  $("placement-title").textContent = selected
    ? `· ${asset().title}`
    : "· select a placed part";
  $("placement-fields").disabled = !selected || busy;
  $("placement-inputs").replaceChildren();
  for (const [kind, units] of [
    ["position", "mm"],
    ["rotation", "°"],
  ])
    for (const [axis, name] of ["X", "Y", "Z"].entries()) {
      const label = document.createElement("label");
      label.textContent = `${kind === "rotation" ? "Rotate " : ""}${name} (${units})`;
      const input = document.createElement("input");
      Object.assign(input, {
        id: `place-${kind}-${axis}`,
        type: "number",
        min: "-1000000",
        max: "1000000",
        step: "any",
        required: true,
        value: selected ? Number(selected[kind][axis].toFixed(6)) : 0,
      });
      label.append(input);
      $("placement-inputs").append(label);
    }
  const oldTarget = $("stack-target").value;
  $("stack-target").replaceChildren();
  for (const [index, item] of project().instances.entries()) {
    if (item.id === selected?.id) continue;
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${index + 1}. ${project().assets.find((a) => a.id === item.asset_id).title}`;
    $("stack-target").append(option);
  }
  if ([...$("stack-target").options].some((o) => o.value === oldTarget))
    $("stack-target").value = oldTarget;
  $("stack-above").disabled =
    !selected || busy || !$("stack-target").options.length;
}
$("placement-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!instance()) return;
  const values = (kind) =>
    [0, 1, 2].map((axis) => Number($(`place-${kind}-${axis}`).value));
  applyPlacement(selectedId, {
    position: values("position"),
    rotation: values("rotation"),
  });
});
$("stack-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy || !instance()) return;
  try {
    candidate = null;
    change(
      stackAbove(
        project(),
        selectedId,
        $("stack-target").value,
        Number($("stack-gap").value),
      ),
    );
    setView(false);
    view.fit();
  } catch (error) {
    notice(error.message, true);
  }
});
$("focus-selected").addEventListener("click", () => view?.focusSelected?.());
document.querySelectorAll("[data-transform]").forEach((button) =>
  button.addEventListener("click", () => {
    setView(false);
    view?.setTransformMode?.(button.dataset.transform);
    document
      .querySelectorAll("[data-transform]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    $("manipulation-help").textContent =
      button.dataset.transform === "orbit"
        ? "Drag to orbit · scroll to zoom"
        : "Select a part · drag a colored handle · Z is up · Esc cancels";
  }),
);
function selectInstance(id) {
  if (busy) return;
  candidate = null;
  selectedId = id;
  paletteId = instance()?.asset_id || null;
  render();
}
function setView(plan) {
  $("mount-stage").hidden = plan;
  $("plan-panel").hidden = !plan;
  $("viewport").hidden = plan;
  $("tab-plan").setAttribute("aria-selected", String(plan));
  $("tab-3d").setAttribute("aria-selected", String(!plan));
  if (!plan) view?.resize();
}
function selectLessonTarget() {
  candidate = null;
  selectedId =
    project().instances.find(
      (i) =>
        project().assets.find((a) => a.id === i.asset_id)?.source_id ===
        targetSource(),
    )?.id || null;
  paletteId =
    instance()?.asset_id ||
    catalog.find((a) => a.source_id === targetSource()).id;
  lessons[domain] = Math.max(1, lessons[domain]);
  render();
  remember();
  addChat(
    domain === "house"
      ? "This window wall is our starting point. Try narrowing the rough opening from 36 to 30 inches. The outer module stays 48 × 96 inches."
      : "Resize the gold plate until its outer holes line up with the blue rails. Try 90 mm width while keeping height 60 mm. The motor holes stay fixed at 31 mm spacing.",
  );
}
async function jsonFetch(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let error;
    try {
      error = (await response.json()).error;
    } catch {}
    throw new Error(error || `The local service returned ${response.status}.`);
  }
  return response.json();
}
function readParameters() {
  const out = {};
  for (const input of $("parameter-fields").querySelectorAll("input[name]")) {
    if (!input.reportValidity()) throw new Error("Check the parameter values.");
    out[input.name] = Number(input.value);
  }
  return out;
}
async function generate() {
  if (busy) return;
  const base = asset();
  if (!base || !service.generation) return;
  try {
    const parameters = readParameters();
    if (JSON.stringify(parameters) === JSON.stringify(base.parameters))
      return notice(
        "Change a parameter first; these dimensions match the selected component.",
      );
    setBusy(true);
    $("generation-status").textContent = "Generating real FreeCAD geometry…";
    const { job_id } = await jsonFetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: base.source_id, parameters }),
    });
    let result;
    const until = Date.now() + 110000;
    do {
      await new Promise((r) => setTimeout(r, 650));
      result = await jsonFetch("/api/studio/jobs/" + job_id);
      if (Date.now() > until)
        throw new Error(
          "Generation took too long. Your current design is intact.",
        );
    } while (result.status === "running");
    if (result.status !== "complete")
      throw new Error(result.error || "Generation failed.");
    validateAsset(result.asset);
    candidate = result.asset;
    candidateBase = base;
    reviewed = false;
    candidate.title =
      domain === "house"
        ? `Window · ${parameters.opening_width_in} × ${parameters.opening_height_in} in`
        : base.source_id === "motor_mount_plate"
          ? `Mounting plate · ${parameters.width_mm} × ${parameters.height_mm} mm`
          : `Spacer · ${parameters.thickness_mm} mm thick`;
    lessons[domain] = Math.max(2, lessons[domain]);
    setView(false);
    renderCandidate();
    renderLesson();
    showComparison(base, candidate);
    if (base.source_id === "motor_mount_plate")
      updateMountFeedback(candidate.parameters, true);
    $("generation-status").textContent = "Geometry ready to inspect";
    addChat(
      "The new geometry is ready. Compare the two versions, then inspect what passed and what still needs review. Your placed design has not changed yet.",
    );
  } catch (error) {
    notice(error.message, true);
    $("generation-status").textContent =
      "Could not generate; design preserved.";
  } finally {
    setBusy(false);
    renderLesson();
  }
}
function comparisonMarkup(original, variant) {
  const changed = Object.entries(variant.parameters).filter(
    ([k, v]) => v !== original.parameters[k],
  );
  const fixed = Object.entries(variant.parameters).filter(
    ([k, v]) => v === original.parameters[k],
  );
  const value = (k, v) =>
    `${Number(v.toFixed(3))} ${k.endsWith("_in") ? "in" : "mm"}`;
  const rows = Object.entries(variant.parameters)
    .map(
      ([k, v]) =>
        `<tr><td>${escapeXml(labels[k] || k)}</td><td>${value(k, original.parameters[k])}</td><td>${value(k, v)}</td><td>${v === original.parameters[k] ? "Fixed" : "Changed"}</td></tr>`,
    )
    .join("");
  const delta =
    (variant.validation.volume_mm3 / original.validation.volume_mm3 - 1) * 100;
  return `<p><strong>${changed.length} dimension${changed.length === 1 ? "" : "s"} changed.</strong> ${fixed.length} held fixed.${variant.domain === "house" ? " Outer wall stays 48 × 96 in." : " Compare the bore and thickness with the intended interface."}</p><table><thead><tr><th>Dimension</th><th>Original</th><th>Variant</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table><p>${original.parts.length} → ${variant.parts.length} solid parts · material volume ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%. Volume excludes waste and is not a purchasing estimate.</p>`;
}
function showComparison(original, variant) {
  $("comparison-panel").hidden = false;
  $("comparison-details").innerHTML = comparisonMarkup(original, variant);
  comparisonView?.compare(original, variant);
}
function reviewCandidate() {
  if (!candidate) return notice("Generate a variant to compare first.");
  const rows = Object.entries(candidate.parameters)
    .map(
      ([k, v]) =>
        `<tr><td>${escapeXml(labels[k] || k)}</td><td>${escapeXml(candidateBase.parameters[k])}</td><td>${escapeXml(v)}</td></tr>`,
    )
    .join("");
  $("review-content").innerHTML =
    comparisonMarkup(candidateBase, candidate) +
    `<p class="check">✓ ${candidate.validation.solid_count} valid closed solids with positive volume.<br>✓ Preview and export come from the same FreeCAD geometry.</p><table><thead><tr><th>Parameter</th><th>Original</th><th>Variant</th></tr></thead><tbody>${rows}</tbody></table><p>Original volume: <strong>${candidateBase.validation.volume_mm3.toFixed(2)} mm³</strong><br>Variant volume: <strong>${candidate.validation.volume_mm3.toFixed(2)} mm³</strong></p><p><strong>Still unreviewed:</strong> ${domain === "house" ? "header sizing, connections, structural performance and building compliance." : "mating dimensions, assembly fit, material and operating performance."}</p><p>Saving this draft records that you inspected this report. It does not grant engineering approval.</p>`;
  $("review-dialog").showModal();
}
function saveDraft() {
  if (!candidate || !reviewed) return;
  const name = $("draft-name").value.trim();
  if (!name) return notice("Give the variant a useful name.", true);
  const a = {
    ...candidate,
    title: name,
    draft: true,
    parent_id: candidateBase.id,
    review_acknowledged: true,
  };
  const next = clone(project());
  const existing = next.assets.find((x) => x.id === a.id);
  if (existing) Object.assign(existing, a);
  else next.assets.push(a);
  validateProject(next);
  change(next);
  paletteId = a.id;
  selectedId = null;
  candidate = null;
  lessons[domain] = 3;
  remember();
  render();
  notice(
    "Saved to your palette. Use it in the composition to finish the lesson.",
  );
  addChat(
    "Your named variant is now a reusable palette item. Use it in the composition, then download its geometry, recipe, source record and wiki draft.",
  );
}
function reuseDraft() {
  const a = asset()?.draft
    ? asset()
    : [...project().assets].reverse().find((a) => a.draft);
  if (!a) return notice("Save a reviewed variant to your palette first.");
  let next;
  if (domain === "house" || a.source_id === "motor_mount_plate") {
    const target = project().instances.find(
      (i) =>
        project().assets.find((x) => x.id === i.asset_id)?.source_id ===
          a.source_id &&
        !project().assets.find((x) => x.id === i.asset_id)?.draft,
    );
    if (target) {
      next = replaceInstance(project(), target.id, a);
      selectedId = target.id;
    } else {
      next = addInstance(project(), a, [0, -450, 0]);
      selectedId = next.instances.at(-1).id;
    }
  } else {
    const source = project().instances.find(
      (i) =>
        project().assets.find((x) => x.id === i.asset_id)?.source_id ===
        a.source_id,
    );
    const p = source ? [...source.position] : [0, 0, 0];
    p[0] += 40;
    next = addInstance(project(), a, p);
    selectedId = next.instances.at(-1).id;
  }
  paletteId = a.id;
  lessons[domain] = 4;
  change(next);
  setView(false);
  view.fit();
  addChat(
    "You’ve completed the contribution loop. The variant lives in your palette and your composition. Save the project to reopen it with all its geometry, or download the contribution for someone else to review.",
  );
}
async function exportContribution() {
  const a = asset()?.draft
    ? asset()
    : [...project().assets].reverse().find((a) => a.draft);
  if (!a) return notice("Save a variant first.");
  const zip = new JSZip();
  for (const [name, text] of Object.entries(contributionFiles(a)))
    zip.file(name, text);
  zip.file("asset.json", JSON.stringify(a));
  zip.file(
    "icon.svg",
    icon(a).replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"'),
  );
  download(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    a.id + "-contribution.zip",
    "application/zip",
  );
}
async function exportCad() {
  try {
    validateProject(project());
    if (!project().instances.length)
      throw new Error("Place a component before exporting.");
    const parts = [];
    for (const [i, inst] of project().instances.entries()) {
      const a = project().assets.find((a) => a.id === inst.asset_id);
      for (const [j, p] of a.parts.entries())
        parts.push({
          name: `Studio_${i}_${j}`,
          label: `${a.title} · ${p.label}`,
          source_url: a.source_url,
          source_revision: a.source_revision,
          brep: rigidTransformBrep(p.brep, inst.position, inst.rotation),
        });
    }
    const zip = new JSZip();
    zip.file(
      "Document.xml",
      machineDocumentXml(parts).replace(
        "Iconic CAD Machines",
        "OSE Composition Studio",
      ),
    );
    zip.file("GuiDocument.xml", machineGuiDocumentXml(parts));
    for (const p of parts) zip.file(p.name + ".brp", p.brep);
    download(
      await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
      "ose-" + domain + "-study.FCStd",
      "application/vnd.freecad",
    );
    notice("Exported the placed geometry. Engineering review remains pending.");
  } catch (error) {
    notice(error.message, true);
  }
}
async function askTutor(text) {
  if (chatBusy || busy) return;
  if (/\b(?:show|open|switch|explore|design|build)\b.*\b(?:village|cabins?)\b/i.test(text)) {
    location.href = "village.html";
    return;
  }
  // These visible navigation commands are local UI actions and also work in
  // guided mode. Questions and dimensional proposals go to the live model.
  const navigation = text.match(
    /\b(?:show|open|switch|explore|look)\b.*\b(machines?|axis|house|housing)\b/i,
  );
  if (navigation) {
    const nextDomain = /^(machine|axis)/i.test(navigation[1])
      ? "machines"
      : "house";
    document.querySelector(`[data-domain="${nextDomain}"]`).click();
    addChat(text, true);
    addChat(
      nextDomain === "house"
        ? "Here is the housing palette. The window wall has editable opening dimensions. Your machine study is retained."
        : "Here is the motor mounting lesson. Resize the gold plate to connect the motor to the frame rails. Your house study is retained.",
    );
    return;
  }
  addChat(text, true);
  if (!service.tutor) {
    addChat(
      text.toLowerCase().includes("check")
        ? domain === "house"
          ? "Inspect the opening dimensions and framing in the comparison. Geometry checks do not establish header sizing, structural performance, or connection details."
          : "Use Look down at holes. The motor holes must remain on their 31 mm pattern; the four outer holes need to meet the frame’s 76 × 46 mm pattern. A 90 × 60 mm plate does that with holes 7 mm in from each edge."
        : domain === "house"
          ? "The window opening changes inside a fixed 48 × 96 inch wall module. The existing framing compiler updates the surrounding members. Use “Try a 30 in opening” to begin."
          : "The gold plate’s outer holes miss the blue frame rails. Drag Plate width from 60 to 90 mm and watch the model grow. The motor holes stay fixed. Generate and review the new plate before saving it.",
    );
    return;
  }
  try {
    chatBusy = true;
    $("send-chat").disabled = true;
    const source = asset(),
      sourceAtRequest = source.id,
      domainAtRequest = domain;
    const answer = await jsonFetch("/api/studio/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: conversations[domain]
          .slice(0, -1)
          .slice(-8)
          .map(({ role, content }) => ({ role, content })),
        project: projectSummary(),
        source_id: source.source_id,
        parameters: source.parameters,
        step: steps[Math.min(lessons[domain], 3)],
      }),
    });
    if (domain !== domainAtRequest) return;
    addChat(answer.reply, false, answer.sources || []);
    if (answer.parameters) {
      if (asset()?.id !== sourceAtRequest)
        return addChat(
          "The selected component changed while I was answering. Select the original component to try that proposal.",
        );
      for (const [k, v] of Object.entries(answer.parameters)) {
        const input = $("param-" + k);
        if (input) input.value = v;
      }
      if (source.source_id === "motor_mount_plate") previewMount();
      notice("Proposed dimensions are in the form. Generate them when ready.");
    }
  } catch (error) {
    notice(error.message, true);
    addChat(
      "I could not reach the model. You can continue with the lesson buttons and parameter controls.",
    );
  } finally {
    chatBusy = false;
    $("send-chat").disabled = false;
  }
}

function planPoint(event) {
  const svg = $("plan").querySelector("svg");
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    svg.getScreenCTM().inverse(),
  );
  const grid = domain === "house" ? 25.4 : 1;
  return [Math.round(p.x / grid) * grid, Math.round(p.y / grid) * grid, 0];
}
let drag = null,
  annotationTool = null,
  arrowStart = null;
$("plan").addEventListener("pointerdown", (event) => {
  if (busy || drag || event.button > 1) return;
  if (annotationTool) {
    const point = planPoint(event);
    const next = clone(project());
    next.annotations ||= [];
    if (annotationTool === "text") {
      const text = $("annotation-text").value.trim();
      if (!text) return notice("Enter a short label first.");
      next.annotations.push({ kind: "text", position: point, text });
    } else {
      if (!arrowStart) {
        arrowStart = point;
        return notice("Click the arrow’s end point.");
      }
      next.annotations.push({ kind: "arrow", position: arrowStart, to: point });
    }
    annotationTool = null;
    arrowStart = null;
    try {
      change(next);
    } catch (error) {
      notice(error.message, true);
    }
    return;
  }
  const group = event.target.closest("[data-instance]");
  const svg = $("plan").querySelector("svg");
  if (!svg) return;
  const inverse = svg.getScreenCTM().inverse();
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    inverse,
  );
  const pan = !group || event.button === 1 || event.shiftKey;
  if (!pan) {
    selectedId = group.dataset.instance;
    paletteId = instance().asset_id;
    candidate = null;
    view.select(selectedId);
  }
  drag = {
    id: pan ? null : selectedId,
    group,
    inverse,
    start: point,
    screen: [event.clientX, event.clientY],
    camera: [...planCameras[domain]],
    position: pan ? null : [...instance().position],
    pointerId: event.pointerId,
    moved: false,
    delta: [0, 0],
    frame: null,
  };
  $("plan").setPointerCapture(event.pointerId);
  $("plan").classList.add("dragging");
  event.preventDefault();
});
function paintDrag() {
  if (!drag) return;
  drag.frame = null;
  const [x, y] = drag.delta;
  if (drag.id) drag.group.setAttribute("transform", `translate(${x} ${y})`);
  else {
    const [cx, cy, w, h] = drag.camera;
    planCameras[domain] = [cx - x, cy - y, w, h];
    $("plan")
      .querySelector("svg")
      .setAttribute("viewBox", planCameras[domain].join(" "));
  }
}
$("plan").addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (
    Math.hypot(event.clientX - drag.screen[0], event.clientY - drag.screen[1]) <
      3 &&
    !drag.moved
  )
    return;
  drag.moved = true;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    drag.inverse,
  );
  drag.delta = [p.x - drag.start.x, p.y - drag.start.y];
  if (drag.frame === null) drag.frame = requestAnimationFrame(paintDrag);
});
function finishDrag(event, cancel = false) {
  if (
    !drag ||
    (event.pointerId !== undefined && event.pointerId !== drag.pointerId)
  )
    return;
  const saved = drag;
  cancelAnimationFrame(saved.frame);
  drag = null;
  $("plan").classList.remove("dragging");
  if ($("plan").hasPointerCapture(saved.pointerId))
    $("plan").releasePointerCapture(saved.pointerId);
  if (cancel) {
    planCameras[domain] = saved.camera;
    render();
    return;
  }
  if (saved.id && saved.moved) {
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      saved.inverse,
    );
    const grid = domain === "house" ? 25.4 : 1;
    const snap = (v) =>
      $("snap-plan").checked && !event.altKey ? Math.round(v / grid) * grid : v;
    const next = clone(project()),
      inst = next.instances.find((i) => i.id === saved.id);
    inst.position = [
      saved.position[0] + snap(p.x - saved.start.x),
      saved.position[1] + snap(p.y - saved.start.y),
      saved.position[2],
    ];
    if (inst.position.some((v, i) => v !== saved.position[i])) change(next);
    else render();
  } else if (!saved.id && saved.moved) {
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      saved.inverse,
    );
    planCameras[domain] = [
      saved.camera[0] - p.x + saved.start.x,
      saved.camera[1] - p.y + saved.start.y,
      ...saved.camera.slice(2),
    ];
    render();
  } else render();
}
$("plan").addEventListener("pointerup", (event) => finishDrag(event));
$("plan").addEventListener("pointercancel", (event) => finishDrag(event, true));
$("plan").addEventListener("lostpointercapture", (event) =>
  finishDrag(event, true),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    finishDrag(event, true);
    annotationTool = null;
    arrowStart = null;
  }
});
$("plan").addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (drag) return;
    const svg = $("plan").querySelector("svg");
    if (!svg) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    );
    const [x, y, w, h] = planCameras[domain];
    const scale = Math.exp(Math.max(-0.3, Math.min(0.3, event.deltaY * 0.002)));
    if (w * scale < 1 || w * scale > 1e7) return;
    planCameras[domain] = [
      p.x + (x - p.x) * scale,
      p.y + (y - p.y) * scale,
      w * scale,
      h * scale,
    ];
    svg.setAttribute("viewBox", planCameras[domain].join(" "));
  },
  { passive: false },
);
$("fit-plan").addEventListener("click", () => {
  planCameras[domain] = null;
  render();
});
$("plan").addEventListener("keydown", (e) => {
  const group = e.target.closest("[data-instance]");
  if (!group || busy) return;
  selectedId = group.dataset.instance;
  paletteId = instance().asset_id;
  const amount = domain === "house" ? 25.4 : 1;
  const dirs = {
    ArrowLeft: [-amount, 0],
    ArrowRight: [amount, 0],
    ArrowUp: [0, -amount],
    ArrowDown: [0, amount],
  };
  if (dirs[e.key]) {
    e.preventDefault();
    const next = clone(project()),
      inst = next.instances.find((i) => i.id === selectedId);
    inst.position[0] += dirs[e.key][0];
    inst.position[1] += dirs[e.key][1];
    change(next);
    $("plan").querySelector(`[data-instance="${selectedId}"]`)?.focus();
  } else if (e.key.toLowerCase() === "r") $("rotate").click();
  else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    render();
  }
});
$("plan-panel").addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
$("plan-panel").addEventListener("drop", (e) => {
  e.preventDefault();
  if (busy) return;
  const id = e.dataTransfer.getData("application/x-ose-asset"),
    a =
      project().assets.find((a) => a.id === id) ||
      catalog.find((a) => a.id === id);
  if (!a) return;
  try {
    const next = addInstance(project(), a, planPoint(e));
    selectedId = next.instances.at(-1).id;
    paletteId = a.id;
    candidate = null;
    if (a.draft) lessons[domain] = 4;
    change(next);
  } catch (error) {
    notice(error.message, true);
  }
});
document.querySelectorAll("[data-domain]").forEach((b) =>
  b.addEventListener("click", () => {
    if (busy) return;
    domain = b.dataset.domain;
    candidate = null;
    selectedId =
      (domain === "machines"
        ? project().instances.find(
            (i) =>
              project().assets.find((a) => a.id === i.asset_id)?.source_id ===
              "motor_mount_plate",
          )?.id
        : null) ||
      project().instances[0]?.id ||
      null;
    paletteId = instance()?.asset_id || project().assets[0]?.id;
    document
      .querySelectorAll("[data-domain]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.domain === domain)),
      );
    restoreChat();
    render({ fit: true });
  }),
);
$("lesson-action").addEventListener("click", () => {
  if (
    domain === "machines" &&
    !project().assets.some((a) => a.source_id === "motor_mount_plate")
  ) {
    archivedAxis = clone(project());
    lessons.machines = 0;
    selectedId = null;
    paletteId = null;
    candidate = null;
    change(seedProject("machines", catalog));
    selectLessonTarget();
    view.fit();
    return;
  }
  const s = lessons[domain];
  if (s === 0) selectLessonTarget();
  else if (s === 1) {
    if (asset()?.source_id !== targetSource()) selectLessonTarget();
    $(domain === "house" ? "param-opening_width_in" : "param-width_mm").value =
      domain === "house" ? 30 : 90;
    generate();
  } else if (s === 2) reviewCandidate();
  else if (s === 3) reuseDraft();
  else exportContribution();
});
$("add-note").addEventListener("click", () => {
  annotationTool = "text";
  arrowStart = null;
  notice("Click the plan to place your label.");
});
$("add-arrow").addEventListener("click", () => {
  annotationTool = "arrow";
  arrowStart = null;
  notice("Click the start and end of a diagram arrow. Arrows are annotations.");
});
$("clear-notes").addEventListener("click", () => {
  annotationTool = null;
  arrowStart = null;
  const next = clone(project());
  next.annotations = [];
  change(next);
});
$("parameter-form").addEventListener("submit", (e) => {
  e.preventDefault();
  generate();
});
$("review-candidate").addEventListener("click", reviewCandidate);
$("close-review").addEventListener("click", () => $("review-dialog").close());
$("ack-review").addEventListener("click", () => {
  reviewed = true;
  $("review-dialog").close();
  $("save-draft").disabled = false;
  notice("Checks acknowledged. Name and save your draft when ready.");
});
$("save-draft").addEventListener("click", saveDraft);
$("export-contribution").addEventListener("click", exportContribution);
$("tab-3d").addEventListener("click", () => setView(false));
$("tab-plan").addEventListener("click", () => setView(true));
$("place-selected").addEventListener("click", () => {
  if (busy || !asset()) return;
  const c = planCameras[domain];
  const next = addInstance(project(), asset(), [
    c[0] + c[2] / 2,
    c[1] + c[3] / 2,
    0,
  ]);
  selectedId = next.instances.at(-1).id;
  candidate = null;
  change(next);
  setView(true);
});
$("fit-view").addEventListener("click", () => view.fit());
$("rotate").addEventListener("click", () => {
  if (!instance()) return;
  const next = clone(project());
  next.instances.find((i) => i.id === selectedId).rotation[2] =
    (instance().rotation[2] + 90) % 360;
  candidate = null;
  change(next);
});
$("remove").addEventListener("click", () => {
  const next = clone(project());
  next.instances = next.instances.filter((i) => i.id !== selectedId);
  selectedId = null;
  candidate = null;
  change(next);
});
$("undo").addEventListener("click", () => {
  if (!histories[domain].length) return;
  futures[domain].push(project());
  projects[domain] = histories[domain].pop();
  candidate = null;
  selectedId = null;
  paletteId = null;
  reconcileLesson();
  remember();
  render();
});
$("redo").addEventListener("click", () => {
  if (!futures[domain].length) return;
  histories[domain].push(project());
  projects[domain] = futures[domain].pop();
  candidate = null;
  selectedId = null;
  paletteId = null;
  reconcileLesson();
  remember();
  render();
});
$("project-goal").addEventListener("change", () => {
  const next = clone(project());
  next.goal = $("project-goal").value.trim();
  change(next);
});
$("reset-lesson").addEventListener("click", () => {
  const next = seedProject(domain, catalog);
  lessons[domain] = 0;
  candidate = null;
  selectedId = null;
  paletteId = null;
  change(next);
  view.fit();
  conversations[domain] = [];
  restoreChat();
  remember();
  planCameras[domain] = null;
  render();
  notice("Starter design restored. Undo restores the previous composition.");
});
$("save-project").addEventListener("click", () =>
  download(
    JSON.stringify(project()),
    "ose-" + domain + "-studio.json",
    "application/json",
  ),
);
$("open-project").addEventListener("click", () => $("project-file").click());
$("project-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 25000000)
      throw new Error("Choose a project smaller than 25 MB.");
    const next = validateProject(JSON.parse(await file.text()));
    domain = next.domain;
    selectedId = null;
    paletteId = null;
    candidate = null;
    // A portable project's progress follows its actual saved contribution.
    lessons[domain] = next.assets.some((a) => a.draft)
      ? next.instances.some(
          (i) => next.assets.find((a) => a.id === i.asset_id)?.draft,
        )
        ? 4
        : 3
      : 0;
    change(next);
    document
      .querySelectorAll("[data-domain]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.domain === domain)),
      );
    view.fit();
    notice("Opened the project with its saved geometry and source records.");
  } catch (error) {
    notice("Could not open project: " + error.message, true);
  }
});
$("export-svg").addEventListener("click", () =>
  download(
    compositionSvg(project()),
    "ose-" + domain + "-composition.svg",
    "image/svg+xml",
  ),
);
$("export-cad").addEventListener("click", exportCad);
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("chat-input").value.trim();
  if (!text) return;
  $("chat-input").value = "";
  askTutor(text);
});
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("chat-form").requestSubmit();
  }
});

async function init() {
  try {
    const response = await fetch("data/studio/catalog.json");
    if (!response.ok)
      throw new Error(
        "The demo catalog is missing. Run the documented studio bake step.",
      );
    const data = await response.json();
    catalog = data.assets.map(validateAsset);
    for (const d of ["house", "machines"]) {
      projects[d] = seedProject(d, catalog);
      histories[d] = [];
      futures[d] = [];
    }
    try {
      const saved = await loadSession();
      if (saved) {
        archivedAxis = saved.archivedAxis || null;
        for (const d of ["house", "machines"]) {
          if (saved.projects?.[d])
            projects[d] = validateProject(saved.projects[d]);
          const n = saved.lessons?.[d];
          lessons[d] = Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0;
          if (lessons[d] === 2) lessons[d] = 1;
          if (Array.isArray(saved.conversations?.[d]))
            conversations[d] = saved.conversations[d]
              .filter(
                (m) =>
                  m &&
                  ["user", "assistant"].includes(m.role) &&
                  typeof m.content === "string" &&
                  m.content.length <= 1200,
              )
              .slice(-20);
        }
      }
    } catch {
      notice(
        "Saved browser data could not be restored. The starter lessons are available.",
        true,
      );
    }
    if (
      !projects.machines.assets.some((a) => a.source_id === "motor_mount_plate")
    ) {
      archivedAxis = clone(projects.machines);
      projects.machines = seedProject("machines", catalog);
      lessons.machines = 0;
      conversations.machines = [];
      remember();
    }
    const requested = new URLSearchParams(location.search).get("lesson");
    if (["house", "machines"].includes(requested)) domain = requested;
    document
      .querySelectorAll("[data-domain]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.domain === domain)),
      );
    selectedId =
      (domain === "machines"
        ? project().instances.find(
            (i) =>
              project().assets.find((a) => a.id === i.asset_id)?.source_id ===
              "motor_mount_plate",
          )?.id
        : null) || project().instances[0]?.id;
    paletteId = instance()?.asset_id;
    try {
      view = createStudioView($("viewport"), selectInstance, applyPlacement);
      comparisonView = createStudioView($("comparison-viewport"), () => {});
    } catch {
      setView(true);
      $("tab-3d").disabled = true;
      notice(
        "3D is unavailable in this browser. The composition plan and exports still work.",
        true,
      );
      view = { render() {}, select() {}, fit() {}, compare() {}, resize() {} };
    }
    $("render-status").hidden = true;
    render({ fit: true });
    try {
      const deployment = await (await fetch("deployment.json")).json();
      if (deployment.backend === "same-origin")
        service = await jsonFetch("/api/studio/status");
    } catch {}
    $("hosting-note").hidden = service.generation && service.tutor;
    if (service.generation && !service.tutor) {
      $("hosting-note").querySelector("strong").textContent = "Guided mode";
      $("hosting-note").querySelector("span").textContent =
        "CAD generation is connected. Guided explanations work; configure a model to enable the AI tutor.";
    } else if (service.tutor && !service.generation) {
      $("hosting-note").querySelector("strong").textContent =
        "CAD preview mode";
      $("hosting-note").querySelector("span").textContent =
        "The AI tutor is connected. Explore and resize previews; connect FreeCAD to generate new CAD geometry.";
    }
    $("tutor-mode").textContent = service.tutor
      ? "Local AI connected"
      : "Guided lesson · AI not connected";
    renderInspector();
    renderLesson();
    restoreChat();
    if (!conversations[domain].length)
      addChat(
        "Pick a lesson and start with one component. I’ll help you understand the source, make a supported change, and leave a reusable contribution.",
      );
  } catch (error) {
    $("render-status").textContent = error.message;
    notice(error.message, true);
  }
}
init();
