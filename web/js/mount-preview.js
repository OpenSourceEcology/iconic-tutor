import * as THREE from "three";
export const mountSpec = await (
  await fetch(new URL("../data/studio/motor-mount.json", import.meta.url))
).json();
export function mountHoleCenters(parameters) {
  const edge = mountSpec.plate.frame_hole_edge_offset_mm;
  return [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => [
      x * (parameters.width_mm / 2 - edge),
      y * (parameters.height_mm / 2 - edge),
    ]),
  );
}
export function mountAlignment(parameters) {
  const x = parameters.width_mm / 2 - mountSpec.plate.frame_hole_edge_offset_mm;
  const y =
    parameters.height_mm / 2 - mountSpec.plate.frame_hole_edge_offset_mm;
  return Math.hypot(
    x - mountSpec.fixture.rail_center_spacing_mm / 2,
    y - mountSpec.fixture.rail_hole_pitch_mm / 2,
  );
}
export function platePreview(parameters, instanceId) {
  const { width_mm: w, height_mm: h, thickness_mm: t } = parameters;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.closePath();
  const hole = (x, y, r) => {
    const path = new THREE.Path();
    path.absarc(x, y, r, 0, Math.PI * 2, true);
    shape.holes.push(path);
  };
  hole(0, 0, mountSpec.plate.boss_clearance_hole_mm / 2);
  const pitch = mountSpec.motor.bolt_pitch_mm / 2;
  for (const x of [-pitch, pitch])
    for (const y of [-pitch, pitch])
      hole(x, y, mountSpec.plate.motor_clearance_hole_mm / 2);
  for (const [x, y] of mountHoleCenters(parameters))
    hole(x, y, mountSpec.plate.frame_clearance_hole_mm / 2);
  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: t,
      bevelEnabled: false,
      curveSegments: 48,
    }),
    new THREE.MeshStandardMaterial({
      color: "#e3aa45",
      roughness: 0.68,
      metalness: 0.22,
    }),
  );
  mesh.userData.instanceId = instanceId;
  return mesh;
}
