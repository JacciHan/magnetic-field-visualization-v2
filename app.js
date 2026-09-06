import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ==================== 调色板（参照静电场实验室设计语言） ==================== */
const PAL = {
  bg: 0xfcfdfe,
  grid: 0xdbe2e8,
  gridMain: 0xc2ccd4,
  line: 0x1f617d,
  N: 0xb9424a,
  S: 0x2367a3,
  wire: 0x8a5a33,
  current: 0xd13d3d,
  currentArrow: 0xff4433,   // 电流方向箭头（亮红，更醒目）
  picker: 0xff8c00,         // 点击采样方向箭头（亮橙）
  earth: 0x4f83b0,
  geoAxis: 0x8a97a1,
  magAxis: 0x6b1f2b,
  frame: 0x9aa7b0,
};
const HEAT_RES = 128;
const FL_STEP = 0.04;
const MU0 = 4 * Math.PI * 1e-7;
const LENGTH_UNIT_M = 0.1; // 场景坐标 1 单位 = 10 cm
const TESLA_TO_MICROTESLA = 1e6;
const BIOT_SAVART_SCALE = (MU0 / (4 * Math.PI * LENGTH_UNIT_M)) * TESLA_TO_MICROTESLA;
const MAGNETIC_POLE_SCALE = 1 / (4 * Math.PI);
const WIRE_RADIUS = 0.06;
const LOOP_WIRE_RADIUS = 0.075;
const GAUSS48_NODES = [-0.9987710072524261, -0.9935301722663508, -0.9841245837228269, -0.9705915925462473, -0.9529877031604308, -0.9313866907065543, -0.9058791367155696, -0.8765720202742479, -0.8435882616243935, -0.8070662040294426, -0.7671590325157404, -0.7240341309238146, -0.6778723796326639, -0.6288673967765136, -0.5772247260839727, -0.523160974722233, -0.4669029047509584, -0.4086864819907167, -0.34875588629216075, -0.28736248735545555, -0.22476379039468905, -0.16122235606889174, -0.0970046992094627, -0.03238017096286937, 0.03238017096286937, 0.0970046992094627, 0.16122235606889174, 0.22476379039468905, 0.28736248735545555, 0.34875588629216075, 0.4086864819907167, 0.4669029047509584, 0.523160974722233, 0.5772247260839727, 0.6288673967765136, 0.6778723796326639, 0.7240341309238146, 0.7671590325157404, 0.8070662040294426, 0.8435882616243935, 0.8765720202742479, 0.9058791367155696, 0.9313866907065543, 0.9529877031604308, 0.9705915925462473, 0.9841245837228269, 0.9935301722663508, 0.9987710072524261];
const GAUSS48_WEIGHTS = [0.003153346052309842, 0.0073275539012758505, 0.0114772345792347, 0.015579315722943481, 0.019616160457356105, 0.02357076083932401, 0.027426509708357052, 0.031167227832798117, 0.03477722256477042, 0.03824135106583047, 0.04154508294346453, 0.044674560856694245, 0.04761665849249027, 0.050359035553854216, 0.052890189485193424, 0.05519950369998404, 0.05727729210040288, 0.05911483969839536, 0.06070443916589356, 0.062039423159892415, 0.06311419228625376, 0.06392423858464788, 0.06446616443594981, 0.06473769681268363, 0.06473769681268363, 0.06446616443594981, 0.06392423858464788, 0.06311419228625376, 0.062039423159892415, 0.06070443916589356, 0.05911483969839536, 0.05727729210040288, 0.05519950369998404, 0.052890189485193424, 0.050359035553854216, 0.04761665849249027, 0.044674560856694245, 0.04154508294346453, 0.03824135106583047, 0.03477722256477042, 0.031167227832798117, 0.027426509708357052, 0.02357076083932401, 0.019616160457356105, 0.015579315722943481, 0.0114772345792347, 0.0073275539012758505, 0.003153346052309842];

/* ==================== 标量场计算（无内存分配，保证性能） ==================== */
function evalMonopoles(x, y, z, arr, out) {
  let bx = 0, by = 0, bz = 0;
  for (let i = 0; i < arr.length; i += 4) {
    const dx = x - arr[i], dy = y - arr[i + 1], dz = z - arr[i + 2], q = arr[i + 3];
    const r2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-8);
    const inv = 1 / Math.sqrt(r2);
    const f = MAGNETIC_POLE_SCALE * q * inv * inv * inv;
    bx += f * dx; by += f * dy; bz += f * dz;
  }
  out.set(bx, by, bz);
  return out;
}

// Exact rectangular surface integral. The equivalent pole density is a
// calculation device for a uniformly magnetized cuboid, not a monopole.
function evalRectFace(x, y, z, faceY, halfWidth, density, out) {
  const w = y - faceY;
  let bx = 0, by = 0, bz = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const u = x + (i ? halfWidth : -halfWidth);
    const v = z + (j ? halfWidth : -halfWidth);
    const r = Math.hypot(u, v, w), s = i === j ? 1 : -1;
    bx -= s * Math.log(Math.max(v + r, 1e-15));
    bz -= s * Math.log(Math.max(u + r, 1e-15));
    if (w !== 0) by += s * Math.atan(u * v / (w * r));
  }
  out.x += density * MAGNETIC_POLE_SCALE * bx;
  out.y += density * MAGNETIC_POLE_SCALE * by;
  out.z += density * MAGNETIC_POLE_SCALE * bz;
  return out;
}

function evalDipole(x, y, z, mx, my, mz, out) {
  const r2 = x * x + y * y + z * z;
  if (r2 < 0.09) { out.set(0, 0, 0); return out; }
  const r = Math.sqrt(r2), inv3 = 1 / (r2 * r);
  const nx = x / r, ny = y / r, nz = z / r;
  const md = mx * nx + my * ny + mz * nz;
  const k = 3 * md * inv3;
  out.set(k * nx - mx * inv3, k * ny - my * inv3, k * nz - mz * inv3);
  return out;
}

function evalWire(x, y, z, wx, wy, wz, ux, uy, uz, I, out) {
  const dx = x - wx, dy = y - wy, dz = z - wz;
  const t = dx * ux + dy * uy + dz * uz;
  const px = dx - t * ux, py = dy - t * uy, pz = dz - t * uz;
  const r2 = px * px + py * py + pz * pz;
  const r = Math.sqrt(r2);
  if (r < 1e-9) { out.set(0, 0, 0); return out; }
  const outside = (MU0 * I) / (2 * Math.PI * r * LENGTH_UNIT_M) * TESLA_TO_MICROTESLA;
  const c = r >= WIRE_RADIUS ? outside : outside * (r * r) / (WIRE_RADIUS * WIRE_RADIUS);
  const cx = uy * pz - uz * py, cy = uz * px - ux * pz, cz = ux * py - uy * px;
  const cn = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
  out.set(cx / cn * c, cy / cn * c, cz / cn * c);
  return out;
}

// 圆电流离散段（Biot–Savart），段数据预计算
function buildRingSegs(cy, R, I, N) {
  const segs = new Float64Array(N * 6);
  for (let i = 0; i < N; i++) {
    const a1 = (i / N) * Math.PI * 2, a2 = ((i + 1) / N) * Math.PI * 2;
    const x1 = R * Math.cos(a1), z1 = R * Math.sin(a1);
    const x2 = R * Math.cos(a2), z2 = R * Math.sin(a2);
    const s = i * 6;
    segs[s] = (x1 + x2) / 2; segs[s + 1] = cy; segs[s + 2] = (z1 + z2) / 2;
    segs[s + 3] = (x2 - x1) * I; segs[s + 4] = 0; segs[s + 5] = (z2 - z1) * I;
  }
  return segs;
}
function evalSegs(x, y, z, segs, out, coreRadius = 0) {
  let bx = 0, by = 0, bz = 0;
  for (let i = 0; i < segs.length; i += 6) {
    const rx = x - segs[i], ry = y - segs[i + 1], rz = z - segs[i + 2];
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-12) continue;
    const inv = 1 / Math.sqrt(r2);
    const core = coreRadius > 0 && r2 < coreRadius * coreRadius ? r2 / (coreRadius * coreRadius) : 1;
    const f = inv * inv * inv * core;
    const dlx = segs[i + 3], dly = segs[i + 4], dlz = segs[i + 5];
    bx += (dly * rz - dlz * ry) * f * BIOT_SAVART_SCALE;
    by += (dlz * rx - dlx * rz) * f * BIOT_SAVART_SCALE;
    bz += (dlx * ry - dly * rx) * f * BIOT_SAVART_SCALE;
  }
  out.set(bx, by, bz);
  return out;
}

function carlsonRF(x, y, z) {
  const C1 = 1 / 24, C2 = 0.1, C3 = 3 / 44, C4 = 1 / 14;
  let xt = x, yt = y, zt = z;
  let ave, dx, dy, dz;
  for (let i = 0; i < 20; i++) {
    const sx = Math.sqrt(xt), sy = Math.sqrt(yt), sz = Math.sqrt(zt);
    const lambda = sx * (sy + sz) + sy * sz;
    xt = 0.25 * (xt + lambda);
    yt = 0.25 * (yt + lambda);
    zt = 0.25 * (zt + lambda);
    ave = (xt + yt + zt) / 3;
    dx = (ave - xt) / ave;
    dy = (ave - yt) / ave;
    dz = (ave - zt) / ave;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 0.0025) break;
  }
  const e2 = dx * dy - dz * dz;
  const e3 = dx * dy * dz;
  return (1 + (C1 * e2 - C2 - C3 * e3) * e2 + C4 * e3) / Math.sqrt(ave);
}

function carlsonRD(x, y, z) {
  const C1 = 3 / 14, C2 = 1 / 6, C3 = 9 / 22, C4 = 3 / 26;
  const C5 = C3 / 4, C6 = 1.5 * C4;
  let xt = x, yt = y, zt = z, sum = 0, fac = 1;
  let ave, dx, dy, dz;
  for (let i = 0; i < 24; i++) {
    const sx = Math.sqrt(xt), sy = Math.sqrt(yt), sz = Math.sqrt(zt);
    const lambda = sx * (sy + sz) + sy * sz;
    sum += fac / (sz * (zt + lambda));
    fac *= 0.25;
    xt = 0.25 * (xt + lambda);
    yt = 0.25 * (yt + lambda);
    zt = 0.25 * (zt + lambda);
    ave = (xt + yt + 3 * zt) / 5;
    dx = (ave - xt) / ave;
    dy = (ave - yt) / ave;
    dz = (ave - zt) / ave;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 0.0015) break;
  }
  const ea = dx * dy;
  const eb = dz * dz;
  const ec = ea - eb;
  const ed = ea - 6 * eb;
  const ee = ed + 2 * ec;
  const correction = 1
    + ed * (-C1 + C5 * ed - C6 * dz * ee)
    + dz * (C2 * ee + dz * (-C3 * ec + dz * C4 * ea));
  return 3 * sum + fac * correction / (ave * Math.sqrt(ave));
}

function ellipticKE(parameter) {
  const m = Math.max(0, Math.min(1 - 1e-12, parameter));
  const rf = carlsonRF(0, 1 - m, 1);
  return { K: rf, E: rf - (m / 3) * carlsonRD(0, 1 - m, 1) };
}

