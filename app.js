import {ComputeClient, layerKeys} from './compute-client.js';
import { PAL, HEAT_RES, MU0, LENGTH_UNIT_M, WIRE_RADIUS, LOOP_WIRE_RADIUS, evalWire, buildBentWirePath, SCENES, EARTH_R, buildField, SECTION, computeSectionBasis, sampleModel, runPhysicsValidation, runGeometryValidation } from './field-core.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const _tmp = new THREE.Vector3(), _b = new THREE.Vector3(), _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _bt = new THREE.Vector3();

/* ==================== 箭头（稀疏、精巧） ==================== */
function collectArrowSpecs(lines, options = {}) {
  const specs = [];
  for (const pts of lines) {
    const n = pts.length;
    if (n < 8) continue;
    const defaults = n > 130 ? [0.24, 0.62] : [0.36];
    const fracs = (options.fractions || defaults).slice(0, options.maxPerLine || 2);
    for (const f of fracs) {
      const i = Math.floor(n * f);
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const tan = new THREE.Vector3().subVectors(pts[i1], pts[i0]);
      if (tan.lengthSq() < 1e-10) continue;
      const scale = options.scaleAt ? options.scaleAt(pts[i]) : 1;
      specs.push({ pos: pts[i], dir: tan.normalize(), scale });
    }
  }
  return specs;
}

function makeArrowMesh(specs, color, scale = 1) {
  if (!specs.length) return null;
  const geom = new THREE.ConeGeometry(0.06 * scale, 0.18 * scale, 10);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.InstancedMesh(geom, mat, specs.length);
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  specs.forEach((s, i) => {
    dummy.position.copy(s.pos);
    dummy.quaternion.setFromUnitVectors(up, s.dir);
    dummy.scale.setScalar(s.scale || 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function fieldArrowOptions(sceneId, params) {
  if (sceneId !== 'loop') return {};
  const radius = params.radius;
  return {
    maxPerLine: 1,
    fractions: [0.34],
    scaleAt: (point) => {
      const distance = Math.hypot(Math.hypot(point.x, point.z) - radius, point.y);
      return 0.52 + 0.48 * Math.min(1, distance / Math.max(0.45, radius * 0.42));
    },
  };
}

function makeWideLine(points, color = PAL.line, width = 2.3, dashed = false) {
  const positions = [];
  for (const point of points) positions.push(point.x, point.y, point.z);
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color,
    linewidth: width,
    dashed,
    dashSize: dashed ? 0.16 : 1,
    gapSize: dashed ? 0.11 : 0,
    depthTest: true,
    transparent: true,
    opacity: dashed ? 0.88 : 0.96,
  });
  const container = document.getElementById('canvas-container');
  material.resolution.set(container?.clientWidth || 1, container?.clientHeight || 1);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.userData.wideLine = true;
  return line;
}

function updateWideLineResolutions() {
  const container = document.getElementById('canvas-container');
  if (!container) return;
  scene?.traverse((object) => {
    if (object.userData?.wideLine && object.material?.resolution) {
      object.material.resolution.set(container.clientWidth, container.clientHeight);
    }
  });
}

/* ==================== 热力图 ==================== */
function fieldDisplayUnit(valueMicrotesla) {
  const a = Math.abs(valueMicrotesla);
  if (a >= 1e6) return { scale: 1e-6, unit: 'T', digits: 3 };
  if (a >= 1000) return { scale: 1e-3, unit: 'mT', digits: 2 };
  return { scale: 1, unit: 'μT', digits: a >= 100 ? 1 : 2 };
}

function formatFieldValue(valueMicrotesla) {
  if (!Number.isFinite(valueMicrotesla)) return '--';
  const d = fieldDisplayUnit(valueMicrotesla);
  return `${(valueMicrotesla * d.scale).toFixed(d.digits)} ${d.unit}`;
}

function makeHeatMap(data, sec, size) {
  const canvas = document.createElement('canvas');
  canvas.width = data.resolution; canvas.height = data.resolution;
  canvas.getContext('2d').putImageData(new ImageData(data.pixels, data.resolution, data.resolution), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const geom = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({map:tex, transparent:true, opacity:.54, side:THREE.DoubleSide, depthWrite:false});
  const mesh = new THREE.Mesh(geom, mat);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(sec.U, sec.V, sec.n).setPosition(sec.center);
  mesh.renderOrder = 1;
  return mesh;
}

/* ==================== 场源三维模型 ==================== */
function makeLabel(parent, text, pos, color, scale = 0.5) {
  const c = document.createElement('canvas');
  const ctx2 = c.getContext('2d');
  const font = 'bold 46px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx2.font = font;
  const w = Math.ceil(ctx2.measureText(text).width) + 26;
  c.width = w; c.height = 66;
  const cx = c.getContext('2d');
  cx.font = font;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.lineWidth = 6; cx.strokeStyle = 'rgba(255,255,255,0.9)';
  cx.strokeText(text, w / 2, 34);
  cx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  cx.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.position.copy(pos);
  sp.scale.set((w / 66) * scale, scale, 1);
  sp.renderOrder = 10;
  parent.add(sp);
  return sp;
}

function addWorldAxisTriad(parent) {
  const origin = new THREE.Vector3(-5.4, -4.52, -4.8);
  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xb9424a, label: 'X' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x2f8f4e, label: 'Y' },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x2367a3, label: 'Z' },
  ];
  for (const axis of axes) {
    const arrow = new THREE.ArrowHelper(axis.dir, origin, 1.0, axis.color, 0.22, 0.12);
    parent.add(arrow);
    makeLabel(parent, axis.label, origin.clone().addScaledVector(axis.dir, 1.28), axis.color, 0.30);
  }
}

function addCurrentCone(group, pos, dir, r = 0.18, h = 0.46, shaft = 0.85) {
  const d = dir.clone().normalize();
  const mat = new THREE.MeshBasicMaterial({ color: PAL.currentArrow });
  // 加粗杆身：从 pos 沿 dir 伸出 shaft 长
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, shaft, 10), mat);
  rod.position.copy(pos).addScaledVector(d, shaft / 2);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  group.add(rod);
  // 大锥尖：基座在 pos+shaft，尖端沿 dir 延伸 h —— 尖端清晰可见
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 16), mat);
  cone.position.copy(pos).addScaledVector(d, shaft + h / 2);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  group.add(cone);
}

function magnetMat(color) {
  return new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.58, shininess: 30, depthWrite: false });
}

function addCylinderSegment(group, a, b, material, radius = 0.06) {
  const direction = b.clone().sub(a);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  group.add(mesh);
  return mesh;
}

