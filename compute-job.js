import * as THREE from './vendor/three.module.js';
import {buildField, generateFieldLines, computeSectionBasis, generateProjectedStreamlines, HEAT_RES, heatColor} from './field-core.js';

// Pure numerical work, shared by the module worker and numerical regression tests.
// No DOM, rendering, or shared UI state is accessed here.
export function computeHeatData(field, section, size) {
  const S = HEAT_RES, values = new Float32Array(S * S), pixels = new Uint8ClampedArray(S * S * 4);
  const point = new THREE.Vector3(), vector = new THREE.Vector3();
  let maxB = 0;
  for (let row = 0; row < S; row++) for (let col = 0; col < S; col++) {
    point.copy(section.center).addScaledVector(section.U, (col / S - .5) * size).addScaledVector(section.V, (.5 - row / S) * size);
    const i = row * S + col;
    if (field.heatMask?.(point.x, point.y, point.z)) { values[i] = NaN; continue; }
    field.evalB(point.x, point.y, point.z, vector);
    values[i] = vector.length();
    maxB = Math.max(maxB, values[i]);
  }
  const sorted = Array.from(values).filter(Number.isFinite).sort((a,b) => a-b);
  const scaleB = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .98))] : 0;
  const logMax = Math.log(Math.max(scaleB, 1e-9) + 1);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    const t = Math.pow(Math.min(1, Math.log(values[i] + 1) / logMax), .72);
    pixels.set([...heatColor(t), 138], i * 4);
  }
  return {pixels, resolution:S, maxB, scaleB};
}

function pack(lines) {
  return lines.map(points => {
    const data = new Float32Array(points.length * 3);
    points.forEach((p,i) => { data[i*3] = p.x; data[i*3+1] = p.y; data[i*3+2] = p.z; });
    return data;
  });
}

export function computeJob({sceneId, params, section, size, kinds}) {
  const start = performance.now(), field = buildField(sceneId, params), result = {};
  if (!field) throw new Error('未知磁场场景');
  if (kinds.includes('field')) {
    const generated = generateFieldLines(sceneId, params, field);
    result.field = {...generated, lines:pack(generated.lines)};
  }
  if (kinds.includes('heat')) result.heat = computeHeatData(field, computeSectionBasis(section), size);
  if (kinds.includes('section')) result.section = {lines:pack(generateProjectedStreamlines(field.evalB, computeSectionBasis(section), size, field))};
  result.computeMs = performance.now() - start;
  return result;
}

export function transferables(result) {
  return [...(result.field?.lines || []), ...(result.section?.lines || []), ...(result.heat ? [result.heat.pixels] : [])].map(data => data.buffer);
}