// Circular loop in an x-z plane. Positive ampere-turns produce +Y field on axis.
function evalCircularLoopY(x, y, z, loopY, radius, ampereTurns, out, coreRadius = 0.035) {
  const rho = Math.hypot(x, z);
  const axial = y - loopY;
  const scale = (MU0 * ampereTurns * TESLA_TO_MICROTESLA) / LENGTH_UNIT_M;
  if (rho < 1e-7) {
    const denom = Math.pow(radius * radius + axial * axial, 1.5);
    out.set(0, scale * radius * radius / (2 * denom), 0);
    return out;
  }

  const radialOffset = rho - radius;
  const wireDistance = Math.hypot(radialOffset, axial);
  if (coreRadius > 0 && wireDistance < coreRadius) {
    if (wireDistance < 1e-10) { out.set(0, 0, 0); return out; }
    const magnitude = scale * wireDistance / (2 * Math.PI * coreRadius * coreRadius);
    const br = magnitude * axial / wireDistance;
    const by = -magnitude * radialOffset / wireDistance;
    out.set(br * x / rho, by, br * z / rho);
    return out;
  }

  const sum2 = (radius + rho) ** 2 + axial * axial;
  const diff2 = radialOffset * radialOffset + axial * axial;
  const root = Math.sqrt(sum2);
  const { K, E } = ellipticKE((4 * radius * rho) / sum2);
  const prefactor = scale / (2 * Math.PI * root);
  const br = prefactor * axial / rho
    * (-K + ((radius * radius + rho * rho + axial * axial) / diff2) * E);
  const by = prefactor
    * (K + ((radius * radius - rho * rho - axial * axial) / diff2) * E);
  out.set(br * x / rho, by, br * z / rho);
  return out;
}

function evalPolylineField(x, y, z, points, current, out, coreRadius = 0.055) {
  let bx = 0, by = 0, bz = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const r1x = x - a.x, r1y = y - a.y, r1z = z - a.z;
    const r2x = x - b.x, r2y = y - b.y, r2z = z - b.z;
    const m1 = Math.hypot(r1x, r1y, r1z), m2 = Math.hypot(r2x, r2y, r2z);
    if (m1 < 1e-10 || m2 < 1e-10) continue;
    const dot = r1x * r2x + r1y * r2y + r1z * r2z;
    const denom = m1 * m2 * (m1 * m2 + dot);
    if (denom < 1e-14) continue;
    const cx = r1y * r2z - r1z * r2y;
    const cy = r1z * r2x - r1x * r2z;
    const cz = r1x * r2y - r1y * r2x;
    const distanceSq = pointSegmentDistanceSq(x, y, z, a, b);
    const coreScale = distanceSq < coreRadius * coreRadius ? distanceSq / (coreRadius * coreRadius) : 1;
    const factor = BIOT_SAVART_SCALE * current * (m1 + m2) * coreScale / denom;
    bx += cx * factor; by += cy * factor; bz += cz * factor;
  }
  out.set(bx, by, bz);
  return out;
}

function pointSegmentDistanceSq(x, y, z, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = x - a.x, apy = y - a.y, apz = z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  const t = denom > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / denom)) : 0;
  const dx = apx - t * abx, dy = apy - t * aby, dz = apz - t * abz;
  return dx * dx + dy * dy + dz * dz;
}

function buildBentWirePath(width, height) {
  const w = width / 2, h = height / 2;
  const returnDepth = Math.max(5.5, width + 1.5);
  return [
    new THREE.Vector3(-w, -h, 0),
    new THREE.Vector3(-w, h, 0),
    new THREE.Vector3(w, h, 0),
    new THREE.Vector3(w, -h, 0),
    new THREE.Vector3(w, -h, -returnDepth),
    new THREE.Vector3(-w, -h, -returnDepth),
    new THREE.Vector3(-w, -h, 0),
  ];
}

function appendRectFace(list, center, u, v, uLen, vLen, nu, nv, sigma) {
  if (Math.abs(sigma) < 1e-12) return;
  const q = (sigma * uLen * vLen) / (nu * nv);
  for (let i = 0; i < nu; i++) {
    const du = ((i + 0.5) / nu - 0.5) * uLen;
    for (let j = 0; j < nv; j++) {
      const dv = ((j + 0.5) / nv - 0.5) * vLen;
      list.push(
        center[0] + u[0] * du + v[0] * dv,
        center[1] + u[1] * du + v[1] * dv,
        center[2] + u[2] * du + v[2] * dv,
        q,
      );
    }
  }
}