function createSources(sceneId, P) {
  const g = new THREE.Group();
  const iron = new THREE.MeshPhongMaterial({ color: 0xaeb8c0, transparent: true, opacity: 0.6, shininess: 40, depthWrite: false });
  switch (sceneId) {
    case 'earth': {
      const Re = EARTH_R, t = (P.tilt * Math.PI) / 180;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(Re, 48, 32),
        new THREE.MeshPhongMaterial({ color: PAL.earth, transparent: true, opacity: 0.42, shininess: 18, depthWrite: false }));
      earth.renderOrder = 2;
      g.add(earth);
      const mHat = new THREE.Vector3(Math.sin(t), -Math.cos(t), 0);
      // 地理轴（灰）与磁轴（酒红）
      const geo = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, Re * 2 + 2.4, 8), new THREE.MeshBasicMaterial({ color: PAL.geoAxis }));
      g.add(geo);
      const mag = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, Re * 2 + 1.6, 8), new THREE.MeshBasicMaterial({ color: PAL.magAxis }));
      mag.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mHat);
      g.add(mag);
      // 极点标记
      const mN = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: PAL.N }));
      mN.position.copy(mHat).multiplyScalar(Re); g.add(mN);
      const mS = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: PAL.S }));
      mS.position.copy(mHat).multiplyScalar(-Re); g.add(mS);
      // 清晰的中文标注
      makeLabel(g, '地理北极', new THREE.Vector3(-2.0, Re + 0.88, 0), 0x66727c, 0.52);
      makeLabel(g, '地理南极', new THREE.Vector3(-2.0, -Re - 0.88, 0), 0x66727c, 0.52);
      makeLabel(g, '地磁N极', mHat.clone().multiplyScalar(Re + 0.98).add(new THREE.Vector3(2.05, -0.18, 0)), PAL.N, 0.54);
      makeLabel(g, '地磁S极', mHat.clone().multiplyScalar(-Re - 0.98).add(new THREE.Vector3(2.05, 0.18, 0)), PAL.S, 0.54);
      break;
    }
    case 'bar-magnet': {
      const L = P.length, hw = 0.38;
      const Nh = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, L / 2, hw * 2), magnetMat(PAL.N));
      Nh.position.y = L / 4; Nh.renderOrder = 2; g.add(Nh);
      const Sh = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, L / 2, hw * 2), magnetMat(PAL.S));
      Sh.position.y = -L / 4; Sh.renderOrder = 2; g.add(Sh);
      makeLabel(g, 'N', new THREE.Vector3(0.75, L / 2 + 0.3, 0), PAL.N, 0.55);
      makeLabel(g, 'S', new THREE.Vector3(0.75, -L / 2 - 0.3, 0), PAL.S, 0.55);
      break;
    }
    case 'bent-wire': {
      const points = buildBentWirePath(P.width, P.height);
      const visibleMat = new THREE.MeshPhongMaterial({ color: PAL.wire, shininess: 62 });
      const returnMat = new THREE.MeshPhongMaterial({ color: 0x7c8992, transparent: true, opacity: 0.34, shininess: 20, depthWrite: false });
      for (let i = 0; i < 3; i++) addCylinderSegment(g, points[i], points[i + 1], visibleMat, 0.065);
      for (let i = 3; i < points.length - 1; i++) addCylinderSegment(g, points[i], points[i + 1], returnMat, 0.042);
      const sign = P.direction === '左侧向下' ? -1 : 1;
      for (const index of [0, 1, 2]) {
        const a = points[index], b = points[index + 1];
        const dir = b.clone().sub(a).normalize().multiplyScalar(sign);
        const mid = a.clone().lerp(b, 0.5).addScaledVector(dir, -0.42);
        addCurrentCone(g, mid, dir, 0.13, 0.32, 0.55);
      }
      const returnDir = points[5].clone().sub(points[4]).normalize().multiplyScalar(sign);
      addCurrentCone(g, points[4].clone().lerp(points[5], 0.5).addScaledVector(returnDir, -0.35), returnDir, 0.10, 0.25, 0.42);
      makeLabel(g, 'I', new THREE.Vector3(-P.width / 2 - 0.42, 0.6, 0), PAL.current, 0.48);
      makeLabel(g, '远置回流线', new THREE.Vector3(0, -P.height / 2 - 0.48, points[4].z), 0x66727c, 0.38);
      break;
    }
    case 'straight-wire': {
      const currentSign = P.direction.includes('向下') ? -1 : 1;
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10, 14),
        new THREE.MeshPhongMaterial({ color: PAL.wire, shininess: 60 }));
      g.add(wire);
      for (const yy of [-2.6, 0, 2.6]) addCurrentCone(g, new THREE.Vector3(0, yy, 0), new THREE.Vector3(0, currentSign, 0));
      makeLabel(g, 'I', new THREE.Vector3(0.42, 4.4, 0), PAL.current, 0.5);
      break;
    }
    case 'two-wires': {
      const d = P.spacing;
      const showLeft = P.display !== '仅右导线';
      const showRight = P.display !== '仅左导线';
      const dir2 = P.direction === '反向' ? -1 : 1;
      for (let i = 0; i < 2; i++) {
        if (i === 0 && !showLeft) continue;
        if (i === 1 && !showRight) continue;
        const px = (i === 0 ? -1 : 1) * d / 2;
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 8, 14),
          new THREE.MeshPhongMaterial({ color: PAL.wire, shininess: 60 }));
        wire.position.x = px; g.add(wire);
        const s = i === 0 ? 1 : dir2;
        const markerLevels = VEC_MODE ? [0] : [-2.4, 0, 2.4];
        for (const yy of markerLevels) {
          addCurrentCone(g, new THREE.Vector3(px, yy, 0), new THREE.Vector3(0, s, 0));
        }
        makeLabel(g, i === 0 ? 'I₁' : 'I₂', new THREE.Vector3(px + 0.42, 3.8, 0), PAL.current, 0.5);
      }
      if (showLeft && showRight) {
        const origin = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), new THREE.MeshBasicMaterial({ color: 0x2c3840 }));
        g.add(origin);
        makeLabel(g, 'O', new THREE.Vector3(0.28, 0.30, 0), 0x2c3840, 0.34);
      }
      break;
    }
    case 'loop': {
      const R = P.radius;
      const currentSign = P.direction === '反向' ? -1 : 1;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, LOOP_WIRE_RADIUS, 14, 72),
        new THREE.MeshPhongMaterial({ color: PAL.wire, shininess: 50 }));
      ring.rotation.x = Math.PI / 2; g.add(ring);
      // 电流方向箭头直接画在导线上（切向），按半径自适应缩放避免重叠
      const sLoop = Math.min(0.65, R / 3);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 8;
        const pos = new THREE.Vector3(R * Math.cos(a), 0, R * Math.sin(a));
        const tan = new THREE.Vector3(-Math.sin(a) * currentSign, 0, Math.cos(a) * currentSign);
        addCurrentCone(g, pos, tan, 0.13 * sLoop, 0.32 * sLoop, 0.55 * sLoop);
      }
      makeLabel(g, 'I', new THREE.Vector3(R * 0.72, 0, R * 0.72).add(new THREE.Vector3(0.3, 0.3, 0)), PAL.current, 0.5);
      makeLabel(g, 'N', new THREE.Vector3(0.48, -currentSign * R * 0.92, 0), PAL.N, 0.50);
      makeLabel(g, 'S', new THREE.Vector3(0.48, currentSign * R * 0.92, 0), PAL.S, 0.50);
      break;
    }
    case 'solenoid': {
      const R = P.radius, L = P.length, N = P.nLoops;
      const currentSign = P.direction.startsWith('反向') ? -1 : 1;
      // 按实际匝密度抽样绘制，保证投影可读且不让圆管互相穿透成色块。
      const drawnTurns = Math.min(N, Math.max(24, Math.floor(L / 0.14)));
      const pitch = L / drawnTurns;
      const wireRadius = Math.max(0.007, Math.min(0.022, pitch * 0.26));
      const pts = [];
      const SEG = Math.min(Math.max(Math.round(drawnTurns * 12), 480), 2400);
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const th = -currentSign * t * drawnTurns * Math.PI * 2;
        pts.push(new THREE.Vector3(R * Math.cos(th), -L / 2 + t * L, R * Math.sin(th)));
      }
      const helix = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), SEG, wireRadius, 8, false),
        new THREE.MeshPhongMaterial({ color: PAL.wire, shininess: 45, transparent: true, opacity: 0.52, depthWrite: false })
      );
      helix.renderOrder = 2;
      g.add(helix);
      // 电流方向箭头（沿螺旋切向），按尺寸自适应缩放
      const sSol = Math.min(1, R / 1.5, L / 4);
      for (const tt of [0.18, 0.5, 0.82]) {
        const th = -currentSign * tt * drawnTurns * Math.PI * 2;
        const pos = new THREE.Vector3(R * Math.cos(th), -L / 2 + tt * L, R * Math.sin(th));
        const dth = -currentSign * drawnTurns * Math.PI * 2;
        const tan = new THREE.Vector3(-R * Math.sin(th) * dth, L, R * Math.cos(th) * dth);
        addCurrentCone(g, pos, tan, 0.18 * sSol, 0.46 * sSol, 0.85 * sSol);
      }
      const nY = currentSign * L / 2;
      const sY = -nY;
      makeLabel(g, 'N', new THREE.Vector3(0.38, nY + currentSign * 0.52, 0), PAL.N, 0.54);
      makeLabel(g, 'S', new THREE.Vector3(0.38, sY - currentSign * 0.52, 0), PAL.S, 0.54);
      break;
    }
  }
  return g;
}

