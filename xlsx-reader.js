import {unzipSync,strFromU8} from './vendor/fflate.js';
const elements=(root,name)=>[...root.getElementsByTagNameNS('*',name)];
function xml(bytes){if(!bytes)throw new Error('Excel缺少必要的工作表文件。');const d=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');if(elements(d,'parsererror').length)throw new Error('Excel文件结构损坏。');return d;}
export function readXlsx(buffer){
 const zip=unzipSync(new Uint8Array(buffer),{filter:f=>f.name.startsWith('xl/')&&f.name.endsWith('.xml')&&f.originalSize<12000000});
 const strings=zip['xl/sharedStrings.xml']?elements(xml(zip['xl/sharedStrings.xml']),'si').map(si=>elements(si,'t').map(t=>t.textContent).join('')):[];
 const workbook=xml(zip['xl/workbook.xml']);
 // .rels files do not end in .xml; read relationship explicitly.
 const relsZip=unzipSync(new Uint8Array(buffer),{filter:f=>f.name==='xl/_rels/workbook.xml.rels'});
 const rels=elements(xml(relsZip['xl/_rels/workbook.xml.rels']),'Relationship');
 const relMap=new Map(rels.map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
 return elements(workbook,'sheet').map(sheet=>{
  const id=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
  let target=relMap.get(id);if(!target)throw new Error('Excel工作表引用缺失。');
  target=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
  const parts=[];for(const p of target.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p);}target=parts.join('/');
  const rows=elements(xml(zip[target]),'row').map((row,i)=>{
   const values=[];
   for(const c of elements(row,'c')){
    const ref=c.getAttribute('r')||'',letters=ref.match(/^[A-Z]+/i)?.[0];if(!letters)continue;
    let col=0;for(const ch of letters.toUpperCase())col=col*26+ch.charCodeAt(0)-64;
    if(col>100)throw new Error('工作表列数超出预期。请选择五列磁场数据表。');
    const type=c.getAttribute('t'),raw=elements(c,'v')[0]?.textContent;
    values[col-1]=type==='s'?strings[Number(raw)]:(type==='inlineStr'?elements(c,'t').map(t=>t.textContent).join(''):
      type==='b'?'布尔值无效':raw??(elements(c,'f').length?'未计算公式':''));
   }
   return {rowNumber:Number(row.getAttribute('r')||i+1),values};
  });
  // The header is required on Excel row 1, not merely the first non-empty row.
  if(rows[0]?.rowNumber!==1)rows.unshift({rowNumber:1,values:[]});
  return {name:sheet.getAttribute('name'),rows};
 });
}