/* ==================== 场景定义 ==================== */
const SCENES = [
  {
    id: 'earth', name: '地磁场',
    lead: '本教学模型将地球主场近似为倾斜磁偶极子，默认倾角11.5°，可调节观察。磁感线从地磁 N 极（地理南极附近）出发，绕地球外部回到地磁 S 极（地理北极附近），并穿过地球内部形成闭合回路。',
    params: [
      { id: 'tilt', label: '磁轴倾角', min: 0, max: 25, step: 0.5, val: 11.5, unit: '°' },
      { id: 'moment', label: '赤道表面场强', min: 20, max: 60, step: 1, val: 30, unit: 'μT' },
    ],
    section: { n: 'z', off: 0, rot: 0 }, size: 15,
    solver: '球外偶极 + 球内核心电流近似',
    formula: '球外：B ∝ [3(m⃗·r̂)r̂−m⃗]/r³；球内：连续、无散度的轴对称多项式场',
    valueLine: (P) => `赤道 ${P.moment} μT，磁极 ${2 * P.moment} μT，倾角 ${P.tilt}°`,
    observations: [
      '地磁 N 极（磁感线出发）在地理南极附近；地磁 S 极（磁感线进入）在地理北极附近',
      '指南针 N 极指向地理北方——顺着磁感线的方向',
      '赤道附近磁感线近似水平，两极附近近似竖直',
      '球内采用光滑核心电流近似，与球外偶极场连续衔接并形成闭合回路',
    ],
    selfCheck: [
      '偶极子场 B ∝ 1/r³，比点电荷的 1/r² 衰减更快',
      '外部：N极 → S极；内部：S极 → N极，球面处方向连续',
      '本教学模型默认磁轴倾角11.5°，不表示今日实测磁轴位置',
    ],
    ai: '球外采用倾斜约 11.5° 的偶极主场；球内不是“永磁球”，而是用光滑、无散度的核心电流场近似地磁发电机产生的回程场。该模型服务于课堂辨形，不代替真实地核动力学。',
    camera: { pos: [13, 7, 17], target: [0, 0, 0] },
  },
  {
    id: 'bar-magnet', name: '条形磁铁',
    lead: 'N 极发出磁感线，经外部空间回到 S 极；在磁铁内部从 S 极回到 N 极，形成一条条完整的闭合回路。',
    params: [
      { id: 'length', label: '磁铁长度', min: 2, max: 3.5, step: 0.5, val: 3, displayScale: 10, unit: 'cm' },
      { id: 'strength', label: '等效磁化强度 μ₀M', min: 50, max: 300, step: 10, val: 150, unit: 'mT' },
    ],
    section: { n: 'z', off: 0, rot: 0 }, size: 12,
    solver: '矩形端面解析积分',
    formula: '远场 B ∝ 1/r³（有限磁偶极子）',
    valueLine: (P) => `L = ${P.length * 10} cm，μ₀M = ${P.strength} mT`,
    observations: [
      '磁铁外部磁感线从 N 极到 S 极，内部从 S 极回到 N 极',
      '两极附近的局部场通常较强；精确大小请看热力图或点选读数',
      '磁感线没有起点和终点；当前画面展示有限视窗中的代表性轨迹',
      '外部中部与两端附近的场强分布不同，不用绘制线数作定量判断',
    ],
    selfCheck: [
      '磁感线无起点和终点；等效面磁荷是计算方法，不是真实磁单极子',
      'N 极处 B 指向外，S 极处 B 指向内',
      '对称位置的磁感线分布应当对称',
    ],
    ai: '条形磁铁按均匀磁化长方体建模：N、S 端面上的等效面磁荷采用矩形面解析积分，不是两个点磁荷。磁感线外部从 N 到 S，内部从 S 回到 N，形成闭合回路。',
    camera: { pos: [9, 5.5, 12], target: [0, 0, 0] },
  },
  {
    id: 'bent-wire', name: '弯折导线',
    lead: '三段可见导线构成近似“缺一边”的方形，电流通过后方远置回流线闭合。靠近任一长直段且远离弯角时，局部磁场逐渐接近无限长直导线的同心圆分布。',
    params: [
      { id: 'current', label: '电流 I', min: 10, max: 100, step: 5, val: 50, unit: 'A' },
      { id: 'width', label: '可见宽度', min: 2.5, max: 5, step: 0.25, val: 4, displayScale: 10, unit: 'cm' },
      { id: 'height', label: '可见高度', min: 4, max: 7, step: 0.25, val: 5.5, displayScale: 10, unit: 'cm' },
      { id: 'direction', label: '电流方向', type: 'select', options: ['左侧向上', '左侧向下'], val: '左侧向上' },
    ],
    section: { n: 'y', off: 0, rot: 0 }, size: 13,
    solver: '闭合分段 Biot–Savart 积分',
    formula: 'B = (μ₀I/4π)∮dl⃗×r⃗/r³；局部 r ≪ D 时 B ≈ μ₀I/(2πr)',
    valueLine: (P) => `${P.direction} · I = ${P.current} A，宽 ${P.width * 10} cm，高 ${P.height * 10} cm`,
    observations: [
      '三段铜色导线是课堂装置中直接可见的通电部分',
      '灰色回流线放在后方，使稳恒电流路径保持闭合',
      '越靠近长直段中部、越远离弯角，局部磁感线越接近同心圆',
      '弯角、相邻导线和回流线会共同改变整体磁场，不能把整套装置当成一根无限长直导线',
    ],
    selfCheck: [
      '计算包含完整闭合回路，不使用物理上未定义的开路稳恒电流',
      '局部距离远小于到端点/弯角的距离时，数值结果逼近 μ₀I/(2πr)',
      '电流反向后，各处磁场方向同步反转，大小保持不变',
    ],
    ai: '弯折导线按完整闭合电路建模。画面突出三段可见导线，同时明确显示远置回流路径。这个场景适合比较“有限弯折导线的真实叠加场”和“局部无限长直导线近似”的适用条件。',
    camera: { pos: [7.5, 4.8, 10.5], target: [0, 0.45, -0.55] },
  },
  {
    id: 'straight-wire', name: '通电直导线',
    lead: '右手定则：拇指指向电流方向，四指弯曲的方向就是磁感线绕行方向。磁感线是以导线为圆心的同心圆。',
    params: [
      { id: 'current', label: '电流 I', min: 10, max: 100, step: 5, val: 50, unit: 'A' },
      { id: 'direction', label: '电流方向', type: 'select', options: ['向上（+Y）', '向下（−Y）'], val: '向上（+Y）' },
    ],
    section: { n: 'y', off: 0, rot: 0 }, size: 9,
    solver: '有限半径解析解',
    formula: 'r ≥ a：B = μ₀I/(2πr)；r < a：B = μ₀Ir/(2πa²)',
    valueLine: (P) => `${P.direction} · I = ${P.current} A，a = 0.6 cm，r = 10 cm 时 B = ${(2 * P.current).toFixed(1)} μT`,
    observations: [
      '磁感线是与导线垂直平面内的同心圆',
      '离导线越近磁感线越密——B ∝ 1/r',
      '导线上的红色箭头表示电流方向',
      '所有磁感线都是绕导线的闭合圆环',
    ],
    selfCheck: [
      'B = μ₀I/(2πr)，由安培环路定理严格给出',
      '磁感线闭合，且永远环绕电流',
      '电流反向，磁感线绕行方向随之反转',
    ],
    ai: '无限长直导线的磁场由安培环路定理严格求得：B = μ₀I/(2πr)。磁感线是以导线为轴的同心圆，方向由右手定则确定：握住导线，拇指指电流，四指即磁场方向。',
    camera: { pos: [6.5, 4, 8.5], target: [0, 0, 0] },
  },
  {
    id: 'two-wires', name: '双导线',
    lead: '两根平行通电导线的磁场按叠加原理合成。同向电流相吸、反向电流相斥——这是安培力的经典演示。',
    params: [
      { id: 'current1', label: '左导线电流 I₁', min: 10, max: 100, step: 5, val: 50, unit: 'A' },
      { id: 'current2', label: '右导线电流 I₂', min: 10, max: 100, step: 5, val: 50, unit: 'A' },
      { id: 'spacing', label: '导线间距', min: 1.5, max: 5, step: 0.25, val: 3, displayScale: 10, unit: 'cm' },
      { id: 'direction', label: '电流方向', type: 'select', options: ['同向', '反向'], val: '同向' },
      { id: 'display', label: '显示模式', type: 'select', options: ['合磁场', '仅左导线', '仅右导线'], val: '合磁场' },
    ],
    section: { n: 'y', off: 0, rot: 0 }, size: 11,
    solver: '双导线解析叠加',
    formula: 'B = B₁ + B₂；Bᵢ = μ₀Iᵢ/(2πrᵢ)',
    valueLine: (P) => P.display === '合磁场'
      ? `${P.direction} · I₁ = ${P.current1} A，I₂ = ${P.current2} A，d = ${P.spacing * 10} cm`
      : `${P.display} · d = ${P.spacing * 10} cm`,
    observations: [
      '同向且 I₁=I₂：几何中点磁场严格为零；电流不等时零场点向较小电流一侧移动',
      '反向电流：两线之间磁场叠加增强，导线相互排斥',
      '反向电流中垂面上 B 同向叠加——磁感线密集穿过中面',
      '切换「显示模式」可单独查看每根导线的磁场，体会矢量叠加',
      '每根导线周围的磁感线仍环绕各自导线（被对方扭曲）',
      '导线上的红色箭头表示各自电流方向',
    ],
    selfCheck: [
      '只有同向且 I₁=I₂ 时，两线正中点 B = 0',
      '反向电流中垂面上两线贡献同向叠加；越靠近导线场越强',
      'I₁=I₂ 的反向电流具有中垂分界线；电流不等时对称性消失',
      '叠加原理：B_total = B₁ + B₂（切换显示模式验证）',
    ],
    ai: '两根平行导线是“磁场叠加 + 安培力”的经典场景。两根电流可独立调节；只有同向、等流时几何中点才严格为零。单位长度安培力 F/L = μ₀I₁I₂/(2πd)。',
    // Keep the camera on the x = 0 symmetry plane so equal-current wires do
    // not acquire a false left/right size difference from perspective.
    camera: { pos: [0, 6.5, 13], target: [0, 0, 0] },
  },
  {
    id: 'loop', name: '环形电流',
    lead: '圆形细导线回路采用 Biot–Savart 数值积分，导线近场作正则化并屏蔽定量读数。磁感线穿过环内、绕环外闭合，整体像一个小磁针（磁偶极子）。',
    params: [
      { id: 'current', label: '电流 I', min: 10, max: 100, step: 5, val: 50, unit: 'A' },
      { id: 'radius', label: '半径 R', min: 1, max: 4, step: 0.25, val: 2, displayScale: 10, unit: 'cm' },
      { id: 'direction', label: '电流方向', type: 'select', options: ['正向', '反向'], val: '正向' },
      { id: 'density', label: '磁感线密度', type: 'select', options: ['清晰', '标准', '丰富'], val: '丰富' },
    ],
    section: { n: 'z', off: 0, rot: 0 }, size: 10,
    solver: '细导线积分与近场屏蔽',
    formula: 'B轴(y) = μ₀IR² / 2(R²+y²)^(3/2)',
    valueLine: (P) => `${P.direction}电流 · I = ${P.current} A，R = ${P.radius * 10} cm，a = ${(LOOP_WIRE_RADIUS * 10).toFixed(2)} cm → B心 = ${((2 * Math.PI * P.current) / P.radius).toFixed(1)} μT`,
    observations: [
      '磁感线穿过圆环内部，绕环外部闭合',
      '导线上的红色箭头表示电流方向（右手定则）',
      '轴线上的磁场沿轴线方向，圆心处最强',
      '远处的场分布趋近于磁偶极子',
    ],
    selfCheck: [
      '轴线公式 B = μ₀IR²/[2(R²+y²)^(3/2)] 有解析解',
      '圆心处 B = μ₀I/2R',
      '环电流等效一个小磁针：面法向即 N 极方向',
    ],
    ai: '环形电流（圆电流）是最基本的磁场源之一。轴线上有精确解析解，程序同时在控制台中用轴线公式做交叉验证。四指沿电流方向握环，拇指指向环轴线上的磁场方向。',
    camera: { pos: [14, 9, 18], target: [0, 0, 0] },
  },
  {
    id: 'solenoid', name: '通电螺线管',
    lead: '密绕螺线管可看作连续分布的圆形电流。长管中央区域近似匀强 B ≈ μ₀nI；沿轴线由中心走向管口时场强减小，外部场类似条形磁铁。',
    params: [
      { id: 'current', label: '电流 I', min: 10, max: 100, step: 5, val: 50, unit: 'A' },
      { id: 'radius', label: '半径 R', min: 1, max: 1.75, step: 0.25, val: 1.5, displayScale: 10, unit: 'cm' },
      { id: 'nLoops', label: '匝数 N', type: 'int', min: 50, max: 300, step: 5, val: 160, unit: '匝' },
      { id: 'length', label: '长度 L', min: 4, max: 8, step: 0.5, val: 5, displayScale: 10, unit: 'cm' },
      { id: 'direction', label: '电流绕向', type: 'select', options: ['正向（N 在 +Y）', '反向（N 在 −Y）'], val: '正向（N 在 +Y）' },
    ],
    section: { n: 'z', off: 0, rot: 0 }, size: 14,
    solver: '连续薄壁螺线管数值积分',
    formula: 'B轴(y) = (μ₀nI/2)(cosθ₁−cosθ₂)，中央 B ≈ μ₀nI',
    valueLine: (P) => {
      const ideal = (MU0 * (P.nLoops / (P.length * LENGTH_UNIT_M)) * P.current) * 1e3;
      const finite = P.length / Math.sqrt(P.length * P.length + 4 * P.radius * P.radius);
      return `${P.direction}，n = ${(P.nLoops / (P.length * LENGTH_UNIT_M)).toFixed(0)} 匝/m，中心 |B| ≈ ${(ideal * finite).toFixed(2)} mT`;
    },
    observations: [
      '长螺线管中央区域磁感线近似平行、等距、同向',
      '轴线上从中心走向管口时磁场逐渐减弱；长管端口约为中央场的一半',
      '管外磁感线稀疏，分布类似条形磁铁',
      '绕线上的红色箭头表示电流绕向（右手定则定 N 极）',
      '匝密度决定中心场强；长度与半径之比越大，中央匀强区域越明显',
      '参数范围保持 L ≥ 2R，以匹配高中课堂中的螺线管近似',
    ],
    selfCheck: [
      '理想无限长螺线管内部 B = μ₀nI；有限管轴线场使用有限长解析式交叉验证',
      '数值场用 变量代换后的 48 点高斯积分逼近连续薄壁电流，积分点数不等于匝数',
      '两端面即 N、S 极，磁感线在管内外闭合',
    ],
    ai: '采用空气芯连续薄壁近似，变量代换后的48点高斯积分，N 与 I 决定总安匝数。画中绕线仅示意，不逐匝对应；忽略螺旋轴向电流、引线及回流的贡献，不含铁芯。轴线上中心比管口强，近绕组局部强场须另外比较。导线近场区域屏蔽定量读数。',
    camera: { pos: [19.5, 12.2, 25.6], target: [0, 0, 0] },
  },
];

/* ==================== 各场景场函数 ==================== */
const EARTH_R = 2.3;

