import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {HEADERS,keyOf,magnitude,vectorInfo,colorRange,validateRows,parseCSV,toCSV,demoRecords,worldVector,deskPosition} from './classroom-data.js';
import {readXlsx} from './xlsx-reader.js';
const $=id=>document.getElementById(id),stage=$('stage');
const state={records:[],rows:6,cols:8,heading:0,view:'oblique',selected:null,hover:null,marked:new Set(),locked:null,source:'',lastImportMs:null};
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf7fafc);stage.appendChild(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,2000),controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.85;controls.minDistance=3;controls.maxDistance=200;
let group=new THREE.Group();scene.add(group);const pickables=[],meshes=new Map(),raycaster=new THREE.Raycaster();
const stops=['#440154','#3b528b','#21918c','#5ec962','#fde725'].map(c=>new THREE.Color(c));
function heatColor(t){t=Math.max(0,Math.min(1,t));const x=t*4,i=Math.min(3,Math.floor(x));return stops[i].clone().lerp(stops[i+1],x-i);}
function dispose(object){object.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});}
function label(text,pos,size=.44,color='#375667'){
 const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');ctx.clearRect(0,0,512,96);ctx.fillStyle=color;ctx.font='600 42px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';if(color==='#FFFFFF'){ctx.strokeStyle='#173744';ctx.lineWidth=4;ctx.strokeText(text,256,48);}ctx.fillText(text,256,48);
 const tex=new THREE.CanvasTexture(c),s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false}));s.position.copy(pos);s.scale.set(size*5.33,size,1);group.add(s);return s;
}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);
function fit(view=state.view){
 state.view=view;const span=Math.max(state.rows,state.cols)*1.5;const aspect=stage.clientWidth/stage.clientHeight;
 const distance=Math.max(8,span/(2*Math.tan(THREE.MathUtils.degToRad(19)))*Math.max(1,1/aspect)*1.15);
 const a=state.heading*Math.PI/180;
 let v=view==='top'?new THREE.Vector3(0,distance,.0001):view==='side'?new THREE.Vector3(distance*.9,distance*.26,distance*.15):new THREE.Vector3(distance*.18,distance*.75,distance*.88);
 v.applyAxisAngle(new THREE.Vector3(0,1,0),-a);camera.up.set(0,1,0);controls.target.set(0,.35,0);
 const corners=[];for(const col of [0,state.cols+1])for(const row of [-.5,state.rows+1])for(const y of [0,2])corners.push(new THREE.Vector3(...deskPosition(col,row,state.cols,state.rows,state.heading)).add(new THREE.Vector3(0,y,0)));
 corners.push(new THREE.Vector3(-Math.max(state.cols,state.rows)*.78,0,-Math.max(state.cols,state.rows)*.7-2));
 for(let iteration=0;iteration<4;iteration++){
  camera.position.copy(v).add(controls.target);camera.lookAt(controls.target);camera.updateMatrixWorld();
  const projected=corners.map(p=>p.clone().project(camera));const used=Math.max(...projected.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y))));v.multiplyScalar(Math.max(.65,Math.min(1.5,used/.89)));
 }
 camera.position.copy(v).add(controls.target);camera.lookAt(controls.target);controls.update();
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
 $('view-note').textContent=view==='top'?'俯视为水平投影，Bz仍保留 · 侧视观察竖直方向':'拖动旋转 · 滚轮缩放 · 点击固定桌位';
}
function draw(){
 scene.remove(group);dispose(group);group=new THREE.Group();scene.add(group);pickables.length=0;meshes.clear();
 const records=new Map(state.records.map(r=>[keyOf(r),r])), range=colorRange(state.records,state.locked);
 const heading=state.heading;
 for(let row=1;row<=state.rows;row++)for(let col=1;col<=state.cols;col++){
  const key=`${col}-${row}`,r=records.get(key),pos=new THREE.Vector3(...deskPosition(col,row,state.cols,state.rows,heading));
  const color=r?heatColor((magnitude(r)-range.low)/(range.high-range.low)):new THREE.Color('#e5ebf0');
  const tile=new THREE.Mesh(new THREE.BoxGeometry(1.16,.08,1.04),new THREE.MeshBasicMaterial({color}));tile.position.copy(pos);tile.rotation.y=-heading*Math.PI/180;tile.userData={key,r,col,row};group.add(tile);pickables.push(tile);
  const outline=new THREE.LineSegments(new THREE.EdgesGeometry(tile.geometry),new THREE.LineBasicMaterial({color:'#afc1cc'}));outline.position.copy(pos);outline.rotation.copy(tile.rotation);group.add(outline);
  let arrow=null;
  if(r&&magnitude(r)>0){arrow=new THREE.Group();const material=new THREE.MeshBasicMaterial({color:0x173f54});const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.65,8),material);shaft.position.y=.325;const head=new THREE.Mesh(new THREE.ConeGeometry(.085,.25,12),material);head.position.y=.775;arrow.add(shaft,head);arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...worldVector(r)).normalize());arrow.position.copy(pos).add(new THREE.Vector3(0,1.02,0));arrow.setColor=c=>material.color.set(c);group.add(arrow);}
  label(`${row}排${col}列`,pos.clone().add(new THREE.Vector3(0,-.13,0)),.58,r?'#FFFFFF':'#405463');
  if(state.marked.has(key))label('待复测',pos.clone().add(new THREE.Vector3(0,1.7,0)),.29,'#9e530d');
  meshes.set(key,{tile,outline,arrow,color});
 }
 const front=new THREE.Vector3(...deskPosition((state.cols+1)/2,0,state.cols,state.rows,heading));label('讲台',front,.5);
 const north=new THREE.Vector3(-Math.max(state.cols,state.rows)*.78,0,-Math.max(state.cols,state.rows)*.7);
 const northArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),north,1.5,0x206b83,.3,.18);group.add(northArrow);label('北 N',north.clone().add(new THREE.Vector3(0,.2,-1.85)),.36);
 $('empty-state').style.display=state.records.length?'none':'grid';$('stat-count').textContent=state.records.length;
 for(const [id,value] of [['stat-min',range.min],['stat-max',range.max],['stat-range',range.span]])$(id).textContent=state.records.length?`${value.toFixed(2)} μT`:'—';
 $('scale-low').textContent=`${range.low.toFixed(1)} μT`;$('scale-high').textContent=`${range.high.toFixed(1)} μT`;
 $('present-scale-low').textContent=$('scale-low').textContent;$('present-scale-high').textContent=$('scale-high').textContent;
 $('source-label').textContent=state.source||'上传后显示本次数据';$('rows').value=state.rows;$('cols').value=state.cols;
 refreshSelection();renderer.render(scene,camera);
}
function refreshSelection(){
 const key=state.hover||state.selected;
 for(const [k,m]of meshes){const active=k===key;m.outline.material.color.set(active?'#df7314':'#afc1cc');m.arrow?.setColor(active?0xe87716:0x173f54);m.tile.material.color.copy(m.color);if(active)m.tile.material.color.lerp(new THREE.Color('#ffffff'),.18);}
 const entry=meshes.get(key)?.tile.userData,r=entry?.r;
 if(!entry){$('selected-title').textContent='选择一个桌位';$('selected-data').textContent='悬停查看，点击固定详情。';$('mark-point').disabled=true;return;}
 $('selected-title').textContent=`第${entry.row}排 第${entry.col}列${state.selected===key?' · 已固定':''}`;
 $('mark-point').disabled=!r;$('mark-point').textContent=state.marked.has(key)?'取消待复测标记':'标记待复测';
 if(!r){$('selected-data').textContent='未采样。缺失数据未补零。';return;}
 const info=vectorInfo(r);$('selected-data').textContent=`Bx ${r.bx.toFixed(2)} · By ${r.by.toFixed(2)} · Bz ${r.bz.toFixed(2)} μT   |B| ${info.total.toFixed(2)} μT   磁倾角 ${info.inclination===null?'未定义':info.inclination.toFixed(1)+'°（向下为正）'}${info.unstable?' · 小于0.1 μT，方向易受噪声影响':''}`;
}
function hit(e){const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);return raycaster.intersectObjects(pickables)[0]?.object.userData.key||null;}
renderer.domElement.addEventListener('pointermove',e=>{state.hover=hit(e);renderer.domElement.style.cursor=state.hover?'pointer':'grab';refreshSelection();});
renderer.domElement.addEventListener('pointerleave',()=>{state.hover=null;refreshSelection();});
let down=null;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('click',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<7){state.selected=hit(e);state.hover=null;refreshSelection();}});
$('unpin').onclick=()=>{state.selected=null;state.hover=null;refreshSelection();};
$('mark-point').onclick=()=>{const key=state.hover||state.selected;if(!key)return;state.marked.has(key)?state.marked.delete(key):state.marked.add(key);state.selected=key;draw();};
function showErrors(errors){$('errors').replaceChildren(...errors.map(msg=>{const li=document.createElement('li');li.textContent=msg;return li;}));$('errors').hidden=!errors.length;}
function persist(){try{localStorage.setItem('magnetic-classroom-map-v2',JSON.stringify({records:state.records,source:state.source,heading:state.heading,rows:state.rows,cols:state.cols}));}catch{}}
function table(){const body=$('records-body');body.replaceChildren();for(const r of state.records.slice().sort((a,b)=>a.row-b.row||a.col-b.col)){
 const tr=document.createElement('tr'),td=document.createElement('td'),b=document.createElement('button');b.textContent=`${r.row}排${r.col}列`;b.onclick=()=>{state.selected=keyOf(r);state.hover=null;refreshSelection();};td.append(b);tr.append(td);
 for(const n of [r.bx,r.by,r.bz,magnitude(r)]){const c=document.createElement('td');c.textContent=n.toFixed(2);tr.append(c);}body.append(tr);
}}
function accept(rows,source,start=performance.now()){
 const result=validateRows(rows);showErrors(result.errors);
 if(result.errors.length){$('import-status').textContent=`导入未完成，原数据保持不变。请修正${result.errors.length}项问题。`;return false;}
 state.records=result.records;state.source=source;state.rows=Math.max(...state.records.map(r=>r.row));state.cols=Math.max(...state.records.map(r=>r.col));state.selected=null;state.hover=null;state.marked.clear();
 fit();draw();table();persist();state.lastImportMs=performance.now()-start;
 const extreme=state.records.filter(r=>magnitude(r)>1000).length;
 $('import-status').textContent=`已导入 ${state.records.length} 桌 · ${state.rows}排 × ${state.cols}列${extreme?' · '+extreme+'桌超过1000 μT，已保留，请复核单位及环境':''}`;
 document.body.dataset.importState='ready';return true;
}
function rowsFrom(records){return [{rowNumber:1,values:HEADERS},...records.map((r,i)=>({rowNumber:i+2,values:[r.col,r.row,r.bx,r.by,r.bz]}))];}
let workbookSheets=[],pendingName='';
$('file-input').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;const start=performance.now();pendingName=file.name;
 try{
  if(file.size>16000000)throw new Error('文件超过16 MB，请只保留课堂数据再上传。');
  if(file.name.toLowerCase().endsWith('.csv')){ $('sheet-choice').hidden=true;accept(parseCSV(await file.text()),`导入文件：${file.name}`,start);}
  else if(file.name.toLowerCase().endsWith('.xlsx')){
   workbookSheets=readXlsx(await file.arrayBuffer());const preferred=workbookSheets.find(s=>s.name==='磁场数据');
   $('sheet-select').replaceChildren(...workbookSheets.map((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.name;return o;}));
   $('sheet-choice').hidden=Boolean(preferred)||workbookSheets.length===1;
   if(preferred||workbookSheets.length===1)accept((preferred||workbookSheets[0]).rows,`导入文件：${file.name}`,start);
   else $('import-status').textContent='请选择包含五列磁场数据的工作表。';
  }else throw new Error('请选择.xlsx或.csv文件。');
 }catch(err){showErrors([err.message]);$('import-status').textContent='读取失败，原数据保持不变。';}
 e.target.value='';
});
$('import-sheet').onclick=()=>accept(workbookSheets[Number($('sheet-select').value)].rows,`导入文件：${pendingName}`);
$('load-demo').onclick=()=>accept(rowsFrom(demoRecords()),'模拟示例 · 非课堂实测');
for(const id of ['rows','cols'])$(id).onchange=()=>{
 const n=Number($(id).value),min=state.records.length?Math.max(...state.records.map(r=>r[id==='rows'?'row':'col'])):1;
 if(!Number.isInteger(n)||n<min||n>100||n*(id==='rows'?state.cols:state.rows)>10000){$(id).value=state[id];showErrors([`总${id==='rows'?'排':'列'}数须为${min}至100，且不能裁掉已有数据。`]);return;}
 showErrors([]);state[id]=n;draw();fit();persist();
};
$('heading').oninput=e=>{state.heading=Number(e.target.value);$('heading-value').textContent=`${state.heading}°`;draw();fit();persist();};
$('lock-scale').onchange=e=>{const r=colorRange(state.records,state.locked);state.locked=e.target.checked?[r.low,r.high]:null;draw();};
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>fit(b.dataset.view);
$('reset-view').onclick=()=>fit('oblique');
$('fullscreen').onclick=async()=>{if(document.fullscreenElement){await document.exitFullscreen();}else{document.body.classList.add('presenting');try{await document.documentElement.requestFullscreen();}catch{document.body.classList.toggle('presenting');}}resize();fit();};
document.addEventListener('fullscreenchange',()=>{document.body.classList.toggle('presenting',Boolean(document.fullscreenElement));$('fullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏';resize();fit();});
$('manual-form').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target),r=Object.fromEntries(['col','row','bx','by','bz'].map(k=>[k,Number(fd.get(k))]));accept(rowsFrom([...state.records,r]),state.source?state.source+'（含补录）':'手工采集');};
$('export-csv').onclick=()=>{if(!state.records.length){showErrors(['没有可导出的数据。']);return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([toCSV(state.records)],{type:'text/csv;charset=utf-8'}));a.download='教室磁场数据.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);};
$('clear-data').onclick=()=>{state.records=[];state.source='';state.selected=null;state.hover=null;state.marked.clear();state.locked=null;$('lock-scale').checked=false;showErrors([]);draw();table();persist();$('import-status').textContent='当前数据已清空，可重新上传原文件。';};
try{const saved=JSON.parse(localStorage.getItem('magnetic-classroom-map-v2')||'null');if(saved?.records?.length&&validateRows(rowsFrom(saved.records)).errors.length===0){Object.assign(state,{records:saved.records,source:saved.source+' · 本机保存',rows:saved.rows,cols:saved.cols,heading:saved.heading||0});$('heading').value=state.heading;$('heading-value').textContent=state.heading+'°';$('import-status').textContent=`已恢复本机保存的${state.records.length}桌数据`;table();}}catch{}
resize();fit();draw();
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();
window.__CLASSROOM_MAP__={state,accept,rowsFrom,fit,renderer,scene,camera,meshes,screenshot:()=>renderer.domElement.toDataURL('image/png'),project:(col,row)=>{const p=new THREE.Vector3(...deskPosition(col,row,state.cols,state.rows,state.heading)).project(camera);const rect=renderer.domElement.getBoundingClientRect();return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};}};
