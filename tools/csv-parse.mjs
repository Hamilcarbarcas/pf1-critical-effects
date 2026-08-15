/* Minimal RFC 4180 CSV reader, shared by the spreadsheet-reading tools.
 *
 * Quoted fields may contain commas, newlines and doubled quotes — Excel's export uses all three.
 */
import fs from "node:fs";

export function parseCSV(str){const rows=[];let row=[],f='',q=false;
 for(let i=0;i<str.length;i++){const c=str[i];
  if(q){ if(c==='"'){ if(str[i+1]==='"'){f+='"';i++;} else q=false;} else f+=c; }
  else { if(c==='"')q=true; else if(c===','){row.push(f);f='';} else if(c==='\r'){}
  else if(c==='\n'){row.push(f);f='';rows.push(row);row=[];} else f+=c; } }
 if(f.length||row.length){row.push(f);rows.push(row);} return rows;}
export function load(p){
 const s=fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');
 const rows=parseCSV(s).filter(r=>r.some(c=>c.trim()!==''));
 const H=rows[0];
 const key=["effect","description","damage","buff","condition","save","saveCondition","saveBuff","location","human","beast","aber","severity","B","P","S","other"];
 return rows.slice(1).map(r=>Object.fromEntries(key.map((k,i)=>[k,(r[i]??'').trim()])));
}
