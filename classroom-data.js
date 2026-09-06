export const HEADERS = ['横x桌', '纵y桌', 'bx', 'by', 'bz'];
export const keyOf = r => `${r.col}-${r.row}`;
export const magnitude = r => Math.hypot(r.bx, r.by, r.bz);
export function vectorInfo(r) {
  const total = magnitude(r), horizontal = Math.hypot(r.bx,r.by);
  return { total, horizontal, inclination: total === 0 ? null : Math.atan2(-r.bz,horizontal)*180/Math.PI,
    unstable: total > 0 && total < 0.1 };
}
export function colorRange(records, locked=null) {
  const values=records.map(magnitude), min=Math.min(...values), max=Math.max(...values);
  if(!values.length) return {min:0,max:0,span:0,low:0,high:100};
  // A minimum 20 μT scale span keeps instrument noise from looking like a large anomaly.
  const mid=(min+max)/2, span=Math.max(20,max-min), low=Math.max(0,mid-span/2);
  return {min,max,span:max-min,low:locked?.[0]??low,high:locked?.[1]??(low+span)};
}
export function validateRows(rows) {
  const errors=[], records=[], seen=new Set();
  if(!rows.length) return {errors:['工作表为空。请使用五列表头模板。'],records:[]};
  const head=rows[0].values.map(v=>String(v??'').trim().toLowerCase());
  if(HEADERS.some((h,i)=>head[i]!==h)||head.slice(5).some(Boolean))
    return {errors:['第1行表头应依次为：横x桌、纵y桌、bx、by、bz。请勿在数据表添加其他列。'],records:[]};
  for(const {rowNumber,values:v} of rows.slice(1)){
    if(v.every(x=>x===null||x===undefined||String(x).trim()===''))continue;
    const prefix=`第${rowNumber}行`;
    if(v.slice(5).some(x=>x!=null&&String(x).trim()!=='')){errors.push(`${prefix}：五列以外还有数据。`);continue;}
    const a=HEADERS.map((_,i)=>v[i]);
    if(a.some(x=>x==null||String(x).trim()==='')){errors.push(`${prefix}：桌位和三个分量必须完整，不能用空白代替零。`);continue;}
    if(a.some(x=>typeof x==='boolean'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(String(x).trim()))){errors.push(`${prefix}：请填写有效数字，不附带单位或未计算的公式。`);continue;}
    const [col,row,bx,by,bz]=a.map(Number);
    if(![col,row,bx,by,bz].every(Number.isFinite)){errors.push(`${prefix}：存在非有限数值。`);continue;}
    if(!Number.isSafeInteger(col)||!Number.isSafeInteger(row)||col<1||row<1){errors.push(`${prefix}：横x桌和纵y桌必须是从1开始的正整数。`);continue;}
    const r={col,row,bx,by,bz},key=keyOf(r);
    if(seen.has(key)){errors.push(`${prefix}：第${row}排第${col}列重复，请在Excel中核对后重新导入。`);continue;}
    if(!Number.isFinite(magnitude(r))){errors.push(`${prefix}：磁场数值过大，无法计算。`);continue;}
    seen.add(key);records.push(r);
  }
  if(!errors.length&&!records.length)errors.push('表头正确，但还没有测量数据。填写后再上传。');
  if(records.length&&Math.max(...records.map(r=>r.row))*Math.max(...records.map(r=>r.col))>10000)errors.push('桌位网格超过10000格，请核对是否误填了桌位编号。');
  return {errors,records:errors.length?[]:records};
}
export function parseCSV(text){
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  const rows=lines.map((l,i)=>({rowNumber:i+1,values:l.split(',').map(v=>v.trim().replace(/^"|"$/g,''))}));
  // Preserve the previous version's row,col CSV format.
  if(rows[0]?.values.slice(0,2).join(',').toLowerCase()==='row,col'){
    rows[0].values=HEADERS;
    for(const r of rows.slice(1))if(r.values.length>=5)[r.values[0],r.values[1]]=[r.values[1],r.values[0]];
  }
  return rows;
}
export const toCSV=records=>'\uFEFF'+[HEADERS.join(','),...records.map(r=>[r.col,r.row,r.bx,r.by,r.bz].join(','))].join('\r\n');
export function demoRecords(n=48){return Array.from({length:n},(_,i)=>({col:i% (n===100?10:8)+1,row:Math.floor(i/(n===100?10:8))+1,
  bx:+(2+0.25*Math.sin(i)).toFixed(2),by:+(28+0.35*Math.cos(i)).toFixed(2),bz:+(-42+0.3*Math.sin(i*2)).toFixed(2)}));}
// ENU (east,north,up) to Three.js (x right,y up,z toward viewer).
export const worldVector=r=>[r.bx,r.bz,-r.by];
export function deskPosition(col,row,cols,rows,heading=0){
 const x=(col-(cols+1)/2)*1.5,z=(row-(rows+1)/2)*1.5,a=heading*Math.PI/180;
 return [x*Math.cos(a)-z*Math.sin(a),0,x*Math.sin(a)+z*Math.cos(a)];
}