/* ==================== Three.js 场景 ==================== */
let renderer, scene, camera, controls;
let fieldGroup, arrowGroup, heatGroup, sourceGroup, helperGroup, sectionLineGroup, pickerGroup, vecGroup;
let raycaster, mouse;
let VEC_MODE = false;          // 双导线矢量合成演示开关
let vecLastMove = 0;           // pointermove 节流时间戳
let savedVecCam = null;        // 开启矢量演示前的相机状态（关闭时恢复）
let savedVecOnly = false;      // 开启矢量演示前的"仅截面"状态
let savedVecHeat = false;      // 开启矢量演示前的热力图状态

function initThree() {
  const container = document.getElementById('canvas-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.bg);
  camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(10, 5.5, 13);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  container.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8de, 1.0));
  const dir = new THREE.DirectionalLight(0xffffff, 0.75);
  dir.position.set(5, 10, 7);
  scene.add(dir);
  fieldGroup = new THREE.Group();
  arrowGroup = new THREE.Group();
  heatGroup = new THREE.Group();
  sourceGroup = new THREE.Group();
  helperGroup = new THREE.Group();
  sectionLineGroup = new THREE.Group();
  pickerGroup = new THREE.Group();
  vecGroup = new THREE.Group();
  scene.add(fieldGroup, arrowGroup, heatGroup, sourceGroup, helperGroup, sectionLineGroup, pickerGroup, vecGroup);
  const grid = new THREE.GridHelper(26, 26, PAL.gridMain, PAL.grid);
  grid.position.y = -4.6;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  helperGroup.add(grid);
  addWorldAxisTriad(helperGroup);
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('click', onCanvasClick);
  renderer.domElement.addEventListener('pointermove', onCanvasMove);
}

function onResize() {
  const c = document.getElementById('canvas-container');
  if (!c.clientWidth) return;
  camera.aspect = c.clientWidth / c.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(c.clientWidth, c.clientHeight);
  updateWideLineResolutions();
}

function onCanvasClick(e) {
  if (computationBusy || computationError) return;
  if (!currentField || !currentScene) return;
  if (STATE.locked) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const sec = computeSectionBasis();
  let point = null;
  // 点击统一取「射线与截面平面的交点」：箭头始终落在鼠标点击的截面位置，
  // 且 B=0 的场点（如双导线同向电流中点）能如实显示为零
  const hits = raycaster.intersectObjects(heatGroup.children, true);
  if (hits.length > 0) point = hits[0].point;
  // 兜底：与截面平面求交（热力图关闭或预测模式时）
  if (!point) {
    const plane = new THREE.Plane(sec.n.clone(), -sec.n.dot(sec.center));
    const hp = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hp)) point = hp;
  }
  if (point) {
    if (currentField.quantitativeMask?.(point.x, point.y, point.z)) {
      clearGroup(pickerGroup);
      document.getElementById('sample-readout').textContent = '此点位于理想磁体材料界面，请选界面内侧或外侧位置作定量比较。';
      return;
    }
    if (['loop', 'solenoid', 'bent-wire'].includes(currentScene.id) && currentField.heatMask?.(point.x, point.y, point.z)) {
      clearGroup(pickerGroup);
      document.getElementById('sample-readout').textContent = '此点位于导线近场正则化区域，暂不作定量读数；请选导线外部位置。';
      return;
    }
    currentField.evalB(point.x, point.y, point.z, _b);
    const B = _b.clone();
    showPickerArrow(point, B);
    updateSampleReadout(point, B);
  }
}

/* 点击采样：在指定点沿磁场方向显示方向箭头（亮橙，始终可见） */
function showPickerArrow(pos, B) {
  clearGroup(pickerGroup);
  const d = B.clone().normalize();
  if (d.lengthSq() < 1e-12) return;
  const mat = new THREE.MeshBasicMaterial({ color: PAL.picker, depthTest: false });
  // 采样点标记球
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mat);
  dot.position.copy(pos);
  pickerGroup.add(dot);
  // 杆 + 锥尖（总长约 1.05，轻巧不遮挡磁感线）
  const shaft = 0.62, r = 0.13, h = 0.33;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, shaft, 10), mat);
  rod.position.copy(pos).addScaledVector(d, 0.1 + shaft / 2);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  pickerGroup.add(rod);
  const head = new THREE.Mesh(new THREE.ConeGeometry(r, h, 16), mat);
  head.position.copy(pos).addScaledVector(d, 0.1 + shaft + h / 2);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  pickerGroup.add(head);
  pickerGroup.traverse((o) => { if (o.isMesh) o.renderOrder = 25; });
}

/* ==================== 双导线矢量合成演示 ==================== */
const VEC_COLORS = { b1: 0x2367a3, b2: 0x2f9e44, bt: 0xd13d3d };

function onCanvasMove(e) {
  if (!VEC_MODE || !currentField || !currentScene || currentScene.id !== 'two-wires') return;
  if (STATE.locked || computationBusy || computationError) return; // 预测/更新时不显示旧答案
  if (e.buttons) return;             // 拖拽旋转视图时跳过
  const now = performance.now();
  if (now - vecLastMove < 50) return; // 节流 50ms
  vecLastMove = now;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const sec = computeSectionBasis();
  const plane = new THREE.Plane(sec.n.clone(), -sec.n.dot(sec.center));
  const hp = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hp)) return;
  const f = currentField, d = f.d, dir2 = f.dir2;
  evalWire(hp.x, hp.y, hp.z, -d / 2, 0, 0, 0, 1, 0, f.I1, _b1);     // 左导线贡献 B₁
  evalWire(hp.x, hp.y, hp.z, d / 2, 0, 0, 0, 1, 0, f.I2 * dir2, _b2); // 右导线贡献 B₂
  _bt.copy(_b1).add(_b2);                                          // 合成 B = B₁ + B₂
  showVectorArrows(hp, _b1, _b2, _bt);
  updateVectorReadout(hp, _b1, _b2, _bt);
}

/* 在 P 点演示平行四边形定则：B₁（蓝）、B₂（绿）为邻边，对角线 = 合成 B（红）
   关键：三个箭头用同一缩放系数，长度严格成比例（|B| = |B₁+B₂| 几何真实），
   两虚线边使平行四边形完整闭合——这才是教科书式的平行四边形定则。 */
