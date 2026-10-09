const OFFLINE_FILE_DB='vina_offline_files_v1';
function offlineFileDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(OFFLINE_FILE_DB,1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('files',{keyPath:'id'});s.createIndex('owner','owner')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function optimizeQueuedImage(file){
 if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size<900*1024)return file;
 try{
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});const scale=Math.min(1,2560/Math.max(bitmap.width,bitmap.height));
  if(scale===1&&file.size<3*1024*1024){bitmap.close();return file}
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const type=file.type==='image/png'&&file.size<3*1024*1024?'image/png':'image/jpeg';const blob=await new Promise(r=>canvas.toBlob(r,type,type==='image/jpeg'?.86:undefined));
  if(!blob||blob.size>=file.size)return file;const base=file.name.replace(/\.[^.]+$/,'');return new File([blob],base+(type==='image/jpeg'?'.jpg':'.png'),{type,lastModified:file.lastModified})
 }catch(_){return file}
}
async function queueOfflineFiles(ownerType,ownerId,entries){
 const dbx=await offlineFileDb(),ids=[];
 for(const entry of entries){let file=entry.file;if(entry.kind==='PHOTO')file=await optimizeQueuedImage(file);const row={id:crypto.randomUUID(),owner:ownerType+':'+ownerId,ownerType,ownerId,kind:entry.kind,category:entry.category||'Tài liệu',name:file.name,type:file.type||'application/octet-stream',size:file.size,blob:file,createdAt:new Date().toISOString()};await new Promise((ok,no)=>{
  const t=dbx.transaction('files','readwrite'),s=t.objectStore('files'),r=s.index('owner').getAll(row.owner);
  r.onsuccess=()=>{const rows=r.result||[];row.sequence=rows.reduce((max,x)=>Number.isSafeInteger(x.sequence)?Math.max(max,x.sequence):max,rows.length)+1;s.put(row)};
  t.oncomplete=ok;t.onerror=()=>no(t.error);t.onabort=()=>no(t.error);
 });ids.push(row.id)}
 dbx.close();window.dispatchEvent(new Event('vina-file-queue-changed'));return ids
}
async function queuedFiles(ownerType,ownerId){const dbx=await offlineFileDb();const rows=await new Promise((ok,no)=>{const r=dbx.transaction('files').objectStore('files').index('owner').getAll(ownerType+':'+ownerId);r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error)});dbx.close();return rows.sort((a,b)=>{const sa=Number.isSafeInteger(a.sequence),sb=Number.isSafeInteger(b.sequence);if(sa&&sb)return a.sequence-b.sequence;if(sa!==sb)return sa?1:-1;return String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id))})}
async function queuedFile(id){const dbx=await offlineFileDb();const row=await new Promise((ok,no)=>{const r=dbx.transaction('files').objectStore('files').get(id);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});dbx.close();return row}
async function removeQueuedFile(id){const dbx=await offlineFileDb();await new Promise((ok,no)=>{const t=dbx.transaction('files','readwrite');t.objectStore('files').delete(id);t.oncomplete=ok;t.onerror=()=>no(t.error)});dbx.close();window.dispatchEvent(new Event('vina-file-queue-changed'))}
async function queuedFileCount(ownerType,ownerId){return (await queuedFiles(ownerType,ownerId)).length}
async function totalQueuedFileCount(){const dbx=await offlineFileDb();const count=await new Promise((ok,no)=>{const r=dbx.transaction('files').objectStore('files').count();r.onsuccess=()=>ok(r.result||0);r.onerror=()=>no(r.error)});dbx.close();return count}
async function refreshQueuedFileCount(){const el=document.getElementById('offlineFileCount');if(el)el.textContent=String(await totalQueuedFileCount())}
window.addEventListener('vina-file-queue-changed',()=>void refreshQueuedFileCount());
async function legacyDataFile(meta,fallback){const blob=await (await fetch(meta.data)).blob();return new File([blob],meta.name||fallback,{type:meta.type||blob.type||'application/octet-stream'})}
async function migrateLegacyEmbeddedFiles(){
 let changed=false;
 for(const p of db.projects||[]){for(const [key,category] of [['contractFileTvgs','TVGS_CONTRACT'],['contractFileContractor','CONTRACTOR_CONTRACT']]){const meta=p[key];if(!meta?.data)continue;try{await queueOfflineFiles('project',p.id,[{file:await legacyDataFile(meta,'hop-dong'),kind:'PROJECT_FILE',category}]);delete meta.data;changed=true}catch(error){console.warn('Chưa chuyển được tệp công trình cũ:',error.message)}}}
 for(const [projectId,plan] of Object.entries(db.pendingInitialProgressPlans||{})){if(!plan.attachment?.data)continue;try{const [qid]=await queueOfflineFiles('project',projectId,[{file:await legacyDataFile(plan.attachment,'bang-tien-do'),kind:'PROGRESS_BASELINE',category:'PROGRESS_BASELINE'}]);plan.attachment_queue_id=qid;delete plan.attachment;changed=true}catch(error){console.warn('Chưa chuyển được tệp tiến độ cũ:',error.message)}}
 for(const log of db.logs||[]){try{const entries=[];for(const meta of log.photos||[])if(meta.data)entries.push({meta,file:await legacyDataFile(meta,'anh-hien-truong.jpg'),kind:'PHOTO',category:'Ảnh hiện trường'});for(const meta of log.documents||[])if(meta.data)entries.push({meta,file:await legacyDataFile(meta,'tai-lieu'),kind:'DOCUMENT',category:'Tài liệu báo cáo ngày'});if(!entries.length)continue;await queueOfflineFiles('daily_log',log.id,entries.map(x=>({file:x.file,kind:x.kind,category:x.category})));entries.forEach(x=>delete x.meta.data);changed=true}catch(error){console.warn('Chưa chuyển được tệp báo cáo ngày cũ:',error.message)}}
 for(const x of db.issues||[]){if(!x.signedFile?.data)continue;try{await queueOfflineFiles('issue',x.id,[{file:await legacyDataFile(x.signedFile,'ban-ky'),kind:'SIGNED',category:'Bản ký'}]);delete x.signedFile;changed=true}catch(error){console.warn('Chưa chuyển được bản ký văn bản chất lượng cũ:',error.message)}}
 for(const item of db.sync||[])if(item.type==='project'&&item.payload){delete item.payload.contractFileTvgs;delete item.payload.contractFileContractor}
 if(changed)persistLocal();return changed
}