function buildField(sceneId, P) {
  switch (sceneId) {
    case 'earth': {
      const t = (P.tilt * Math.PI) / 180;
      const M = P.moment * EARTH_R * EARTH_R * EARTH_R;
      const mx = Math.sin(t) * M, my = -Math.cos(t) * M, mz = 0;
      const Re = EARTH_R, Re2 = Re * Re;
      const surfaceScale = M / (Re * Re * Re);
      const evalB = (x, y, z, out) => {
        const r2 = x * x + y * y + z * z;
        if (r2 < Re2) {
          // Smooth, divergence-free core-current model. The polynomial vector potential
          // matches both normal and tangential B continuously to the external dipole.
          const ndotm = r2 > 1e-14 ? (x * mx + y * my + z * mz) / (Math.sqrt(r2) * M) : 0;
          const rHatScale = r2 > 1e-14 ? ndotm / Math.sqrt(r2) : 0;
          const radialFactor = (3 * surfaceScale * r2) / Re2;
          const momentFactor = 5 * surfaceScale - (6 * surfaceScale * r2) / Re2;
          out.set(
            momentFactor * mx / M + radialFactor * x * rHatScale,
            momentFactor * my / M + radialFactor * y * rHatScale,
            momentFactor * mz / M + radialFactor * z * rHatScale,
          );
          return out;
        }
        return evalDipole(x, y, z, mx, my, mz, out);
      };
      return { evalB, inSolid: null, m: new THREE.Vector3(mx, my, mz) };
    }
    case 'bar-magnet': {
      // 均匀磁化长方体（真实磁化体模型）：M = M0 ŷ，磁荷只出现在 N/S 端面（σ=±M0），
      // 场函数处处有效：外部 = 磁荷库仑场；内部 = 磁荷库仑场 + M（B=μ₀(H+M)，退磁场修正）
      const L = P.length, q = P.strength;
      const hw = 0.38, Lh = L / 2;
      const M0 = q * 1000;                    // μ0M，μT（沿 +y，N 在 y=L/2）
      const evalB = (x, y, z, out) => {
        out.set(0, 0, 0);
        evalRectFace(x, y, z, Lh, hw, M0, out);
        evalRectFace(x, y, z, -Lh, hw, -M0, out);
        if (Math.abs(x) < hw && Math.abs(y) < Lh && Math.abs(z) < hw) out.y += M0;
        // Principal surface value preserves normal B at the end face.
        if (Math.abs(x) < hw && Math.abs(z) < hw && Math.abs(Math.abs(y) - Lh) < 1e-12) out.y += M0 / 2;
        return out;
      };
      const inSolid = (x, y, z) => Math.abs(x) < hw && Math.abs(y) < Lh && Math.abs(z) < hw;
      const quantitativeMask = (x, y, z) => Math.abs(x) <= hw + 1e-7 && Math.abs(y) <= Lh + 1e-7 && Math.abs(z) <= hw + 1e-7
        && Math.min(Math.abs(Math.abs(x) - hw), Math.abs(Math.abs(y) - Lh), Math.abs(Math.abs(z) - hw)) < 1e-7;
      return { evalB, inSolid, heatMask: inSolid, quantitativeMask, poleN: new THREE.Vector3(0, Lh, 0), poleS: new THREE.Vector3(0, -Lh, 0), hw, M0 };
    }
    case 'bent-wire': {
      const sign = P.direction === '左侧向下' ? -1 : 1;
      const points = buildBentWirePath(P.width, P.height);
      const core = 0.055;
      const evalB = (x, y, z, out) => evalPolylineField(x, y, z, points, P.current * sign, out, core);
      const heatMask = (x, y, z) => {
        for (let i = 0; i < points.length - 1; i++) {
          if (pointSegmentDistanceSq(x, y, z, points[i], points[i + 1]) < core * core) return true;
        }
        return false;
      };
      return { evalB, inSolid: null, heatMask, points, sign, core };
    }
    case 'straight-wire': {
      const I = P.current * (P.direction.includes('向下') ? -1 : 1);
      const evalB = (x, y, z, out) => evalWire(x, y, z, 0, 0, 0, 0, 1, 0, I, out);
      const heatMask = (x, y, z) => x * x + z * z < WIRE_RADIUS * WIRE_RADIUS;
      return { evalB, inSolid: null, heatMask };
    }
    case 'two-wires': {
      const I1 = P.current1, I2 = P.current2, d = P.spacing;
      const showLeft = P.display !== '仅右导线';
      const showRight = P.display !== '仅左导线';
      const dir2 = P.direction === '反向' ? -1 : 1;
      const evalB = (x, y, z, out) => {
        if (showLeft) evalWire(x, y, z, -d / 2, 0, 0, 0, 1, 0, I1, out);
        else out.set(0, 0, 0);
        if (showRight) {
          evalWire(x, y, z, d / 2, 0, 0, 0, 1, 0, I2 * dir2, _tmp);
          out.add(_tmp);
        }
        return out;
      };
      const heatMask = (x, y, z) => (showLeft && (x + d / 2) ** 2 + z * z < WIRE_RADIUS * WIRE_RADIUS)
        || (showRight && (x - d / 2) ** 2 + z * z < WIRE_RADIUS * WIRE_RADIUS);
      return { evalB, inSolid: null, heatMask, d, dir2, I1, I2, showLeft, showRight };
    }
    case 'loop': {
      const I = P.current * (P.direction === '反向' ? -1 : 1), R = P.radius;
      const segs = buildRingSegs(0, R, I, P.integrationSegments || 384); // 384 段微元：贴近导线处场更精确（Bx 泄漏 <0.4%）
      const evalB = (x, y, z, out) => evalSegs(x, y, z, segs, out, LOOP_WIRE_RADIUS);
      const heatMask = (x, y, z) => {
        const radial = Math.sqrt(x * x + z * z);
        return (radial - R) ** 2 + y * y < LOOP_WIRE_RADIUS * LOOP_WIRE_RADIUS;
      };
      return { evalB, inSolid: null, heatMask, R, I };
    }
    case 'solenoid': {
      const currentSign = P.direction.startsWith('反向') ? -1 : 1;
      const I = P.current * currentSign, R = P.radius, L = P.length, N = P.nLoops;
      const sliceCount = P.integrationSlices || 192;
      const ampereTurns = (I * N) / sliceCount;
      const loopYs = new Float64Array(sliceCount);
      for (let i = 0; i < sliceCount; i++) loopYs[i] = -L / 2 + ((i + 0.5) / sliceCount) * L;
      const evalB = (x, y, z, out) => {
        out.set(0, 0, 0);
        if (P.integrationSlices) {
          for (let i = 0; i < loopYs.length; i++) {
            evalCircularLoopY(x, y, z, loopYs[i], R, ampereTurns, _tmp);
            out.add(_tmp);
          }
        } else {
          // Change of variable resolves the narrow near-wall peak without
          // densely sampling the full length. 48-point Gauss-Legendre rule.
          const dist = Math.max(0.06, Math.abs(Math.hypot(x, z) - R));
          const lower = Math.atan((-L / 2 - y) / dist);
          const upper = Math.atan(( L / 2 - y) / dist);
          const mid = (lower + upper) / 2, half = (upper - lower) / 2;
          for (let i = 0; i < GAUSS48_NODES.length; i++) {
            const theta = mid + half * GAUSS48_NODES[i], cs = Math.cos(theta);
            const loopY = y + dist * Math.tan(theta);
            const weight = half * GAUSS48_WEIGHTS[i] * dist / (cs * cs);
            evalCircularLoopY(x, y, z, loopY, R, I * N / L * weight, _tmp);
            out.add(_tmp);
          }
        }
        return out;
      };
      const heatMask = (x, y, z) => Math.abs(Math.hypot(x, z) - R) < 0.06 && Math.abs(y) <= L / 2 + 0.04;
      return { evalB, inSolid: null, heatMask, R, L, N, I, currentSign, loopYs, ampereTurns };
    }
  }
}

const _tmp = new THREE.Vector3();
const _b = new THREE.Vector3();
const _b2 = new THREE.Vector3();
const _b1 = new THREE.Vector3();
const _bt = new THREE.Vector3();

/* ==================== 场线追踪（四阶 Runge–Kutta） ==================== */
function traceLine(evalB, seed, opt = {}) {
  const step = opt.step || FL_STEP;
  const maxSteps = opt.maxSteps || 1600;
  const bounds = opt.bounds || 11;
  const dir = opt.dir || 1;
  const closeTol = opt.closeTol || step * 2.4;
  const tangentThreshold = opt.tangentThreshold || 0.96;
  const stopPts = opt.stopPts || null;
  const inSolid = opt.inSolid || null;
  const planeN = opt.planeN || null;
  const pts = [seed.clone()];
  let x = seed.x, y = seed.y, z = seed.z;
  let walked = 0; // 累计弧长，用于可靠的闭合判断
  let reason = 'steps';
  let closureGap = null;
  let closureTangentDot = null;
  const dirAt = (px, py, pz, target) => {
    evalB(px, py, pz, target);
    const m = target.length();
    if (m < 1e-9) return false;
    target.multiplyScalar(dir / m);
    if (planeN) {
      const d = target.dot(planeN);
      target.addScaledVector(planeN, -d);
      if (target.lengthSq() < 1e-12) return false;
      target.normalize();
    }
    return true;
  };
  const startDir = new THREE.Vector3();
  if (!dirAt(x, y, z, startDir)) return { pts, closed: false, reason: 'zero', closureGap, closureTangentDot };
  const currentDir = new THREE.Vector3();
  for (let i = 0; i < maxSteps; i++) {
    if (!dirAt(x, y, z, _b1)) { reason = 'zero'; break; }
    if (!dirAt(x + _b1.x * step * 0.5, y + _b1.y * step * 0.5, z + _b1.z * step * 0.5, _b2)) { reason = 'zero'; break; }
    if (!dirAt(x + _b2.x * step * 0.5, y + _b2.y * step * 0.5, z + _b2.z * step * 0.5, _bt)) { reason = 'zero'; break; }
    if (!dirAt(x + _bt.x * step, y + _bt.y * step, z + _bt.z * step, _b)) { reason = 'zero'; break; }
    x += (step / 6) * (_b1.x + 2 * _b2.x + 2 * _bt.x + _b.x);
    y += (step / 6) * (_b1.y + 2 * _b2.y + 2 * _bt.y + _b.y);
    z += (step / 6) * (_b1.z + 2 * _b2.z + 2 * _bt.z + _b.z);
    walked += step;
    if (x * x + y * y + z * z > bounds * bounds) { reason = 'bounds'; break; }
    if (stopPts) {
      let hit = false;
      for (const sp of stopPts) {
        const dx = x - sp.x, dy = y - sp.y, dz = z - sp.z;
        if (dx * dx + dy * dy + dz * dz < sp.d * sp.d) { hit = true; break; }
      }
      if (hit) { reason = 'stop'; break; }
    }
    if (inSolid && inSolid(x, y, z)) { reason = 'solid'; break; }
    pts.push(new THREE.Vector3(x, y, z));
    if (i > 60 && walked > Math.max(1.2, step * 60)) {
      const dx = x - seed.x, dy = y - seed.y, dz = z - seed.z;
      const gap = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (gap < closeTol && dirAt(x, y, z, currentDir)) {
        const tangentDot = currentDir.dot(startDir);
        if (tangentDot >= tangentThreshold) {
          closureGap = gap;
          closureTangentDot = tangentDot;
          pts.push(seed.clone()); reason = 'closed'; break;
        }
      }
    }
  }
  return { pts, closed: reason === 'closed', reason, closureGap, closureTangentDot };
}

function orientAlongB(pts, evalB) {
  if (pts.length < 3) return pts;
  evalB(pts[0].x, pts[0].y, pts[0].z, _b);
  if (_b.lengthSq() < 1e-12) return pts;
  const t = _tmp.subVectors(pts[1], pts[0]);
  if (_b.dot(t) < 0) pts.reverse();
  return pts;
}