function showVectorArrows(p, b1, b2, bt) {
  clearGroup(vecGroup);
  const m1 = b1.length(), m2 = b2.length(), mt = bt.length();
  if (m1 < 1e-9 || m2 < 1e-9) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x2c3840, depthTest: false }));
    dot.position.copy(p);
    vecGroup.add(dot);
    vecGroup.traverse((o) => { if (o.isMesh || o.isLine) o.renderOrder = 24; });
    return;
  }
  // 统一缩放：长度严格正比于 |B|，整体不超过可视范围
  const maxLen = Math.max(m1, m2, mt);
  const scale = Math.min(0.34, 2.6 / maxLen);
  const d1 = b1.clone().multiplyScalar(1 / m1);
  const d2 = b2.clone().multiplyScalar(1 / m2);
  const L1 = m1 * scale, L2 = m2 * scale;
  const tip1 = p.clone().addScaledVector(d1, L1);   // P+B₁
  const tip2 = p.clone().addScaledVector(d2, L2);   // P+B₂
  const tipT = p.clone().addScaledVector(d1, L1).addScaledVector(d2, L2); // P+B₁+B₂
  const makeArrow = (from, dir, len, color, rodR) => {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(rodR, rodR, len * 0.62, 8), mat);
    rod.position.copy(from).addScaledVector(dir, len * 0.31);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    vecGroup.add(rod);
    const head = new THREE.Mesh(new THREE.ConeGeometry(rodR * 2.8, len * 0.38, 12), mat);
    head.position.copy(from).addScaledVector(dir, len * 0.81);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    vecGroup.add(head);
  };
  // 两邻边：B₁（蓝）、B₂（绿）实线箭头，均从 P 出发
  makeArrow(p, d1, L1, VEC_COLORS.b1, 0.05);
  makeArrow(p, d2, L2, VEC_COLORS.b2, 0.05);
  // 两条虚线边：P+B₁→P+B₁+B₂（∥B₂）、P+B₂→P+B₁+B₂（∥B₁）→ 平行四边形闭合
  const matD = new THREE.LineBasicMaterial({ color: 0x8a97a1, transparent: true, opacity: 0.8, depthTest: false });
  const seg = (a, b) => {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    vecGroup.add(new THREE.Line(g, matD));
  };
  seg(tip1, tipT);
  seg(tip2, tipT);
  // 对角线：合成 B（红）；合场为零时保留两条反向分量，不画零长度箭头
  if (mt > 1e-9) makeArrow(p, tipT.clone().sub(p).normalize(), mt * scale, VEC_COLORS.bt, 0.06);
  // 三个顶点标记
  const mkDot = (pos, color) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false }));
    d.position.copy(pos);
    vecGroup.add(d);
  };
  mkDot(p, 0x2c3840); mkDot(tip1, 0x2367a3); mkDot(tip2, 0x2f9e44); mkDot(tipT, 0xd13d3d);
  vecGroup.traverse((o) => { if (o.isMesh || o.isLine) o.renderOrder = 24; });
}

function updateVectorReadout(p, b1, b2, bt) {
  const el = document.getElementById('sample-readout');
  if (el) {
    el.innerHTML = `
      <div style="color:#2367a3;font-weight:700">B₁ = (${b1.x.toFixed(2)}, ${b1.y.toFixed(2)}, ${b1.z.toFixed(2)}) μT</div>
      <div style="color:#2f9e44;font-weight:700">B₂ = (${b2.x.toFixed(2)}, ${b2.y.toFixed(2)}, ${b2.z.toFixed(2)}) μT</div>
      <div style="color:#d13d3d;font-weight:700">B = B₁+B₂ = (${bt.x.toFixed(2)}, ${bt.y.toFixed(2)}, ${bt.z.toFixed(2)}) μT</div>
      <div style="margin-top:3px">P(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})</div>`;
  }
}

/* ==================== 状态与重建 ==================== */
let currentScene = null;
let currentField = null;
let currentParams = {};
let currentStats = { closed: 0, expectedOpen: 0, total: 0, maxB: 0, quality: null };
let physicsValidationReport = null;
let updateTimer = null;
const STATE = { mode: 'student', locked: true };

const computation = new ComputeClient();
const installed = {model:null, field:null, heat:null, section:null};
let updateVersion = 0, computationBusy = false, computationError = false;
let pendingPaint = null;
let pendingScenePaint = null;
let interactionStart = 0, firstFeedbackMs = null, pendingFeedback = false;
const computeCounts = {field:0, heat:0, section:0};

function clearGroup(grp) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  grp.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  grp.clear();
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function currentKeys() { return layerKeys(currentScene.id, currentParams, SECTION, currentScene.size); }
function wantsLines() { return document.getElementById('t-fl')?.checked !== false; }
function setComputeState(state, message = '') {
  computationBusy = state === 'loading' || state === 'scheduled';
  computationError = state === 'error';
  document.body.dataset.renderStatus = state;
  document.querySelector('.canvas-card').setAttribute('aria-busy', String(computationBusy));
  document.getElementById('compute-status').textContent = STATE.locked ? '' : message;
  if (computationBusy && firstFeedbackMs === null) pendingFeedback = true;
  const pill = document.getElementById('status-pill');
  if (pill && !STATE.locked) pill.textContent = computationBusy ? '正在生成磁场' : computationError ? '生成失败 · 可重试' : '模型显示中';
  const button = document.getElementById('btn-prediction');
  if (button) {
    button.disabled = computationBusy && !STATE.locked;
    button.textContent = computationError ? '重试生成磁场' : STATE.locked ? '揭示磁场分布' : computationBusy ? '正在生成磁场…' : '进入预测模式';
  }
}
function unpack(lines) {
  return lines.map(data => {
    const points = [];
    for (let i=0; i<data.length; i+=3) points.push(new THREE.Vector3(data[i],data[i+1],data[i+2]));
    return points;
  });
}
function installResult(result, keys, section, size) {
  if (result.field) {
    clearGroup(fieldGroup); clearGroup(arrowGroup);
    const gen = result.field, lines = unpack(gen.lines);
    for (let i=0; i<lines.length; i++) fieldGroup.add(makeWideLine(lines[i],PAL.line,gen.closedFlags[i] ? 2.25 : 2, !gen.closedFlags[i]));
    const specs = collectArrowSpecs(lines,fieldArrowOptions(currentScene.id,currentParams));
    const arrows = makeArrowMesh(specs,PAL.line,1);
    if (arrows) arrowGroup.add(arrows);
    Object.assign(currentStats,{closed:gen.closed,expectedOpen:gen.expectedOpen,total:gen.total,quality:gen.quality});
    document.body.dataset.traceStats = JSON.stringify(gen.traceStats);
    document.body.dataset.lineQuality = JSON.stringify(gen.quality);
    document.body.dataset.fieldArrows = String(specs.length);
    installed.field = keys.field;
  }
  if (result.heat) {
    clearGroup(heatGroup);
    const sec = computeSectionBasis(section);
    heatGroup.add(makeHeatMap(result.heat,sec,size));
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v]) => sec.center.clone().addScaledVector(sec.U,u*size/2).addScaledVector(sec.V,v*size/2));
    heatGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners),new THREE.LineBasicMaterial({color:PAL.frame})));
    currentStats.maxB = result.heat.scaleB;
    document.getElementById('heat-max').textContent = formatFieldValue(result.heat.scaleB);
    installed.heat = keys.heat;
  }
  if (result.section) {
    clearGroup(sectionLineGroup);
    const lines = unpack(result.section.lines);
    for (const points of lines) sectionLineGroup.add(makeWideLine(points,PAL.line,2.45));
    const arrows = makeArrowMesh(collectArrowSpecs(lines,fieldArrowOptions(currentScene.id,currentParams)),PAL.line,.85);
    if (arrows) sectionLineGroup.add(arrows);
    document.body.dataset.sectionLines = String(lines.length);
    installed.section = keys.section;
  }
}

