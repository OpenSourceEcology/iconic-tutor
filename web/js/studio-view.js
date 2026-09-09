import * as THREE from "three";
import { platePreview, mountSpec } from "./mount-preview.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createStudioView(element, onSelect, onTransform = null) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f1f4e9");
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100000);
  camera.up.set(0, 0, 1);
  camera.position.set(1, -1, 0.85);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  element.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fae89, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.3);
  light.position.set(2000, -3000, 5000);
  scene.add(light);
  const root = new THREE.Group();
  scene.add(root);
  const guides = new THREE.Group();
  scene.add(guides);
  const grid = new THREE.GridHelper(1000, 20, 0xc8d1b9, 0xdce2d2);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  let highlight = null,
    selected = null,
    comparing = false;
  let mountExploded = false,
    mountProject = false;
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let down = null,
    gesture = null,
    suppressPick = false;
  const transform = onTransform
    ? new TransformControls(camera, renderer.domElement)
    : null;
  let transformMode = "orbit";
  if (transform) {
    scene.add(transform.getHelper());
    transform.setSpace("world");
    transform.setSize(0.85);
    transform.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
    });
    transform.addEventListener("mouseDown", () => {
      gesture = {
        id: selected,
        position: transform.object.position.toArray(),
        rotation: transform.object.rotation
          .toArray()
          .slice(0, 3)
          .map(THREE.MathUtils.radToDeg),
      };
      suppressPick = true;
    });
    transform.addEventListener("objectChange", () => highlight?.update());
    transform.addEventListener("mouseUp", () => {
      if (!gesture || !transform.object) return;
      const before = gesture;
      const placement = {
        position: transform.object.position.toArray(),
        rotation: transform.object.rotation
          .toArray()
          .slice(0, 3)
          .map(THREE.MathUtils.radToDeg),
      };
      gesture = null;
      queueMicrotask(() => {
        if (
          [...placement.position, ...placement.rotation].some(
            (v, i) =>
              Math.abs(v - [...before.position, ...before.rotation][i]) > 1e-8,
          )
        )
          onTransform(before.id, placement);
      });
    });
    renderer.domElement.addEventListener("pointercancel", cancelTransform);
    window.addEventListener("blur", cancelTransform);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancelTransform();
    });
  }
  function cancelTransform() {
    if (!gesture) return;
    transform.reset();
    gesture = null;
    transform.dragging = false;
    transform.axis = null;
    controls.enabled = true;
  }
  function setTransformMode(mode) {
    cancelTransform();
    if (mode !== "orbit") setExploded(false);
    transformMode = mode;
    if (!transform) return;
    transform.detach();
    if (mode !== "orbit") transform.setMode(mode);
    select(selected);
  }
  function focusSelected() {
    const object = root.children.find(
      (n) => n.userData.instanceId === selected,
    );
    fit(object || root);
  }

  function resize() {
    const { width, height } = element.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  new ResizeObserver(resize).observe(element);
  function tick() {
    requestAnimationFrame(tick);
    if (element.hidden || !element.clientWidth) return;
    controls.update();
    renderer.render(scene, camera);
  }
  tick();
  function clear() {
    cancelTransform();
    transform?.detach();
    root.traverse((n) => {
      if (n.isMesh) {
        n.geometry.dispose();
        n.material.dispose();
      }
    });
    root.clear();
    clearGuides();
    if (highlight) {
      scene.remove(highlight);
      highlight.dispose();
      highlight = null;
    }
  }
  function meshAsset(asset, instanceId) {
    const group = new THREE.Group();
    for (const part of asset.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(part.mesh.vertices, 3),
      );
      g.setIndex(part.mesh.indices);
      g.computeVertexNormals();
      const sheathing = part.id.toLowerCase().includes("osb");
      const material = new THREE.MeshStandardMaterial({
        color: part.color,
        roughness: 0.82,
        flatShading: true,
        metalness: asset.domain === "machines" ? 0.28 : 0,
        transparent: sheathing,
        opacity: sheathing ? 0.32 : 1,
        depthWrite: !sheathing,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, material);
      mesh.userData.instanceId = instanceId;
      group.add(mesh);
    }
    group.userData.instanceId = instanceId;
    return group;
  }
  function fit(object = root) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vf = THREE.MathUtils.degToRad(camera.fov),
      hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect),
      distance = Math.max(
        (sphere.radius / Math.sin(Math.min(vf, hf) / 2)) * 1.1,
        5,
      );
    const direction = new THREE.Vector3(1, -1, 0.82).normalize();
    camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
    controls.target.copy(sphere.center);
    camera.near = Math.max(distance / 10000, 0.001);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    grid.scale.setScalar(Math.max(sphere.radius * 3, 10) / 1000);
    grid.position.set(sphere.center.x, sphere.center.y, box.min.z - 0.1);
    controls.update();
    resize();
  }
  function select(id) {
    selected = id;
    transform?.detach();
    if (highlight) {
      scene.remove(highlight);
      highlight.dispose();
      highlight = null;
    }
    const object = root.children.find((n) => n.userData.instanceId === id);
    if (object && !comparing) {
      highlight = new THREE.BoxHelper(object, 0x769344);
      scene.add(highlight);
      if (transform && transformMode !== "orbit") transform.attach(object);
    }
  }
  function render(project, id, { fitView = false } = {}) {
    comparing = false;
    clear();
    for (const inst of project.instances) {
      const asset = project.assets.find((a) => a.id === inst.asset_id),
        group = meshAsset(asset, inst.id);
      group.userData.sourceId = asset.source_id;
      group.userData.basePosition = [...inst.position];
      group.position.fromArray(inst.position);
      group.rotation.set(
        ...inst.rotation.map((v) => THREE.MathUtils.degToRad(v)),
        "ZYX",
      );
      root.add(group);
    }
    mountProject = project.assets.some(
      (a) => a.source_id === "motor_mount_plate",
    );
    applyExploded();
    select(id);
    element.dataset.previewState = project.instances.length ? "ready" : "empty";
    element.dataset.renderedInstances = String(project.instances.length);
    resize();
    if (fitView) {
      fit();
      if (mountProject) cameraPreset("assembly");
    }
  }
  function clearGuides() {
    guides.traverse((n) => {
      if (n.isLine) {
        n.geometry.dispose();
        n.material.dispose();
      }
    });
    guides.clear();
  }
  function applyExploded() {
    clearGuides();
    if (mountProject && mountExploded) {
      const lines = [];
      for (const [x, y] of [
        [15.5, 15.5],
        [15.5, -15.5],
        [-15.5, 15.5],
        [-15.5, -15.5],
        [38, 23],
        [38, -23],
        [-38, 23],
        [-38, -23],
      ])
        lines.push(x, y, 0, x, y, 28);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(lines, 3),
      );
      const guide = new THREE.LineSegments(
        geometry,
        new THREE.LineDashedMaterial({
          color: 0x647d96,
          dashSize: 2,
          gapSize: 1,
          transparent: true,
          opacity: 0.7,
        }),
      );
      guide.computeLineDistances();
      guides.add(guide);
    }
    for (const group of root.children) {
      if (group.userData.basePosition)
        group.position.fromArray(group.userData.basePosition);
      if (
        mountProject &&
        mountExploded &&
        group.userData.sourceId === "motor_mount_plate"
      )
        group.position.z += 28;
    }
    highlight?.update();
    element.dataset.exploded = String(mountExploded && mountProject);
  }
  function setExploded(value) {
    cancelTransform();
    mountExploded = value;
    if (value && transform) {
      transformMode = "orbit";
      transform.detach();
    }
    applyExploded();
  }
  function cameraPreset(preset) {
    if (preset === "top") {
      camera.position.set(0, -0.001, 210);
      controls.target.set(0, 0, 0);
    } else {
      camera.position.set(105, -130, 120);
      controls.target.set(0, 0, -9);
    }
    camera.near = 0.01;
    camera.far = 10000;
    camera.updateProjectionMatrix();
    controls.update();
    resize();
  }
  function previewPlate(parameters) {
    const group = root.children.find(
      (g) => g.userData.sourceId === "motor_mount_plate",
    );
    if (!group) return;
    group.traverse((n) => {
      if (n.isMesh) {
        n.geometry.dispose();
        n.material.dispose();
      }
    });
    group.clear();
    group.add(platePreview(parameters, group.userData.instanceId));
    highlight?.update();
    element.dataset.livePlateWidth = String(parameters.width_mm);
    element.dataset.previewState = "proposal";
  }
  function compare(original, candidate) {
    comparing = true;
    clear();
    const w = Math.max(
      original.bounds[3] - original.bounds[0],
      candidate.bounds[3] - candidate.bounds[0],
    );
    for (const [i, a] of [original, candidate].entries()) {
      const group = meshAsset(a, null);
      group.position.set(
        -a.bounds[0] + i * w * 1.4,
        -a.bounds[1],
        -a.bounds[2],
      );
      root.add(group);
    }
    element.dataset.previewState = "comparison";
    fit();
  }
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (!gesture) suppressPick = false;
    down = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (
      suppressPick ||
      comparing ||
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(root.children, true)[0];
    if (hit?.object.userData.instanceId)
      onSelect(hit.object.userData.instanceId);
    down = null;
  });
  return {
    render,
    compare,
    fit,
    select,
    resize,
    setTransformMode,
    focusSelected,
    previewPlate,
    setExploded,
    cameraPreset,
  };
}