function decimateLine(pts, closed, maxPoints = 2200) {
  if (!pts || pts.length <= maxPoints) return pts;
  const uniqueCount = closed && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-10 ? pts.length - 1 : pts.length;
  const stride = Math.max(1, Math.ceil(uniqueCount / (maxPoints - (closed ? 1 : 0))));
  const out = [];
  for (let i = 0; i < uniqueCount; i += stride) out.push(pts[i]);
  if (closed && out.length) out.push(out[0].clone());
  else if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

function assessLineQuality(pts, evalB, closed, options = {}) {
  if (!pts || pts.length < 7) return { pass: false, reason: 'too-short' };
  const uniqueCount = closed && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-10 ? pts.length - 1 : pts.length;
  const segmentLengths = [];
  const alignments = [];
  const segmentCount = closed ? uniqueCount : uniqueCount - 1;
  const stride = Math.max(1, Math.floor(segmentCount / 120));
  for (let i = 0; i < segmentCount; i++) {
    const j = (i + 1) % uniqueCount;
    const len = pts[i].distanceTo(pts[j]);
    if (len > 1e-8) segmentLengths.push(len);
    if (i % stride !== 0 || len < 1e-8) continue;
    _tmp.copy(pts[i]).add(pts[j]).multiplyScalar(0.5);
    evalB(_tmp.x, _tmp.y, _tmp.z, _b);
    if (_b.lengthSq() < 1e-16) continue;
    _bt.subVectors(pts[j], pts[i]).normalize();
    alignments.push(Math.abs(_bt.dot(_b.normalize())));
  }
  segmentLengths.sort((a, b) => a - b);
  alignments.sort((a, b) => a - b);
  const medianStep = segmentLengths.length ? segmentLengths[Math.floor(segmentLengths.length / 2)] : Infinity;
  const totalLength = segmentLengths.reduce((sum, value) => sum + value, 0);
  const diagonal = new THREE.Box3().setFromPoints(pts).getSize(_tmp).length();
  const tortuosity = diagonal > 1e-9 ? totalLength / diagonal : Infinity;
  const seamLength = closed ? pts[uniqueCount - 1].distanceTo(pts[0]) : 0;
  const seamFactor = closed && medianStep > 1e-9 ? seamLength / medianStep : 0;
  let seamTangent = 1;
  if (closed && uniqueCount > 3) {
    const into = _b1.subVectors(pts[uniqueCount - 1], pts[uniqueCount - 2]).normalize();
    const out = _b2.subVectors(pts[1], pts[0]).normalize();
    seamTangent = into.dot(out);
  }
  const alignmentP05 = alignments.length ? alignments[Math.floor((alignments.length - 1) * 0.05)] : 0;
  const seamPass = !closed || (seamFactor <= 2.8 && (options.physicalSeamKink || seamTangent >= 0.90));
  const pass = seamPass && alignmentP05 >= 0.94 && tortuosity < 10;
  return { pass, seamLength, seamFactor, seamTangent, alignmentP05, medianStep, tortuosity, physicalSeamKink: Boolean(options.physicalSeamKink) };
}

/* ==================== 各场景磁感线生成（全部闭合） ==================== */
function generateFieldLines(sceneId, P, field) {
  const lines = [];
  const { evalB, inSolid } = field;
  const traceStats = { attempted: 0, reasons: {}, qualityRejected: 0, qualityFailures: [] };
  const runTrace = (seed, options) => {
    const result = traceLine(evalB, seed, options);
    traceStats.attempted++;
    traceStats.reasons[result.reason] = (traceStats.reasons[result.reason] || 0) + 1;
    if (result.closed) {
      traceStats.maxClosureGap = Math.max(traceStats.maxClosureGap || 0, result.closureGap || 0);
      traceStats.minClosureTangent = Math.min(traceStats.minClosureTangent ?? 1, result.closureTangentDot ?? 1);
    }
    return result;
  };
  const push = (pts, closed = true, qualityOptions = {}) => {
    if (!pts || pts.length <= 6) return;
    const sampled = decimateLine(pts, closed);
    const quality = assessLineQuality(sampled, evalB, closed, qualityOptions);
    if (!quality.pass) {
      traceStats.qualityRejected++;
      if (traceStats.qualityFailures.length < 4) traceStats.qualityFailures.push(quality);
      return;
    }
    lines.push({ pts: sampled, closed, quality });
  };

  switch (sceneId) {
    case 'earth': {
      const t = (P.tilt * Math.PI) / 180;
      const mHat = new THREE.Vector3(Math.sin(t), -Math.cos(t), 0);
      const e1 = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);
      const e2 = new THREE.Vector3(0, 0, 1);
      const Re = EARTH_R;
      const Ls = [1.45, 2.05, 2.9, 4.1];
      for (const Lf of Ls) {
        const L = Lf * Re;
        const th0 = Math.asin(Math.sqrt(Re / L));
        for (let k = 0; k < 4; k++) {
          const phi = (k / 4) * Math.PI * 2;
          const d = e1.clone().multiplyScalar(Math.cos(phi)).addScaledVector(e2, Math.sin(phi));
          const seed = new THREE.Vector3()
            .addScaledVector(mHat, Math.cos(th0))
            .addScaledVector(d, Math.sin(th0))
            .multiplyScalar(Re + 0.035);
          const result = runTrace(seed, { dir: 1, maxSteps: 52000, bounds: 17, closeTol: 0.065, tangentThreshold: 0.96, step: 0.024 });
          if (result.closed) push(result.pts, true);
        }
      }
      break;
    }
    case 'bar-magnet': {
      const L = P.length;
      const seedY = L / 2 + 0.14;
      const radii = [0.1, 0.22, 0.36, 0.5, 0.7, 0.95, 1.25, 1.6, 2.0];
      const yAxis = new THREE.Vector3(0, 1, 0);
      const acceptedBases = [];
      for (const radius of radii) {
        const s = new THREE.Vector3(radius, seedY, 0);
        // 沿 B 数值追踪（真实磁化体场）：N 端面外 → 外部绕行 → 穿入 S 端面 →
        // 内部沿 M(S→N) → 穿出 N 端面，整条线自然闭合，无任何拼接
        const r = runTrace(s, { dir: 1, maxSteps: 18000, bounds: 12, closeTol: 0.055, step: 0.025 });
        if (r.closed) {
          const candidateQuality = assessLineQuality(decimateLine(r.pts, true), evalB, true);
          if (candidateQuality.pass) acceptedBases.push(r.pts);
          else {
            traceStats.qualityRejected++;
            if (traceStats.qualityFailures.length < 4) traceStats.qualityFailures.push(candidateQuality);
          }
        }
        if (acceptedBases.length >= 3) break;
      }
      for (const base of acceptedBases) {
        for (let k = 0; k < 4; k++) {
          const angle = (k * Math.PI) / 2;
          push(base.map((point) => point.clone().applyAxisAngle(yAxis, angle)), true);
        }
      }
      break;
    }
    case 'bent-wire': {
      const w = P.width / 2, h = P.height / 2;
      const seeds = [];
      for (const radius of [0.14, 0.22, 0.32, 0.45, 0.62]) {
        seeds.push(new THREE.Vector3(-w + radius, 0, 0));
        seeds.push(new THREE.Vector3(-w, 0, radius));
        seeds.push(new THREE.Vector3(w - radius, 0, 0));
        seeds.push(new THREE.Vector3(w, 0, radius));
      }
      for (const radius of [0.16, 0.26, 0.38, 0.54]) {
        seeds.push(new THREE.Vector3(0, h - radius, 0));
        seeds.push(new THREE.Vector3(0, h, radius));
      }
      for (const seed of seeds) {
        const forward = runTrace(seed, { dir: 1, maxSteps: 48000, bounds: 15, closeTol: 0.065, tangentThreshold: 0.95, step: 0.026 });
        if (forward.closed) push(forward.pts, true);
      }
      break;
    }
    case 'straight-wire': {
      // 精确同心圆（1/r 疏密自然呈现）
      const radii = [0.45, 0.75, 1.1, 1.6, 2.25, 3.1];
      for (const hy of [-2.2, 0, 2.2]) {
        for (const r of radii) {
          const pts = [];
          for (let i = 0; i <= 71; i++) {
            const a = (i / 71) * Math.PI * 2;
            pts.push(new THREE.Vector3(r * Math.cos(a), hy, r * Math.sin(a)));
          }
          push(orientAlongB(pts, evalB));
        }
      }
      break;
    }
    case 'two-wires': {
      const d = P.spacing, co = P.direction === '同向';
      const a = d / 2;
      const planeN = new THREE.Vector3(0, 1, 0);
      const showLeft = P.display !== '仅右导线';
      const showRight = P.display !== '仅左导线';
      const singleMode = !showLeft || !showRight;
      const balanced = Math.abs(P.current1 - P.current2) < 1e-9;

      if (singleMode) {
        // 单根导线：同心圆（与直导线一致，仅圆心偏移）
        const px = showLeft ? -a : a;
        const radii = [0.35, 0.65, 1.0, 1.45, 2.1, 2.9];
        for (const hy of [-1.7, 0, 1.7]) {
          for (const r of radii) {
            const pts = [];
            for (let i = 0; i <= 80; i++) {
              const ang = (i / 80) * Math.PI * 2;
              pts.push(new THREE.Vector3(px + r * Math.cos(ang), hy, r * Math.sin(ang)));
            }
            push(orientAlongB(pts, evalB));
          }
        }
        break;
      }

      if (!co && balanced) {
        // 反向电流——精确解：磁感线为阿波罗尼奥斯圆（|r₂|/|r₁| = k）
        // 全部完整渲染闭合圆；k 太接近 1（如 1.18）的圆半径趋于无穷、
        // 视觉上接近直线且大部分超出画面，物理上等价于中垂面直线，
        // k→1 时圆的半径趋于无穷；用显式中垂分界线表示这一极限，不再画被视窗裁成直线的巨圆。
        const ks = [5.0, 3.0, 2.0, 1.6];
        for (const hy of [-1.7, 0, 1.7]) {
          for (const k of ks) {
            for (const sgn of [1, -1]) {
              const xc = (sgn * a * (1 + k * k)) / (1 - k * k);
              const rr = Math.sqrt(Math.max(xc * xc - a * a, 0.01));
              const NPT = k < 1.5 ? 180 : 110;
              const pts = [];
              for (let i = 0; i <= NPT; i++) {
                const th = (i / NPT) * Math.PI * 2;
                pts.push(new THREE.Vector3(xc + rr * Math.cos(th), hy, rr * Math.sin(th)));
              }
              push(orientAlongB(pts, evalB));
            }
          }
          const separatrix = [];
          for (let i = 0; i <= 160; i++) {
            const z = -5.2 + (10.4 * i) / 160;
            separatrix.push(new THREE.Vector3(0, hy, z));
          }
          push(orientAlongB(separatrix, evalB), false);
        }
      } else {
        // General unequal-current case: integrate the actual superposed field.
        for (const hy of [-1.7, 0, 1.7]) {
          const seeds = [];
          for (const px of [-a, a]) {
            for (const rho of [0.24, 0.48, 0.82]) {
              seeds.push(new THREE.Vector3(px + (px < 0 ? -rho : rho), hy, 0));
            }
          }
          for (const z0 of [0.72 * a, 1.15 * a, 1.75 * a, 2.7 * a]) seeds.push(new THREE.Vector3(0, hy, z0));
          for (const s of seeds) {
            const res = runTrace(s, { dir: 1, maxSteps: 36000, bounds: 9, closeTol: 0.065, planeN, step: 0.028 });
            if (res.closed && res.pts.length > 20) push(res.pts, true);
          }
        }
      }
      break;
    }
    case 'loop': {
      const R = P.radius;
      // 子午面（过环轴平面）内，磁感线是环绕导线截面点的闭合曲线族（教科书形态）：
      //   ① 穿环大透镜（0.45R）：竖直穿过环面、上下延伸最大，教科书核心形态
      //   ② 穿环中透镜（0.7R）
      //   ③ 紧贴导线外侧小环（R+0.18）：环绕电流自身闭合
      //   ④ 紧贴导线内侧小环（R-0.18）：环绕电流自身闭合
      //   ⑤ 远场大透镜（1.5R）：磁偶极子外观
      // 近线小环使用更小步长与 closeTol，同时检查起终切向，避免提前误判闭合。
      const allSeeds = [
        { f: 0.45, side: null, step: 0.018, max: 70000, closeTol: 0.045 },
        { f: 0.78, side: null, step: 0.020, max: 70000, closeTol: 0.05 },
        { f: 0.18, side: 'in', step: 0.012, max: 8000, closeTol: 0.03 },
        { f: 0.18, side: 'out', step: 0.012, max: 8000, closeTol: 0.03 },
        { f: 1.50, side: null, step: 0.025, max: 50000, closeTol: 0.06 },
      ];
      if (P.density === '清晰') allSeeds.splice(2, 1);
      if (P.density === '丰富') allSeeds.push({f:0.61,side:null,step:0.018,max:70000,closeTol:0.045});
      const baseAngle = Math.atan2(18, 14) + Math.PI / 2;
      for (let k = 0; k < 2; k++) {
        const a = baseAngle + (k === 0 ? -0.38 : 0.38);
        const ca = Math.cos(a), sa = Math.sin(a);
        const planeN = new THREE.Vector3(-sa, 0, ca); // 子午面法向，约束追踪不漂移
        for (const radialSign of [-1, 1]) {
          for (const sd of allSeeds) {
            const radial = sd.side === 'out' ? R + sd.f : sd.side === 'in' ? R - sd.f : sd.f * R;
            const s = new THREE.Vector3(radial * ca * radialSign, 0, radial * sa * radialSign);
            const res = runTrace(s, { dir: 1, maxSteps: sd.max, bounds: 11, closeTol: sd.closeTol, step: sd.step, planeN });
            if (res.closed && res.pts.length > 20) push(res.pts, true);
          }
        }
      }
      break;
    }
    case 'solenoid': {
      const R = P.radius, L = P.length, Lh = L / 2;
      const radii = [0.18, 0.38, 0.60, 0.80, 0.92].map((f) => f * R);
      const northSign = field.I >= 0 ? 1 : -1;
      const baseAngle = Math.atan2(21, 16) + Math.PI / 2;
      const planeN = new THREE.Vector3(-Math.sin(baseAngle), 0, Math.cos(baseAngle));
      const acceptedBaseLines = [];
      for (const radius of radii) {
        for (const radialSign of [-1, 1]) {
          const seed = new THREE.Vector3(
            radius * Math.cos(baseAngle) * radialSign,
            northSign * (Lh + 0.12),
            radius * Math.sin(baseAngle) * radialSign,
          );
          const forward = runTrace(seed, { dir: 1, maxSteps: 42000, bounds: 22, closeTol: 0.06, step: 0.025, planeN });
          if (forward.closed) {
            const candidateQuality = assessLineQuality(decimateLine(forward.pts, true), evalB, true);
            if (candidateQuality.pass) acceptedBaseLines.push({ pts: forward.pts, closed: true });
            else {
              traceStats.qualityRejected++;
              if (traceStats.qualityFailures.length < 4) traceStats.qualityFailures.push(candidateQuality);
            }
          }
        }
      }
      const yAxis = new THREE.Vector3(0, 1, 0);
      for (const delta of [-0.38, 0, 0.38]) {
        for (const base of acceptedBaseLines) {
          push(base.pts.map((point) => point.clone().applyAxisAngle(yAxis, delta)), true);
        }
      }
      const axisExtent = Math.max(8.5, L / 2 + 4.5 * R);
      const axis = [];
      for (let i = 0; i <= 180; i++) axis.push(new THREE.Vector3(0, -axisExtent + (2 * axisExtent * i) / 180, 0));
      push(orientAlongB(axis, evalB), false);
      break;
    }
  }
  const closed = lines.filter((l) => l.closed).length;
  const expectedOpen = lines.filter((l) => !l.closed).length;
  const smoothClosed = lines.filter((l) => l.closed && !l.quality.physicalSeamKink);
  const minAlignment = lines.length ? Math.min(...lines.map((l) => l.quality.alignmentP05)) : 0;
  const minSeamTangent = smoothClosed.length ? Math.min(...smoothClosed.map((l) => l.quality.seamTangent)) : 1;
  const maxSeamFactor = smoothClosed.length ? Math.max(...smoothClosed.map((l) => l.quality.seamFactor)) : 0;
  return {
    lines: lines.map((l) => l.pts), closedFlags: lines.map((l) => l.closed), closed, expectedOpen, total: lines.length, traceStats,
    quality: {
      passed: lines.length,
      total: lines.length,
      minAlignment,
      minSeamTangent,
      maxSeamFactor,
      maxTortuosity: lines.length ? Math.max(...lines.map((l) => l.quality.tortuosity)) : 0,
      physicalInterfaceKinks: lines.filter((l) => l.quality.physicalSeamKink).length,
    },
  };
}

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