async function updateVisualization(started = performance.now()) {
  if (!currentScene) return;
  if (interactionStart !== started) { interactionStart = started; firstFeedbackMs = null; pendingFeedback = false; }
  clearTimeout(updateTimer); updateTimer = null;
  const version = ++updateVersion;
  delete document.body.dataset.lastRender;
  computation.cancel(); pendingPaint = null;
  const keys = currentKeys(), section = {...SECTION}, size = currentScene.size;
  clearGroup(pickerGroup); clearGroup(vecGroup);
  if (installed.model !== keys.model) {
    currentField = buildField(currentScene.id,currentParams);
    clearGroup(sourceGroup);
    sourceGroup.add(createSources(currentScene.id,currentParams));
    installed.model = keys.model;
    currentStats = {closed:0,expectedOpen:0,total:0,maxB:0,quality:null};
  }
  if (STATE.locked) {
    setComputeState('hidden'); applyVisibility(); updateConsole();
    return;
  }
  const kinds = [];
  if (wantsLines()) {
    const kind = section.only ? 'section' : 'field';
    if (installed[kind] !== keys[kind]) kinds.push(kind);
  }
  if (section.show && installed.heat !== keys.heat) kinds.push('heat');
  try {
    if (kinds.length) {
      setComputeState('loading','正在生成磁场，可继续旋转或切换场景…');
      applyVisibility(); updateConsole();
      const result = await computation.run({sceneId:currentScene.id,params:{...currentParams},section,size,kinds});
      if (version !== updateVersion || STATE.locked) return;
      installResult(result,keys,section,size);
      kinds.forEach(kind => computeCounts[kind]++);
      pendingPaint = {version,started,cacheHit:false,source:result.source,computeMs:result.computeMs,kinds};
    } else pendingPaint = {version,started,cacheHit:true,computeMs:0,kinds};
    setComputeState('ready'); applyVisibility(); updateConsole();
  } catch (error) {
    if (version !== updateVersion || error.name === 'AbortError') return;
    setComputeState('error','磁场生成失败，请点击左侧按钮重试。');
    document.body.dataset.computeError = error.message;
    applyVisibility(); updateConsole();
  }
}

function applyVisibility() {
  const show = !STATE.locked;
  const keys = currentScene ? currentKeys() : {};
  const chk = (id) => { const el = document.getElementById(id); return !el || el.checked; };
  fieldGroup.visible = show && installed.field === keys.field && !SECTION.only && chk('t-fl');
  arrowGroup.visible = show && installed.field === keys.field && !SECTION.only && chk('t-fl') && chk('t-ar');
  heatGroup.visible = show && installed.heat === keys.heat && SECTION.show;
  sectionLineGroup.visible = show && installed.section === keys.section && SECTION.only && chk('t-fl');
  sourceGroup.visible = chk('t-src');
  helperGroup.visible = chk('t-grid');
  const heatLegend = document.querySelector('.heat-legend');
  if (heatLegend) heatLegend.style.display = heatGroup.visible ? 'flex' : 'none';
  const fieldLabel = document.getElementById('legend-field-label');
  if (fieldLabel) fieldLabel.textContent = SECTION.only ? '截面投影流线' : '磁感线';
  const separatrix = document.getElementById('legend-separatrix');
  if (separatrix) {
    const showSeparatrix = currentScene?.id === 'two-wires'
      && currentParams.direction === '反向'
      && Math.abs(currentParams.current1 - currentParams.current2) < 1e-9
      && currentParams.display === '合磁场'
      && !SECTION.only;
    separatrix.style.display = showSeparatrix ? 'flex' : 'none';
  }
}

function updateLegend(sceneId) {
  const currentScenes = new Set(['bent-wire', 'straight-wire', 'two-wires', 'loop', 'solenoid']);
  const poleScenes = new Set(['earth', 'bar-magnet', 'loop', 'solenoid']);
  const currentItem = document.getElementById('legend-current');
  const northItem = document.getElementById('legend-n');
  const southItem = document.getElementById('legend-s');
  const returnItem = document.getElementById('legend-return');
  if (currentItem) currentItem.style.display = currentScenes.has(sceneId) ? 'flex' : 'none';
  if (northItem) northItem.style.display = poleScenes.has(sceneId) ? 'flex' : 'none';
  if (southItem) southItem.style.display = poleScenes.has(sceneId) ? 'flex' : 'none';
  if (returnItem) returnItem.style.display = sceneId === 'bent-wire' ? 'flex' : 'none';
}

function scheduleUpdate() {
  const started = performance.now();
  interactionStart = started; firstFeedbackMs = null; pendingFeedback = false;
  clearTimeout(updateTimer);
  ++updateVersion; computation.cancel(); pendingPaint = null;
  delete document.body.dataset.lastRender;
  clearGroup(pickerGroup); clearGroup(vecGroup);
  document.getElementById('m-sample').textContent = '--';
  setComputeState(STATE.locked ? 'hidden' : 'scheduled', '正在更新磁场…');
  applyVisibility();
  updateTimer = setTimeout(() => updateVisualization(started),150);
}

function loadScene(sceneId) {
  const def = SCENES.find((s) => s.id === sceneId);
  if (!def) return;
  const sceneStarted = performance.now();
  delete document.body.dataset.sceneRender;
  // 若矢量合成演示还开着，先恢复相机与截面状态，避免影响新场景
  if (VEC_MODE) {
    VEC_MODE = false;
    clearGroup(vecGroup);
    if (savedVecCam) {
      camera.up.copy(savedVecCam.up);
      camera.position.copy(savedVecCam.pos);
      controls.target.copy(savedVecCam.target);
    }
    SECTION.only = savedVecOnly;
    SECTION.show = savedVecHeat;
  }
  clearTimeout(updateTimer); updateTimer = null;
  ++updateVersion; computation.cancel(); pendingPaint = null;
  for (const group of [fieldGroup,arrowGroup,heatGroup,sectionLineGroup]) clearGroup(group);
  installed.field = installed.heat = installed.section = null;
  currentScene = def;
  currentParams = {};
  def.params.forEach((p) => { currentParams[p.id] = p.val; });
  Object.assign(SECTION, def.section, { show: SECTION.show, only: false });
  document.getElementById('scene-title').textContent = def.name;
  document.getElementById('scene-lead').textContent = def.lead;
  updateLegend(def.id);
  buildLeftPanel(def);
  buildRightPanel(def);
  STATE.locked = STATE.mode === 'student';
  syncModeUI();
  updateVisualization();
  if (def.camera) {
    camera.position.set(...def.camera.pos);
    controls.target.set(...def.camera.target);
    controls.update();
  }
  pendingScenePaint = {sceneId, started:sceneStarted};
}

/* ==================== 左侧面板 ==================== */
function formatParamValue(param, value) {
  const scaled = value * (param.displayScale || 1);
  const rounded = param.type === 'int' ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded}${param.unit || ''}`;
}

function syncTwoWireControls() {
  if (currentScene?.id !== 'two-wires') return;
  const single = currentParams.display !== '合磁场';
  const direction = document.getElementById('param-direction');
  if (direction) {
    direction.disabled = single;
    direction.closest('.range-control')?.classList.toggle('control-disabled', single);
  }
  const vectorToggle = document.getElementById('t-vec');
  if (vectorToggle) {
    if (single && vectorToggle.checked) {
      vectorToggle.checked = false;
      vectorToggle.dispatchEvent(new Event('change'));
    }
    vectorToggle.disabled = single;
    vectorToggle.closest('.switch-row')?.classList.toggle('control-disabled', single);
  }
}

function buildLeftPanel(def) {
  const panel = document.getElementById('left-panel');
  panel.innerHTML = '';

  // 场景
  const secScene = document.createElement('section');
  secScene.innerHTML = '<h2>场景</h2>';
  const list = document.createElement('div');
  list.className = 'segmented';
  list.setAttribute('role', 'tablist');
  for (const s of SCENES) {
    const b = document.createElement('button');
    b.className = 'segment' + (s.id === def.id ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.textContent = s.name;
    b.onclick = () => loadScene(s.id);
    list.appendChild(b);
  }
  secScene.appendChild(list);
  const classroomMap = document.createElement('a');
  classroomMap.className = 'secondary-action classroom-map-link';
  classroomMap.href = './classroom-map.html';
  classroomMap.target = '_blank';
  classroomMap.rel = 'noopener';
  classroomMap.innerHTML = '<span>教室磁场图</span><span aria-hidden="true">↗</span>';
  secScene.appendChild(classroomMap);
  panel.appendChild(secScene);

  // 课堂模式
  const secMode = document.createElement('section');
  secMode.innerHTML = '<h2>课堂模式</h2>';
  const btn = document.createElement('button');
  btn.className = 'primary-action';
  btn.id = 'btn-prediction';
  btn.textContent = '揭示磁场分布';
  btn.onclick = () => {
    const started = performance.now();
    if (!computationError) STATE.locked = !STATE.locked;
    syncModeUI();
    updateVisualization(started);
  };
  secMode.appendChild(btn);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '预测模式隐藏磁感线与热力图，先让学生画图判断，再点击按钮揭示。';
  secMode.appendChild(hint);
  panel.appendChild(secMode);

  // 参数
  const secParam = document.createElement('section');
  secParam.innerHTML = '<h2>参数</h2>';
  for (const p of def.params) {
    if (p.type === 'select') {
      const row = document.createElement('label');
      row.className = 'range-control';
      row.innerHTML = `<span>${p.label}</span>
        <select id="param-${p.id}">${p.options.map((o) => `<option ${o === p.val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      secParam.appendChild(row);
      row.querySelector('select').onchange = (e) => {
        currentParams[p.id] = e.target.value;
        syncTwoWireControls();
        scheduleUpdate();
      };
    } else {
      const row = document.createElement('label');
      row.className = 'range-control';
      row.innerHTML = `<span>${p.label} <strong id="val-${p.id}">${formatParamValue(p, p.val)}</strong></span>
        <input type="range" id="param-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}">`;
      secParam.appendChild(row);
      const inp = row.querySelector('input');
      const valEl = row.querySelector('#val-' + p.id);
      inp.oninput = () => {
        const v = p.type === 'int' ? parseInt(inp.value) : parseFloat(inp.value);
        currentParams[p.id] = v;
        valEl.textContent = formatParamValue(p, v);
        scheduleUpdate();
      };
    }
  }
  panel.appendChild(secParam);

  // 显示内容
  const secDisp = document.createElement('section');
  secDisp.innerHTML = '<h2>显示内容</h2>';
  const toggles = [
    { id: 't-fl', label: '磁感线', checked: true, fn: () => updateVisualization() },
    { id: 't-ar', label: '方向箭头', checked: true, fn: () => applyVisibility() },
    { id: 't-hm', label: '截面热力图', checked: SECTION.show, fn: () => { SECTION.show = document.getElementById('t-hm').checked; scheduleUpdate(); } },
    { id: 't-src', label: '场源物体', checked: true, fn: () => applyVisibility() },
    { id: 't-grid', label: '参考网格', checked: true, fn: () => applyVisibility() },
  ];
  for (const t of toggles) {
    const lab = document.createElement('label');
    lab.className = 'switch-row';
    lab.innerHTML = `<input type="checkbox" id="${t.id}" ${t.checked ? 'checked' : ''}><span>${t.label}</span>`;
    lab.querySelector('input').onchange = t.fn;
    secDisp.appendChild(lab);
  }
  panel.appendChild(secDisp);

  // 矢量合成演示（仅双导线场景）
  if (def.id === 'two-wires') {
    const secVec = document.createElement('section');
    secVec.innerHTML = '<h2>矢量合成演示</h2>';
    const lab = document.createElement('label');
    lab.className = 'switch-row';
    lab.innerHTML = `<input type="checkbox" id="t-vec" ${VEC_MODE ? 'checked' : ''}><span>开启：平行四边形定则（B = B₁ + B₂）</span>`;
    lab.querySelector('input').onchange = (e) => {
      VEC_MODE = e.target.checked;
      if (VEC_MODE) {
        // 自动切到「正对导线截面」视角：导线投影成两个点，
        // 磁场矢量完全落在屏幕平面内，平行四边形无透视变形，教科书式呈现
        if (savedVecCam) {
          savedVecCam.pos = camera.position.clone();
          savedVecCam.target = controls.target.clone();
          savedVecCam.up = camera.up.clone();
        } else {
          savedVecCam = { pos: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone() };
        }
        savedVecOnly = SECTION.only;
        savedVecHeat = SECTION.show; // 隐藏热力图：半透明色块会与箭头混色淹没矢量
        camera.up.set(0, 0, -1);
        camera.position.set(0, 13.5, 0.01);
        controls.target.set(0, 0, 0);
        controls.update();
        SECTION.only = true;   // 只显示截面磁感线，避免 3D 线重叠投影
        SECTION.show = false;  // 关闭热力图
        const onlyBox = document.getElementById('t-only');
        if (onlyBox) { onlyBox.checked = true; }
        const hmBox = document.getElementById('t-hm');
        if (hmBox) { hmBox.checked = false; }
        updateVisualization();
        renderer.domElement.style.cursor = 'crosshair';
        const rd = document.getElementById('sample-readout');
        if (rd) rd.innerHTML = '移动鼠标到画布任意位置 → 实时演示平行四边形定则';
      } else {
        clearGroup(vecGroup);
        renderer.domElement.style.cursor = '';
        if (savedVecCam) {
          camera.up.copy(savedVecCam.up);
          camera.position.copy(savedVecCam.pos);
          controls.target.copy(savedVecCam.target);
          controls.update();
        }
        SECTION.only = savedVecOnly;
        SECTION.show = savedVecHeat;
        const onlyBox = document.getElementById('t-only');
        if (onlyBox) { onlyBox.checked = savedVecOnly; }
        const hmBox = document.getElementById('t-hm');
        if (hmBox) { hmBox.checked = savedVecHeat; }
        updateVisualization();
      }
    };
    secVec.appendChild(lab);
    const h = document.createElement('p');
    h.className = 'hint';
    h.textContent = '开启后自动对准导线截面视角（从 +Y 俯视）。鼠标在画布上移动：以 B₁（蓝）、B₂（绿）为邻边作平行四边形，对角线即合成磁场 B（红）。磁场恒在与导线垂直的截面平面内。';
    secVec.appendChild(h);
    panel.appendChild(secVec);
  }

  // 截面分析
  const secCut = document.createElement('section');
  secCut.innerHTML = '<h2>截面分析</h2>';
  const segDiv = document.createElement('div');
  segDiv.className = 'mini-seg';
  for (const [ax, lab] of [['x', 'X 法向'], ['y', 'Y 法向'], ['z', 'Z 法向']]) {
    const b = document.createElement('button');
    b.textContent = lab;
    b.dataset.ax = ax;
    b.className = SECTION.n === ax ? 'active' : '';
    b.onclick = () => {
      SECTION.n = ax;
      segDiv.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.ax === ax));
      scheduleUpdate();
    };
    segDiv.appendChild(b);
  }
  secCut.appendChild(segDiv);

  const mkSlider = (label, id, min, max, step, val, fn) => {
    const row = document.createElement('label');
    row.className = 'range-control';
    row.innerHTML = `<span>${label} <strong id="val-${id}">${val}</strong></span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">`;
    secCut.appendChild(row);
    const inp = row.querySelector('input');
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      row.querySelector('#val-' + id).textContent = Math.round(v * 10) / 10;
      fn(v);
      scheduleUpdate();
    };
  };
  const lim = Math.round(def.size / 2 + 1);
  mkSlider('截面位置', 'sec-off', -lim, lim, 0.2, SECTION.off, (v) => { SECTION.off = v; });
  mkSlider('截面旋转', 'sec-rot', -90, 90, 5, SECTION.rot, (v) => { SECTION.rot = v; });

  const onlyLab = document.createElement('label');
  onlyLab.className = 'switch-row';
  onlyLab.innerHTML = `<input type="checkbox" id="t-only" ${SECTION.only ? 'checked' : ''}><span>仅显示截面投影流线</span>`;
  onlyLab.querySelector('input').onchange = (e) => {
    SECTION.only = e.target.checked;
    applyVisibility();
    scheduleUpdate();
  };
  secCut.appendChild(onlyLab);
  const projectionHint = document.createElement('p');
  projectionHint.className = 'hint';
  projectionHint.textContent = '投影流线沿 B∥ = B − (B·n)n 积分；当截面是场的对称面时，它与真实磁感线重合。';
  secCut.appendChild(projectionHint);

  const btnFace = document.createElement('button');
  btnFace.className = 'secondary-action';
  btnFace.textContent = '正视截面';
  btnFace.onclick = () => {
    const sec = computeSectionBasis();
    const dist = Math.max(currentScene.size * 1.15, 8);
    camera.position.copy(sec.center).addScaledVector(sec.n, dist);
    controls.target.copy(sec.center);
    controls.update();
  };
  secCut.appendChild(btnFace);
  panel.appendChild(secCut);
  syncTwoWireControls();
}