/* ==================== 截面数学 ==================== */
const SECTION = { n: 'z', off: 0, rot: 0, show: false, only: false };

function computeSectionBasis() {
  let n;
  if (SECTION.n === 'x') n = new THREE.Vector3(1, 0, 0);
  else if (SECTION.n === 'y') n = new THREE.Vector3(0, 1, 0);
  else n = new THREE.Vector3(0, 0, 1);
  const rotAxis = SECTION.n === 'y' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  if (SECTION.rot) n.applyAxisAngle(rotAxis, (SECTION.rot * Math.PI) / 180);
  const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const U = new THREE.Vector3().crossVectors(n, ref).normalize();
  const V = new THREE.Vector3().crossVectors(n, U).normalize();
  return { n, U, V, center: n.clone().multiplyScalar(SECTION.off) };
}

function traceProjectedLine(evalB, sec, size, seedU, seedV, sign, step) {
  const half = size * 0.49;
  const pts = [];
  const dir = new THREE.Vector2();
  const k1 = new THREE.Vector2();
  const k2 = new THREE.Vector2();
  const k3 = new THREE.Vector2();
  const k4 = new THREE.Vector2();
  const startDir = new THREE.Vector2();
  const p3 = new THREE.Vector3();
  const directionAt = (u, v, target) => {
    p3.copy(sec.center).addScaledVector(sec.U, u).addScaledVector(sec.V, v);
    evalB(p3.x, p3.y, p3.z, _b);
    target.set(_b.dot(sec.U) * sign, _b.dot(sec.V) * sign);
    if (target.lengthSq() < 1e-14) return false;
    target.normalize();
    return true;
  };
  if (!directionAt(seedU, seedV, startDir)) return { pts, closed: false };
  let u = seedU, v = seedV;
  const addPoint = () => pts.push(sec.center.clone().addScaledVector(sec.U, u).addScaledVector(sec.V, v));
  addPoint();
  for (let i = 0; i < 1800; i++) {
    if (!directionAt(u, v, k1)) break;
    if (!directionAt(u + k1.x * step / 2, v + k1.y * step / 2, k2)) break;
    if (!directionAt(u + k2.x * step / 2, v + k2.y * step / 2, k3)) break;
    if (!directionAt(u + k3.x * step, v + k3.y * step, k4)) break;
    u += (step / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x);
    v += (step / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y);
    if (Math.abs(u) > half || Math.abs(v) > half) break;
    addPoint();
    if (i > 60 && Math.hypot(u - seedU, v - seedV) < step * 2.2 && directionAt(u, v, dir) && dir.dot(startDir) > 0.92) {
      pts.push(pts[0].clone());
      return { pts, closed: true };
    }
  }
  return { pts, closed: false };
}

function generateProjectedStreamlines(evalB, sec, size) {
  const lines = [];
  const occupied = [];
  const minSpacing = size / 18;
  const step = Math.max(0.018, size / 360);
  const candidates = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const offset = row % 2 ? 0.5 : 0;
      candidates.push([
        ((col + offset) / 8.5 - 0.5) * size * 0.84,
        (row / 8 - 0.5) * size * 0.84,
      ]);
    }
  }
  candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  for (const [u, v] of candidates) {
    if (lines.length >= 28) break;
    if (occupied.some(([ou, ov]) => Math.hypot(u - ou, v - ov) < minSpacing)) continue;
    const forward = traceProjectedLine(evalB, sec, size, u, v, 1, step);
    let pts = forward.pts;
    if (!forward.closed) {
      const backward = traceProjectedLine(evalB, sec, size, u, v, -1, step).pts;
      pts = backward.reverse().slice(0, -1).concat(forward.pts);
    }
    if (pts.length < 18) continue;
    const box = new THREE.Box3().setFromPoints(pts);
    if (box.getSize(_tmp).length() < size * 0.10) continue;
    lines.push(decimateLine(pts, forward.closed, 1200));
    for (let i = 0; i < pts.length; i += 16) {
      const rel = _b1.copy(pts[i]).sub(sec.center);
      occupied.push([rel.dot(sec.U), rel.dot(sec.V)]);
    }
  }
  return lines;
}

/* ==================== 热力图 ==================== */
function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.0, 30, 75, 120], [0.25, 15, 118, 110], [0.5, 99, 179, 160],
    [0.72, 217, 164, 65], [0.88, 185, 66, 74], [1.0, 155, 40, 55],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const s = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      const L = (a, b) => Math.round(a + (b - a) * s);
      return [L(stops[i][1], stops[i + 1][1]), L(stops[i][2], stops[i + 1][2]), L(stops[i][3], stops[i + 1][3])];
    }
  }
  return [155, 40, 55];
}

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

function makeHeatMap(evalB, sec, size, heatMask = null) {
  const S = HEAT_RES;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const vals = new Float32Array(S * S);
  const masked = new Uint8Array(S * S);
  let maxB = 0;
  for (let iy = 0; iy < S; iy++) {
    const v = (0.5 - iy / S) * size;
    for (let ix = 0; ix < S; ix++) {
      const u = (ix / S - 0.5) * size;
      const p = _tmp.copy(sec.center).addScaledVector(sec.U, u).addScaledVector(sec.V, v);
      const index = iy * S + ix;
      if (heatMask && heatMask(p.x, p.y, p.z)) {
        vals[index] = NaN;
        masked[index] = 1;
        continue;
      }
      evalB(p.x, p.y, p.z, _b);
      const m = _b.length();
      vals[index] = m;
      if (m > maxB) maxB = m;
    }
  }
  const sorted = Array.from(vals).filter(Number.isFinite).sort((a, b) => a - b);
  const scaleB = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] : 0;
  const logMax = Math.log(Math.max(scaleB, 1e-9) + 1);
  for (let i = 0; i < S * S; i++) {
    if (masked[i] || !Number.isFinite(vals[i])) {
      img.data[i * 4 + 3] = 0;
      continue;
    }
    const t = Math.pow(Math.min(1, Math.log(vals[i] + 1) / logMax), 0.72);
    const [r, g, bb] = heatColor(t);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = bb;
    img.data[i * 4 + 3] = 138;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const geom = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.54, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(sec.U, sec.V, sec.n).setPosition(sec.center);
  mesh.renderOrder = 1;
  return { mesh, maxB, scaleB };
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
  if (STATE.locked) return;          // 预测模式不泄露答案
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

function clearGroup(grp) {
  while (grp.children.length) {
    const c = grp.children[0];
    grp.remove(c);
    c.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
  }
}

function updateVisualization() {
  if (!currentScene) return;
  for (const g of [fieldGroup, arrowGroup, heatGroup, sourceGroup, sectionLineGroup, pickerGroup, vecGroup]) clearGroup(g);
  currentField = buildField(currentScene.id, currentParams);

  sourceGroup.add(createSources(currentScene.id, currentParams));

  const sec = computeSectionBasis();
  const size = currentScene.size;

  // 截面热力图 + 边框
  if (SECTION.show) {
    const heat = makeHeatMap(currentField.evalB, sec, size, currentField.heatMask);
    heatGroup.add(heat.mesh);
    currentStats.maxB = heat.scaleB;
    const heatMax = document.getElementById('heat-max');
    if (heatMax) heatMax.textContent = formatFieldValue(heat.scaleB);
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        sec.U.clone().multiplyScalar(-size / 2).add(sec.V.clone().multiplyScalar(-size / 2)).add(sec.center),
        sec.U.clone().multiplyScalar(size / 2).add(sec.V.clone().multiplyScalar(-size / 2)).add(sec.center),
        sec.U.clone().multiplyScalar(size / 2).add(sec.V.clone().multiplyScalar(size / 2)).add(sec.center),
        sec.U.clone().multiplyScalar(-size / 2).add(sec.V.clone().multiplyScalar(size / 2)).add(sec.center),
      ]),
      new THREE.LineBasicMaterial({ color: PAL.frame })
    );
    heatGroup.add(frame);
  } else {
    currentStats.maxB = 0;
    const heatMax = document.getElementById('heat-max');
    if (heatMax) heatMax.textContent = '--';
  }

  // 三维磁感线
  let genLines = [];
  if (!STATE.locked) {
    const gen = generateFieldLines(currentScene.id, currentParams, currentField);
    genLines = gen.lines;
    currentStats.closed = gen.closed;
    currentStats.expectedOpen = gen.expectedOpen;
    currentStats.total = gen.total;
    currentStats.quality = gen.quality;
    document.body.dataset.traceStats = JSON.stringify(gen.traceStats);
    document.body.dataset.lineQuality = JSON.stringify(gen.quality);
    for (let i = 0; i < gen.lines.length; i++) {
      fieldGroup.add(makeWideLine(gen.lines[i], PAL.line, gen.closedFlags[i] ? 2.25 : 2.0, !gen.closedFlags[i]));
    }
    const arrowSpecs = collectArrowSpecs(gen.lines, fieldArrowOptions(currentScene.id, currentParams));
    document.body.dataset.fieldArrows = String(arrowSpecs.length);
    const arrows = makeArrowMesh(arrowSpecs, PAL.line, 1);
    if (arrows) arrowGroup.add(arrows);
  } else {
    currentStats = { ...currentStats, closed: 0, expectedOpen: 0, total: 0, quality: null };
    document.body.dataset.fieldArrows = '0';
    document.body.dataset.traceStats = '{}';
    document.body.dataset.lineQuality = '{}';
  }

  // 仅截面模式：直接对面内投影场 B∥ = B − (B·n)n 做 RK4 积分。
  // 这些是真正的截面投影流线，不是对三维曲线的容差裁剪。
  if (SECTION.only && !STATE.locked) {
    const projected = generateProjectedStreamlines(currentField.evalB, sec, size);
    for (const pts of projected) {
      sectionLineGroup.add(makeWideLine(pts, PAL.line, 2.45));
    }
    const arrows = makeArrowMesh(collectArrowSpecs(projected, fieldArrowOptions(currentScene.id, currentParams)), PAL.line, 0.85);
    if (arrows) sectionLineGroup.add(arrows);
    document.body.dataset.sectionLines = String(projected.length);
  } else {
    document.body.dataset.sectionLines = '0';
  }

  applyVisibility();
  updateConsole();
}