/* ==================== 右侧面板 ==================== */
function buildRightPanel(def) {
  const panel = document.getElementById('right-panel');
  panel.innerHTML = `
    <section>
      <div class="ai-title"><span class="ai-dot"></span><h2>模型与课堂提示</h2></div>
      <p class="ai-summary">${def.ai}</p>
    </section>
    <section>
      <h2>观察要点</h2>
      <ul class="check-list">${def.observations.map((o) => `<li>${o}</li>`).join('')}</ul>
    </section>
    <section>
      <h2>模型自检</h2>
      <ul class="check-list">${def.selfCheck.map((s) => `<li>${s}</li>`).join('')}</ul>
    </section>
    <section>
      <div class="solver-heading"><h2>模型诊断</h2><span class="console-chip">PHYSICS</span></div>
      <div class="solver-console">
        <div class="console-topline"><span><span class="live-dot"></span>FIELD MODEL</span><span class="console-chip">READY</span></div>
        <div class="metric-grid">
          <div class="metric-cell"><div class="metric-label">网格分辨率</div><div class="metric-value">${HEAT_RES}×${HEAT_RES}</div></div>
          <div class="metric-cell"><div class="metric-label">求解方式</div><div class="metric-value">${def.solver}</div></div>
          <div class="metric-cell"><div class="metric-label" id="m-lines-label">磁感线数量</div><div class="metric-value" id="m-lines">--</div></div>
          <div class="metric-cell"><div class="metric-label">几何闭合</div><div class="metric-value" id="m-closed">--</div></div>
          <div class="metric-cell"><div class="metric-label">轨迹质量</div><div class="metric-value" id="m-quality">--</div></div>
          <div class="metric-cell"><div class="metric-label">截面 P98 |B|</div><div class="metric-value" id="m-maxb">--</div></div>
          <div class="metric-cell"><div class="metric-label">采样点 |B|</div><div class="metric-value" id="m-sample">--</div></div>
          <div class="metric-cell"><div class="metric-label">物理关键点</div><div class="metric-value" id="m-physics">--</div></div>
        </div>
        <div class="console-block">
          <div class="console-block-title">本场景模型</div>
          <div class="formula-stack">
            <div class="formula-line">${def.formula}</div>
            <div class="formula-line"><code id="m-val">${def.valueLine(currentParams)}</code></div>
          </div>
          <div class="status-line" id="m-status">等待几何检查</div>
        </div>
      </div>
    </section>`;
}

function updateConsole() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const keys = currentScene ? currentKeys() : {};
  const sectionCount = installed.section === keys.section ? Number(document.body.dataset.sectionLines || 0) : 0;
  const fieldValid = installed.field === keys.field;
  set('m-lines-label', SECTION.only ? '截面投影流线数量' : '磁感线数量');
  set('m-lines', STATE.locked ? '已隐藏' : `${SECTION.only ? sectionCount : fieldValid ? currentStats.total : 0}`);
  const geometryText = currentStats.expectedOpen
    ? `${currentStats.closed}闭合 + ${currentStats.expectedOpen}边界延伸`
    : `${currentStats.closed}/${currentStats.total}`;
  set('m-closed', STATE.locked ? '已隐藏' : SECTION.only ? '截面投影' : fieldValid ? geometryText : '--');
  set('m-quality', STATE.locked ? '已隐藏' : SECTION.only ? '面内场积分' : (fieldValid && currentStats.quality
    ? `${currentStats.quality.passed}/${currentStats.quality.total} 通过`
    : '--'));
  set('m-maxb', STATE.locked ? '已隐藏' : (SECTION.show && installed.heat === keys.heat && currentStats.maxB ? formatFieldValue(currentStats.maxB) : '--'));
  set('m-physics', STATE.locked ? '已隐藏' : (physicsValidationReport ? `${physicsValidationReport.passed}/${physicsValidationReport.total}` : '--'));
  const vl = document.getElementById('m-val');
  if (vl && currentScene) vl.textContent = currentScene.valueLine(currentParams);
  const status = document.getElementById('m-status');
  if (status) {
    if (STATE.locked) status.textContent = '预测模式 · 数值诊断已隐藏';
    else if (computationBusy) status.textContent = '正在生成磁场…';
    else if (computationError) status.textContent = '生成失败，请重试';
    else if (SECTION.only) status.textContent = sectionCount ? `截面投影流线已生成 · ${sectionCount} 条` : '当前截面无可显示的面内流线';
    else if (!currentStats.total) status.textContent = '未生成可验证的磁感线';
    else if (currentStats.closed + currentStats.expectedOpen === currentStats.total) {
      const suffix = currentStats.expectedOpen ? `，${currentStats.expectedOpen} 条延伸到视窗边界` : '';
      status.textContent = `轨迹几何与场方向检查通过 · ${currentStats.closed} 条闭合${suffix}`;
    } else status.textContent = `轨迹检查未通过 · ${currentStats.closed}/${currentStats.total}`;
  }
}

function updateSampleReadout(pos, B) {
  const el = document.getElementById('sample-readout');
  const m = B.length();
  const display = fieldDisplayUnit(m);
  const component = (v) => (v * display.scale).toFixed(display.digits);
  const ux = m > 1e-9 ? (B.x / m).toFixed(2) : '0.00';
  const uy = m > 1e-9 ? (B.y / m).toFixed(2) : '0.00';
  const uz = m > 1e-9 ? (B.z / m).toFixed(2) : '0.00';
  if (el) {
    const coord = (value) => (Math.abs(value) < 0.0005 ? '0.00' : value.toFixed(2));
    el.innerHTML = `
      <div>P(${coord(pos.x)}, ${coord(pos.y)}, ${coord(pos.z)}) · 1单位=10 cm</div>
      <strong>|B| = ${formatFieldValue(m)}</strong>
      <div>B = (${component(B.x)}, ${component(B.y)}, ${component(B.z)}) ${display.unit}</div>
      <div>${m > 1e-9 ? `方向 → (${ux}, ${uy}, ${uz})` : '方向未定义（零场）'}</div>`;
  }
  const mm = document.getElementById('m-sample');
  if (mm) mm.textContent = formatFieldValue(m);
}