function applyVisibility() {
  const show = !STATE.locked;
  const chk = (id) => { const el = document.getElementById(id); return !el || el.checked; };
  fieldGroup.visible = show && !SECTION.only && chk('t-fl');
  arrowGroup.visible = show && !SECTION.only && chk('t-fl') && chk('t-ar');
  heatGroup.visible = show && SECTION.show;
  sectionLineGroup.visible = show && SECTION.only && chk('t-fl');
  sourceGroup.visible = chk('t-src');
  helperGroup.visible = chk('t-grid');
  const heatLegend = document.querySelector('.heat-legend');
  if (heatLegend) heatLegend.style.display = show && SECTION.show ? 'flex' : 'none';
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
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { updateVisualization(); updateTimer = null; }, 150);
}

function loadScene(sceneId) {
  const def = SCENES.find((s) => s.id === sceneId);
  if (!def) return;
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
    STATE.locked = !STATE.locked;
    syncModeUI();
    updateVisualization();
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
    { id: 't-fl', label: '磁感线', checked: true, fn: () => applyVisibility() },
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
          <div class="metric-cell"><div class="metric-label">磁感线数量</div><div class="metric-value" id="m-lines">--</div></div>
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
  set('m-lines', STATE.locked ? '已隐藏' : `${currentStats.total}`);
  const geometryText = currentStats.expectedOpen
    ? `${currentStats.closed}闭合 + ${currentStats.expectedOpen}边界延伸`
    : `${currentStats.closed}/${currentStats.total}`;
  set('m-closed', STATE.locked ? '已隐藏' : geometryText);
  set('m-quality', STATE.locked ? '已隐藏' : (currentStats.quality
    ? `${currentStats.quality.passed}/${currentStats.quality.total} 通过`
    : '--'));
  set('m-maxb', STATE.locked ? '已隐藏' : (currentStats.maxB ? formatFieldValue(currentStats.maxB) : '--'));
  set('m-physics', STATE.locked ? '已隐藏' : (physicsValidationReport ? `${physicsValidationReport.passed}/${physicsValidationReport.total}` : '--'));
  const vl = document.getElementById('m-val');
  if (vl && currentScene) vl.textContent = currentScene.valueLine(currentParams);
  const status = document.getElementById('m-status');
  if (status) {
    if (STATE.locked) status.textContent = '预测模式 · 数值诊断已隐藏';
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
      ? '<strong>预测模式</strong><br>先让学生画出磁感线的分布<br>再点击左侧「揭示磁场分布」'
      : '';
    lock.classList.toggle('show', STATE.locked);
  }
  if (STATE.locked) {
    clearGroup(pickerGroup);
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
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
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
  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.mode-switch button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      STATE.mode = b.dataset.mode;
      STATE.locked = STATE.mode === 'student';
      syncModeUI();
      updateVisualization(); // 关键：切换模式后必须重新生成/清除磁感线
    };
  });
  document.getElementById('btn-reset').onclick = () => {
    if (currentScene && currentScene.camera) {
      camera.position.set(...currentScene.camera.pos);
      controls.target.set(...currentScene.camera.target);
      controls.update();
    }
  };
  document.getElementById('btn-fullscreen').onclick = () => {
    const c = document.querySelector('.canvas-card');
    if (!document.fullscreenElement) c.requestFullscreen().then(() => setTimeout(onResize, 120));
    else document.exitFullscreen().then(() => setTimeout(onResize, 120));
  };
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

function sampleModel(sceneId, overrides, point) {
  const def = SCENES.find((sceneDef) => sceneDef.id === sceneId);
  if (!def) throw new Error(`Unknown scene: ${sceneId}`);
  const params = Object.fromEntries(def.params.map((param) => [param.id, param.val]));
  Object.assign(params, overrides || {});
  const field = buildField(sceneId, params);
  const B = new THREE.Vector3();
  field.evalB(point[0], point[1], point[2], B);
  return { params, B: [B.x, B.y, B.z], magnitude: B.length() };
}