function syncModeUI() {
  document.querySelector('.canvas-card').dataset.locked = String(STATE.locked);
  const expanded = Boolean(document.fullscreenElement || document.querySelector('.canvas-card').classList.contains('is-expanded'));
  document.getElementById('btn-fullscreen').title = expanded ? '退出全屏' : '全屏';
  const btn = document.getElementById('btn-prediction');
  if (btn) btn.textContent = STATE.locked ? '揭示磁场分布' : '进入预测模式';
  const pill = document.getElementById('status-pill');
  if (pill) {
    pill.textContent = STATE.locked ? '预测模式 · 场已隐藏' : '模型显示中';
    pill.style.color = STATE.locked ? '#48111b' : '';
    pill.style.background = STATE.locked ? '#f3e8eb' : '';
    pill.style.borderColor = STATE.locked ? '#ead2d8' : '';
  }
  const lock = document.getElementById('pred-lock');
  if (lock) {
    lock.innerHTML = STATE.locked
      ? `<strong>预测模式</strong><br>先让学生画出磁感线的分布<br>${expanded ? '退出全屏后点击左侧' : '再点击左侧'}「揭示磁场分布」`
      : '';
    lock.classList.toggle('show', STATE.locked);
  }
  if (STATE.locked) {
    clearGroup(pickerGroup); clearGroup(vecGroup);
    document.getElementById('m-sample').textContent = '--';
    const readout = document.getElementById('sample-readout');
    if (readout) readout.textContent = '预测模式：先判断磁场方向，再揭示模型';
  } else if (!VEC_MODE) {
    const readout = document.getElementById('sample-readout');
    if (readout) readout.textContent = '点击截面任意位置，显示该处磁场大小与方向';
  }
  applyVisibility();
  updateConsole();
}

/* ==================== 动画循环 ==================== */
let fpsLast = performance.now(), fpsFrames = 0;
const qaEnabled = new URLSearchParams(window.location.search).has('qa');
const frameSamples = [], longTasks = [];
let previousFrame = 0, telemetryLast = 0;
if (qaEnabled && typeof PerformanceObserver !== 'undefined') {
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({start:entry.startTime,duration:entry.duration});
      if (longTasks.length > 100) longTasks.splice(0,longTasks.length-100);
    }).observe({type:'longtask',buffered:true});
  } catch { /* Optional measurement API; not required for rendering. */ }
}
function animate() {
  requestAnimationFrame(animate);
  if (qaEnabled) {
    const now=performance.now();
    if(previousFrame && !document.hidden)frameSamples.push({time:now,dt:now-previousFrame});
    previousFrame=now;
    while(frameSamples.length && frameSamples[0].time<now-10000)frameSamples.shift();
    if(now-telemetryLast>=1000){
      telemetryLast=now;
      document.body.dataset.runtimeTelemetry=JSON.stringify({time:now,frames:frameSamples.length,averageFps:frameSamples.length*1000/(frameSamples.reduce((sum,f)=>sum+f.dt,0)||1),maxFrameMs:Math.max(0,...frameSamples.map(f=>f.dt)),over100ms:frameSamples.filter(f=>f.dt>100).length,longTasks,resources:{...renderer.info.memory}});
    }
  }
  controls.update();
  renderer.render(scene, camera);
  if (pendingScenePaint) {
    document.body.dataset.sceneRender = JSON.stringify({...pendingScenePaint,elapsedMs:performance.now()-pendingScenePaint.started,locked:STATE.locked});
    pendingScenePaint = null;
  }
  if (pendingFeedback) {
    firstFeedbackMs = performance.now() - interactionStart;
    document.body.dataset.feedbackMs = String(firstFeedbackMs);
    pendingFeedback = false;
  }
  if (pendingPaint && pendingPaint.version === updateVersion && !STATE.locked) {
    const elapsedMs = performance.now()-pendingPaint.started;
    const metric = {...pendingPaint,elapsedMs,feedbackMs:firstFeedbackMs ?? elapsedMs,sceneId:currentScene.id,params:{...currentParams},heat:SECTION.show,only:SECTION.only,counts:{...computeCounts},resources:{...renderer.info.memory}};
    document.body.dataset.lastRender = JSON.stringify(metric);
    document.body.dataset.computeCounts = JSON.stringify(computeCounts);
    pendingPaint = null;
  }
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast > 1000) {
    document.getElementById('fps').textContent = Math.round((fpsFrames * 1000) / (now - fpsLast)) + ' FPS';
    fpsFrames = 0; fpsLast = now;
  }
}

/* ==================== 初始化 ==================== */
function init() {
  initThree();
  if (qaEnabled) {
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    document.body.dataset.testEnvironment = JSON.stringify({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio:window.devicePixelRatio,viewport:[window.innerWidth,window.innerHeight],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webglVersion:gl.getParameter(gl.VERSION)});
  }
  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.mode-switch button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      STATE.mode = b.dataset.mode;
      STATE.locked = STATE.mode === 'student';
      syncModeUI();
      updateVisualization(); // 同参数切换显隐复用已生成图层。
    };
  });
  document.getElementById('btn-reset').onclick = () => {
    if (currentScene && currentScene.camera) {
      camera.position.set(...currentScene.camera.pos);
      controls.target.set(...currentScene.camera.target);
      controls.update();
    }
  };
  document.getElementById('btn-fullscreen').onclick = async () => {
    const c = document.querySelector('.canvas-card');
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (c.classList.contains('is-expanded')) c.classList.remove('is-expanded');
    else {
      try { await c.requestFullscreen(); }
      catch { c.classList.add('is-expanded'); } // Embedded browsers can deny native fullscreen.
    }
    syncModeUI(); onResize();
  };
  document.addEventListener('keydown', e => {
    const c = document.querySelector('.canvas-card');
    if(e.key === 'Escape' && c.classList.contains('is-expanded')) { c.classList.remove('is-expanded'); syncModeUI(); onResize(); }
  });
  document.addEventListener('fullscreenchange', () => { syncModeUI(); onResize(); });
  window.addEventListener('pagehide', () => computation.dispose());
  loadScene(SCENES[0].id);
  const validation = runPhysicsValidation();
  physicsValidationReport = validation;
  const validationOutput = document.createElement('output');
  validationOutput.id = 'physics-validation';
  validationOutput.hidden = true;
  validationOutput.textContent = JSON.stringify(validation);
  document.body.appendChild(validationOutput);
  document.body.dataset.physicsValidation = `${validation.passed}/${validation.total}`;
  const geometryOutput = document.createElement('output');
  geometryOutput.id = 'geometry-validation';
  geometryOutput.hidden = true;
  geometryOutput.dataset.state = 'idle';
  document.body.appendChild(geometryOutput);
  const runGeometry = () => {
    if (geometryOutput.dataset.state === 'running') return;
    geometryOutput.dataset.state = 'running';
    setTimeout(() => {
      const requestedScene = new URLSearchParams(window.location.search).get('geometryScene');
      const report = runGeometryValidation(requestedScene ? [requestedScene] : undefined);
      geometryOutput.textContent = JSON.stringify(report);
      geometryOutput.dataset.state = 'done';
      document.body.dataset.geometryValidation = `${report.passed}/${report.total}`;
    }, 0);
  };
  if (new URLSearchParams(window.location.search).has('geometryQA')) runGeometry();
  updateConsole();
  animate();
  setTimeout(onResize, 100);
}

window.__MAGNETIC_LAB__ = {
  constants: { MU0, LENGTH_UNIT_M, WIRE_RADIUS, LOOP_WIRE_RADIUS },
  sample: sampleModel,
  scenes: SCENES.map(s => ({id:s.id,params:s.params})),
  validate: runPhysicsValidation,
  validateGeometry: runGeometryValidation,
};

init();