function runPhysicsValidation() {
  const checks = [];
  const add = (id, actual, expected, tolerance, detail = '') => {
    const scale = Math.max(Math.abs(expected), 1e-9);
    const relativeError = Math.abs(actual - expected) / scale;
    checks.push({ id, pass: relativeError <= tolerance, actual, expected, relativeError, detail });
  };
  const addCondition = (id, pass, actual, detail = '') => checks.push({ id, pass, actual, expected: true, relativeError: null, detail });

  const earthPole = sampleModel('earth', { tilt: 0, moment: 30 }, [0, -(EARTH_R + 1), 0]).magnitude;
  const earthEquator = sampleModel('earth', { tilt: 0, moment: 30 }, [EARTH_R + 1, 0, 0]).magnitude;
  add('earth.axis_to_equator_ratio', earthPole / earthEquator, 2, 0.005);
  const earthSurface = sampleModel('earth', { tilt: 0, moment: 30 }, [EARTH_R, 0, 0]).magnitude;
  add('earth.equatorial_surface_value', earthSurface, 30, 0.002, 'UI value is the equatorial surface field in μT');
  const earthInterior = sampleModel('earth', { tilt: 0, moment: 30 }, [0, 0, 0]);
  add('earth.core_center_value', earthInterior.magnitude, 150, 0.002);
  addCondition('earth.core_center_direction', earthInterior.B[1] < 0, earthInterior.B);
  const earthInsideSurface = sampleModel('earth', { tilt: 0, moment: 30 }, [EARTH_R - 1e-4, 0, 0]);
  const earthOutsideSurface = sampleModel('earth', { tilt: 0, moment: 30 }, [EARTH_R + 1e-4, 0, 0]);
  addCondition('earth.surface_vector_continuity', earthInsideSurface.B.every((v, i) => Math.abs(v - earthOutsideSurface.B[i]) < 0.02),
    [earthInsideSurface.B, earthOutsideSurface.B]);
  const divPoint = [0.7, -0.5, 0.4], dh = 1e-3;
  let divergence = 0;
  for (let axis = 0; axis < 3; axis++) {
    const lo = divPoint.slice(), hi = divPoint.slice();
    lo[axis] -= dh; hi[axis] += dh;
    divergence += (sampleModel('earth', { tilt: 11.5, moment: 30 }, hi).B[axis]
      - sampleModel('earth', { tilt: 11.5, moment: 30 }, lo).B[axis]) / (2 * dh);
  }
  addCondition('earth.core_divergence_free', Math.abs(divergence) < 0.01, divergence);

  const bentDefaults = { current: 50, width: 4, height: 5.5, direction: '左侧向上' };
  const bentRadius = 0.22;
  const bentLocal = sampleModel('bent-wire', bentDefaults, [-bentDefaults.width / 2 + bentRadius, 0, 0]);
  add('bent_wire.local_straight_limit', bentLocal.magnitude, (2 * bentDefaults.current) / bentRadius, 0.12,
    'Near a long visible segment, the complete circuit approaches the infinite-wire result');
  const bentHalfCurrent = sampleModel('bent-wire', { ...bentDefaults, current: 25 }, [-1.3, 0.2, 0.35]);
  const bentFullCurrent = sampleModel('bent-wire', bentDefaults, [-1.3, 0.2, 0.35]);
  add('bent_wire.current_linearity', bentFullCurrent.magnitude / bentHalfCurrent.magnitude, 2, 0.003);
  const bentReverse = sampleModel('bent-wire', { ...bentDefaults, direction: '左侧向下' }, [-1.3, 0.2, 0.35]);
  addCondition('bent_wire.reverse_direction', bentFullCurrent.B.every((v, i) => Math.abs(v + bentReverse.B[i]) < 1e-6),
    [bentFullCurrent.B, bentReverse.B]);
  const bentPath = buildBentWirePath(bentDefaults.width, bentDefaults.height);
  addCondition('bent_wire.closed_current_path', bentPath[0].distanceTo(bentPath[bentPath.length - 1]) < 1e-12, bentPath.length);

  const wireR1 = sampleModel('straight-wire', { current: 50, direction: '向上（+Y）' }, [1, 0, 0]).magnitude;
  const wireR2 = sampleModel('straight-wire', { current: 50, direction: '向上（+Y）' }, [2, 0, 0]).magnitude;
  add('wire.inverse_radius', wireR1 / wireR2, 2, 0.002);
  const wireI25 = sampleModel('straight-wire', { current: 25, direction: '向上（+Y）' }, [1, 0, 0]);
  const wireReverse = sampleModel('straight-wire', { current: 50, direction: '向下（−Y）' }, [1, 0, 0]);
  add('wire.current_linearity', wireR1 / wireI25.magnitude, 2, 0.002);
  addCondition('wire.reverse_direction', wireI25.B[2] * wireReverse.B[2] < 0, [wireI25.B, wireReverse.B]);
  const wireInside = sampleModel('straight-wire', { current: 50, direction: '向上（+Y）' }, [WIRE_RADIUS / 2, 0, 0]).magnitude;
  const wireSurface = sampleModel('straight-wire', { current: 50, direction: '向上（+Y）' }, [WIRE_RADIUS, 0, 0]).magnitude;
  add('wire.finite_core_linear', wireInside / wireSurface, 0.5, 0.002);
  const wireInsideEdge = sampleModel('straight-wire', { current: 50, direction: '向上（+Y）' }, [WIRE_RADIUS * 0.999, 0, 0]).magnitude;
  const wireOutsideEdge = sampleModel('straight-wire', { current: 50, direction: '向上（+Y）' }, [WIRE_RADIUS * 1.001, 0, 0]).magnitude;
  addCondition('wire.surface_continuity', Math.abs(wireInsideEdge - wireOutsideEdge) / wireSurface < 0.005, [wireInsideEdge, wireOutsideEdge]);

  const twoSame = sampleModel('two-wires', { current1: 50, current2: 50, spacing: 3, direction: '同向' }, [0, 0, 0]);
  add('two_wires.same_midpoint_zero', twoSame.magnitude, 0, 1e-6);
  const twoOpp = sampleModel('two-wires', { current1: 50, current2: 50, spacing: 3, direction: '反向' }, [0, 0, 0]);
  addCondition('two_wires.opposite_midpoint_adds', twoOpp.B[2] < 0 && twoOpp.magnitude > 100, twoOpp.B);
  const unequalParams = { current1: 30, current2: 70, spacing: 3, direction: '同向' };
  const unequalZeroX = (unequalParams.spacing / 2) * (unequalParams.current1 - unequalParams.current2)
    / (unequalParams.current1 + unequalParams.current2);
  const unequalZero = sampleModel('two-wires', unequalParams, [unequalZeroX, 0, 0]);
  addCondition('two_wires.unequal_zero_point', unequalZero.magnitude < 1e-9, unequalZero.B);
  const unequalMid = sampleModel('two-wires', unequalParams, [0, 0, 0]);
  addCondition('two_wires.unequal_midpoint_nonzero', unequalMid.magnitude > 1, unequalMid.B);
  const singleLeftSame = sampleModel('two-wires', { current1: 35, current2: 80, spacing: 3, direction: '同向', display: '仅左导线' }, [-0.5, 0, 0]);
  const singleLeftOpp = sampleModel('two-wires', { current1: 35, current2: 80, spacing: 3, direction: '反向', display: '仅左导线' }, [-0.5, 0, 0]);
  addCondition('two_wires.single_mode_direction_invariant', singleLeftSame.B.every((v, i) => Math.abs(v - singleLeftOpp.B[i]) < 1e-9), [singleLeftSame.B, singleLeftOpp.B]);

  const loop = sampleModel('loop', { current: 50, radius: 2, direction: '正向' }, [0, 0, 0]);
  add('loop.center_formula', loop.magnitude, 2 * Math.PI * 50 / 2, 0.005);
  addCondition('loop.north_matches_field', loop.B[1] < 0, loop.B);
  const loopReverse = sampleModel('loop', { current: 50, radius: 2, direction: '反向' }, [0, 0, 0]);
  addCondition('loop.reverse_direction', loopReverse.B[1] > 0 && Math.abs(loopReverse.magnitude - loop.magnitude) < 0.01, loopReverse.B);
  const loopAxis = sampleModel('loop', { current: 50, radius: 2, direction: '正向' }, [0, 1, 0]);
  const loopAxisExpected = 2 * Math.PI * 50 * 4 / Math.pow(5, 1.5);
  add('loop.axis_formula', loopAxis.magnitude, loopAxisExpected, 0.008);
  const loopCore = [-0.01, 0, 0.01].map((dx) => sampleModel('loop', { current: 50, radius: 2, direction: '正向' }, [2 + dx, 0, 0]).magnitude);
  addCondition('loop.finite_core_no_singularity', loopCore.every((v) => Number.isFinite(v) && v < 1200), loopCore);
  addCondition('loop.finite_core_continuity', Math.abs(loopCore[0] - loopCore[2]) < 800, loopCore);

  const barCenter = sampleModel('bar-magnet', { length: 4, strength: 150 }, [0, 0, 0]);
  const barNearNorth = sampleModel('bar-magnet', { length: 4, strength: 150 }, [0, 1.9, 0]);
  addCondition('bar.internal_s_to_n', barCenter.B[1] > 0 && barNearNorth.B[1] > 0, [barCenter.B[1], barNearNorth.B[1]]);
  const barLeft = sampleModel('bar-magnet', { length: 4, strength: 150 }, [-1.2, 0, 0]);
  const barRight = sampleModel('bar-magnet', { length: 4, strength: 150 }, [1.2, 0, 0]);
  add('bar.mirror_symmetry_magnitude', barLeft.magnitude / barRight.magnitude, 1, 0.002);
  addCondition('bar.equatorial_direction', barLeft.B[1] < 0 && barRight.B[1] < 0, [barLeft.B, barRight.B]);

  const solenoidDefaults = { current: 50, radius: 1.5, nLoops: 160, length: 5, direction: '正向（N 在 +Y）' };
  const solenoid = sampleModel('solenoid', solenoidDefaults, [0, 0, 0]);
  const idealFinite = MU0 * (160 / (5 * LENGTH_UNIT_M)) * 50 * TESLA_TO_MICROTESLA * 5 / Math.sqrt(25 + 9);
  add('solenoid.center_finite_formula', solenoid.magnitude, idealFinite, 0.008);
  addCondition('solenoid.internal_to_north', solenoid.B[1] > 0, solenoid.B);
  const solenoidHalfCurrent = sampleModel('solenoid', { ...solenoidDefaults, current: 25 }, [0, 0, 0]);
  add('solenoid.current_linearity', solenoid.magnitude / solenoidHalfCurrent.magnitude, 2, 0.002);
  const solenoidReverse = sampleModel('solenoid', { ...solenoidDefaults, direction: '反向（N 在 −Y）' }, [0, 0, 0]);
  addCondition('solenoid.reverse_direction', solenoidReverse.B[1] < 0 && Math.abs(solenoidReverse.magnitude / solenoid.magnitude - 1) < 0.002, solenoidReverse.B);
  const solenoidMiddle = sampleModel('solenoid', solenoidDefaults, [0, 0.5, 0]);
  const axisExpected = (y) => {
    const L = solenoidDefaults.length, R = solenoidDefaults.radius;
    const n = solenoidDefaults.nLoops / (L * LENGTH_UNIT_M);
    const upper = (y + L / 2) / Math.sqrt(R * R + (y + L / 2) ** 2);
    const lower = (y - L / 2) / Math.sqrt(R * R + (y - L / 2) ** 2);
    return (MU0 * n * solenoidDefaults.current * TESLA_TO_MICROTESLA / 2) * (upper - lower);
  };
  const solenoidNearEnd = sampleModel('solenoid', solenoidDefaults, [0, 2.0, 0]);
  const solenoidEnd = sampleModel('solenoid', solenoidDefaults, [0, 2.5, 0]);
  const solenoidEndInside = sampleModel('solenoid', solenoidDefaults, [0, 2.5 - 1e-3, 0]);
  const solenoidEndOutside = sampleModel('solenoid', solenoidDefaults, [0, 2.5 + 1e-3, 0]);
  const solenoidOutside = sampleModel('solenoid', solenoidDefaults, [0, 3.25, 0]);
  addCondition('solenoid.central_region_nearly_uniform', Math.abs(solenoidMiddle.magnitude / solenoid.magnitude - 1) < 0.08,
    [solenoid.magnitude, solenoidMiddle.magnitude]);
  add('solenoid.near_end_axis_formula', solenoidNearEnd.B[1], axisExpected(2.0), 0.012);
  add('solenoid.mouth_axis_formula', solenoidEnd.B[1], axisExpected(2.5), 0.012);
  addCondition('solenoid.mouth_continuity', solenoidEndInside.B[1] > 0 && solenoidEndOutside.B[1] > 0
    && Math.abs(solenoidEndInside.B[1] - solenoidEndOutside.B[1]) / solenoidEnd.magnitude < 0.012,
    [solenoidEndInside.B[1], solenoidEnd.B[1], solenoidEndOutside.B[1]]);
  addCondition('solenoid.axis_monotonic_to_mouth', solenoid.magnitude > solenoidNearEnd.magnitude
    && solenoidNearEnd.magnitude > solenoidEnd.magnitude && solenoidEnd.magnitude > solenoidOutside.magnitude,
    [solenoid.magnitude, solenoidNearEnd.magnitude, solenoidEnd.magnitude, solenoidOutside.magnitude]);

  for (const def of SCENES) {
    const base = Object.fromEntries(def.params.map((param) => [param.id, param.val]));
    const variants = [base];
    for (const param of def.params) {
      if (param.type === 'select') {
        for (const option of param.options) variants.push({ ...base, [param.id]: option });
      } else {
        variants.push({ ...base, [param.id]: param.min }, { ...base, [param.id]: param.max });
      }
    }
    let finite = true;
    let peak = 0;
    for (const params of variants) {
      const field = buildField(def.id, params);
      for (const point of [[0, 0, 0], [0.37, -0.29, 0.21], [2.7, 1.9, -1.4], [-3.1, 0.8, 2.2]]) {
        field.evalB(point[0], point[1], point[2], _b);
        peak = Math.max(peak, _b.length());
        if (![..._b].every(Number.isFinite) || _b.length() > 1e9) finite = false;
      }
    }
    addCondition(`${def.id}.parameter_extremes_finite`, finite, { variants: variants.length, peak });
  }

  return { passed: checks.filter((check) => check.pass).length, total: checks.length, checks };
}

function runGeometryValidation(sceneIds = SCENES.map((sceneDef) => sceneDef.id)) {
  const minimumLines = { earth: 14, 'bar-magnet': 10, 'bent-wire': 10, 'straight-wire': 18, 'two-wires': 18, loop: 16, solenoid: 12 };
  const checks = [];
  const started = performance.now();
  const selected = new Set(sceneIds);
  const cases = [];
  for (const sceneId of selected) cases.push({ id: sceneId, sceneId, overrides: {} });
  const addCase = (id, sceneId, overrides) => { if (selected.has(sceneId)) cases.push({ id, sceneId, overrides }); };
  addCase('earth.tilt_max', 'earth', { tilt: 25 });
  addCase('bar.length_min', 'bar-magnet', { length: 2 });
  addCase('bar.length_max', 'bar-magnet', { length: 3.5 });
  addCase('bent_wire.compact', 'bent-wire', { width: 2.5, height: 4 });
  addCase('bent_wire.large_reverse', 'bent-wire', { width: 5, height: 7, direction: '左侧向下' });
  addCase('wire.reverse', 'straight-wire', { direction: '向下（−Y）' });
  addCase('two_wires.opposite', 'two-wires', { direction: '反向' });
  addCase('two_wires.single_right', 'two-wires', { direction: '反向', display: '仅右导线' });
  addCase('two_wires.spacing_max', 'two-wires', { spacing: 5 });
  addCase('two_wires.unequal_same', 'two-wires', { current1: 25, current2: 80, direction: '同向' });
  addCase('two_wires.unequal_opposite', 'two-wires', { current1: 80, current2: 25, direction: '反向' });
  addCase('loop.radius_min', 'loop', { radius: 1 });
  addCase('loop.radius_max_reverse', 'loop', { radius: 4, direction: '反向' });
  addCase('solenoid.reverse', 'solenoid', { direction: '反向（N 在 −Y）' });
  addCase('solenoid.short_wide', 'solenoid', { radius: 1.75, length: 4, nLoops: 50 });
  addCase('solenoid.long_narrow', 'solenoid', { radius: 1, length: 8, nLoops: 300 });
  for (const validationCase of cases) {
    const { id, sceneId, overrides } = validationCase;
    const def = SCENES.find((sceneDef) => sceneDef.id === sceneId);
    if (!def) continue;
    const params = Object.fromEntries(def.params.map((param) => [param.id, param.val]));
    Object.assign(params, overrides);
    const field = buildField(sceneId, params);
    const generated = generateFieldLines(sceneId, params, field);
    const minimum = id === 'two_wires.single_right' ? 15 : minimumLines[sceneId];
    const pass = generated.total >= minimum
      && generated.closed + generated.expectedOpen === generated.total
      && generated.quality.passed === generated.total;
    checks.push({
      id,
      sceneId,
      overrides,
      pass,
      lines: generated.total,
      minimum,
      closed: generated.closed,
      expectedOpen: generated.expectedOpen,
      quality: generated.quality,
      traceStats: generated.traceStats,
    });
  }
  return {
    passed: checks.filter((check) => check.pass).length,
    total: checks.length,
    durationMs: Math.round(performance.now() - started),
    checks,
  };
}

window.__MAGNETIC_LAB__ = {
  constants: { MU0, LENGTH_UNIT_M, WIRE_RADIUS, LOOP_WIRE_RADIUS },
  sample: sampleModel,
  scenes: SCENES.map(s => ({id:s.id,params:s.params})),
  validate: runPhysicsValidation,
  validateGeometry: runGeometryValidation,
};

init();
