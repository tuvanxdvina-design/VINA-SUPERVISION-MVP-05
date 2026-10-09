const SHIFT_OPTIONS=[['CA1','Ca 1 (sáng)'],['CA2','Ca 2 (chiều)'],['CA3','Ca 3 (tối/đêm)']];
function shiftLabel(code){const c=String(code||'CA1').toUpperCase();const f=SHIFT_OPTIONS.find(x=>x[0]===c);return f?f[1]:c.replace(/^CA(\d+)$/,'Ca $1')}
// <datalist> không có gợi ý trên Safari/iOS (hạn chế của trình duyệt) nên dùng nút chọn nhanh thay thế — chạy được mọi thiết bị.
const WEATHER_OPTIONS=['Nắng','Nắng nóng','Mây','Mưa nhỏ','Mưa to','Âm u'];
const WEATHER_QUICK_HTML=WEATHER_OPTIONS.map(w=>'<button type="button" style="padding:3px 8px;font-size:11px;margin:3px 4px 0 0" onclick="document.getElementById(\'lweather\').value=\''+w+'\'">'+w+'</button>').join('');
// Mỗi lần chọn/chụp ảnh, <input type=file> THAY THẾ toàn bộ danh sách trước đó (không cộng dồn) —
// trên di động, chụp ảnh từng tấm một qua camera nên mất ảnh cũ. Giữ danh sách cộng dồn riêng ở đây.
let logPhotoPicks=[];
function renderLogPhotoPicks(){
 const box=document.getElementById('lphotosList');if(!box)return;
 box.innerHTML=logPhotoPicks.length?logPhotoPicks.map((f,i)=>'<span class="chip" style="margin:2px 4px 2px 0">'+esc(f.name)+' <a href="#" onclick="removeLogPhotoPick('+i+');return false" title="Bỏ ảnh này">✕</a></span>').join('')+'<div class="muted" style="margin-top:3px">'+logPhotoPicks.length+' ảnh đã chọn.</div>':'<span class="muted">Chưa chọn ảnh nào — bấm ô trên để chụp/chọn, có thể bấm nhiều lần để thêm từng ảnh.</span>';
}
function onLogPhotosPicked(input){
 for(const f of input.files)logPhotoPicks.push(f);
 input.value='';
 renderLogPhotoPicks();
}
function removeLogPhotoPick(i){logPhotoPicks.splice(i,1);renderLogPhotoPicks()}
async function renderSavedLogPhotos(log){
 const target=document.getElementById('lphotosList');if(!target||!log?.id)return;
 document.getElementById('lSavedPhotos')?.remove();
 const box=document.createElement('div');box.id='lSavedPhotos';target.after(box);
 box.textContent='Đang đọc ảnh đã lưu trên thiết bị...';
 try{
  const queued=(await queuedFiles('daily_log',log.id)).filter(f=>f.kind==='PHOTO');
  if(!box.isConnected)return;
  box.textContent='';
  const title=document.createElement('p');title.className='muted';title.textContent=queued.length?queued.length+' ảnh đã lưu trên thiết bị, chờ đồng bộ. Ảnh này vẫn được giữ khi sửa báo cáo.':log.photoCount?log.photoCount+' ảnh đã đồng bộ.':'Ảnh đã lưu trên thiết bị';box.append(title);
  async function add(name,source){
   if(!box.isConnected)return;
   const item=document.createElement('div'),button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('div');
   button.type='button';button.onclick=()=>openLogPhoto(button);button.setAttribute('aria-label','Xem ảnh '+name);image.className='photo';image.alt=name;image.src=source;button.append(image);label.className='muted';label.textContent=name;item.append(button,label);box.append(item);
  }
  for(const photo of log.photos||[])if(photo.data)await add(photo.name||'Ảnh đã lưu',photo.data);
  for(const file of queued){
   if(!box.isConnected)return;
   try{const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file.blob)});await add(file.name,source)}
   catch(_){const label=document.createElement('p');label.textContent=file.name+' — chưa mở được ảnh xem trước; tệp chờ vẫn được giữ.';if(box.isConnected)box.append(label)}
  }
  if(log.serverId&&apiOnline()){
   const serverBox=document.createElement('div');serverBox.id='lServerPhotos';box.append(serverBox);
   serverBox.textContent='Đang tải danh sách ảnh đã đồng bộ...';
   try{
    const files=await apiRequest('/daily-logs/'+encodeURIComponent(log.serverId)+'/attachments');
    if(!serverBox.isConnected)return;
    serverBox.textContent=files.length+' ảnh trên máy chủ';
    for(const file of files){
     if(!serverBox.isConnected)return;
     const item=document.createElement('div'),label=document.createElement('div');label.className='muted';label.textContent=file.file_name;item.append(label);serverBox.append(item);
     try{
      const photo=await apiRequest('/daily-logs/'+encodeURIComponent(log.serverId)+'/attachments/'+encodeURIComponent(file.id));
      if(!item.isConnected)return;
      const button=document.createElement('button'),image=document.createElement('img');button.type='button';button.onclick=()=>openLogPhoto(button);button.setAttribute('aria-label','Xem ảnh '+file.file_name);image.className='photo';image.alt=file.file_name;image.src=photo.data_url;button.append(image);item.prepend(button);
     }catch(_){if(item.isConnected)label.textContent=file.file_name+' — chưa tải được ảnh; ảnh vẫn được giữ trên máy chủ.'}
    }
   }catch(_){if(serverBox.isConnected)serverBox.textContent='Chưa tải được danh sách ảnh trên máy chủ. Nội dung đang sửa và ảnh chờ trên thiết bị vẫn được giữ.'}
  }
 }catch(_){if(box.isConnected)box.textContent='Chưa đọc được ảnh trên thiết bị. Không xóa dữ liệu ứng dụng; hãy thử mở lại báo cáo.'}
}
const LOG_STATUS={DRAFT:'Nháp',SUBMITTED:'Chờ duyệt',APPROVED:'Đã duyệt',LOCKED:'Đã khóa'};
function renderLogs(){
  const pid=document.getElementById('logProject')?.value||'';
  const projectLogs=db.logs.filter(x=>(!pid||x.projectId===pid)&&canSeeLog(x));
  const authorSelect=document.getElementById('logAuthor');const oldAuthor=authorSelect?.value||'';
  const authors=[...new Map(projectLogs.map(x=>[x.createdById||x.createdBy||'',{id:x.createdById||x.createdBy||'',name:x.createdBy||'Chưa xác định'}])).values()].filter(x=>x.id).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
  if(authorSelect){authorSelect.innerHTML='<option value="">Tất cả người lập</option>'+authors.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');authorSelect.value=authors.some(x=>x.id===oldAuthor)?oldAuthor:''}
  const author=authorSelect?.value||'';
  const list=projectLogs.filter(x=>!author||(x.createdById||x.createdBy||'')===author).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.shift).localeCompare(String(b.shift)));
  const rows=list.map(x=>{
    const project=db.projects.find(p=>p.id===x.projectId)||{};
    return '<tr><td>'+esc(x.date||'')+'<br><span class="muted">'+esc(shiftLabel(x.shift))+'</span></td><td>'+esc(project.name||'')+'</td><td>'+esc(x.work||'')+(x.weather?'<br><span class="muted">Thời tiết: '+esc(x.weather)+'</span>':'')+
      '</td><td>'+esc(x.createdBy||'Chưa xác định')+'</td><td>'+Number(x.workers||0)+'</td><td>'+Number(x.machines||0)+
      '</td><td>'+logStatusBadge(x.status)+returnedChip(x)+'</td><td style="white-space:nowrap">'+logActionsHtml(x)+'</td></tr>';
  }).join('');
  // Người có quyền Duyệt tại công trình (TVGS trưởng): KHÔNG "gửi duyệt" cho chính mình — nháp của mình thì Xác nhận thẳng,
  // việc của thành viên thì Duyệt bản họ đã gửi. Nháp của thành viên không gom vào (họ chưa gửi = còn đang soạn).
  const me=qualityAuthUserId();
  const mySubmit=list.filter(x=>canSubmitLog(x)&&!isLogLead(x.projectId)).map(x=>x.id);
  const toConfirm=list.filter(x=>canSubmitLog(x)&&isLogLead(x.projectId)&&String(x.createdById||'')===me).map(x=>x.id);
  const toApprove=list.filter(x=>x.serverId&&x.status==='SUBMITTED'&&isLogLead(x.projectId)&&(canManageAssignments()||x.lastReview?.action!=='ESCALATE')).map(x=>x.id);
  const toLock=list.filter(x=>x.serverId&&x.status==='APPROVED'&&isLogLead(x.projectId)).map(x=>x.id);
  const bar=(mySubmit.length||toConfirm.length||toApprove.length||toLock.length)?'<div class="toolbar" style="margin:0 0 10px">'+(mySubmit.length?'<button class="primary" onclick="logBulk(\'submit\','+esc(JSON.stringify(mySubmit))+')">Gửi duyệt tất cả nháp ('+mySubmit.length+')</button>':'')+((toConfirm.length||toApprove.length)?'<button class="primary" onclick="logBulkLead('+esc(JSON.stringify(toConfirm))+','+esc(JSON.stringify(toApprove))+')">Duyệt tất cả ('+(toConfirm.length+toApprove.length)+')</button>':'')+(toLock.length?'<button onclick="logBulk(\'lock\','+esc(JSON.stringify(toLock))+')">Khóa tất cả đã duyệt ('+toLock.length+')</button>':'')+'</div>':'';
  const guide='<p class="muted" style="margin:0 0 8px">Quy trình: <b>Nháp</b> (người lập còn sửa) → <b>Gửi duyệt</b> → Trưởng TVGS <b>Duyệt</b> hoặc <b>Trả lại</b> → <b>Khóa</b> (hồ sơ chính thức).</p>';
  document.getElementById('logsTable').innerHTML=guide+bar+(rows?'<table><thead><tr><th>Ngày / ca</th><th>Công trình</th><th>Công việc</th><th>Người lập</th><th>NL</th><th>Máy</th><th>Trạng thái</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="muted">Chưa có báo cáo ngày.</p>');
}
// Nhân lực/máy móc theo từng loại (một buổi có nhiều loại thợ/máy khác nhau) — tên loại tự gõ.
function resourceRowHtml(cls,item){return '<div class="'+cls+'-row" style="display:grid;grid-template-columns:1fr 90px auto;gap:8px;margin:4px 0"><input class="'+cls+'-type" value="'+esc(item?.type||'')+'" placeholder="Loại (VD: Thợ xây, Máy xúc)"><input class="'+cls+'-count" type="number" min="1" value="'+(item&&item.count!=null?item.count:'')+'" placeholder="SL"><button type="button" onclick="this.parentElement.remove()">Xóa</button></div>'}
function resourceRowsHtml(cls,items){return (items&&items.length?items:[null]).map(i=>resourceRowHtml(cls,i)).join('')}
function addResourceRow(cls){const box=document.getElementById(cls+'Box');if(box)box.insertAdjacentHTML('beforeend',resourceRowHtml(cls,null))}
function readResourceRows(cls){
 const types=[...document.querySelectorAll('.'+cls+'-type')],counts=[...document.querySelectorAll('.'+cls+'-count')];
 const rows=[];for(let i=0;i<types.length;i++){const type=(types[i].value||'').trim();const count=Number(counts[i].value||0);if(type&&count>0)rows.push({type,count})}
 return rows;
}
function resourceSummary(items,total){return items&&items.length?items.map(x=>esc(x.type)+': '+x.count).join(', '):String(total||0)}
let currentLogPackage=null;
// Khi công trình có khai báo Gói thầu VÀ người lập đã được ấn định vào đúng 1 gói thầu đó,
// đổi "Đơn vị tc"/"Hạng mục" từ ô tự gõ sang chọn theo đúng nhà thầu/hạng mục trong gói được gán.
// Chưa có gói thầu, hoặc người lập chưa được ấn định gói nào → giữ nguyên ô tự gõ như trước.
async function openLog(lid=''){
if(!canEditDailyLog())return alert('Tài khoản hiện tại không được lập hoặc sửa báo cáo ngày.');
if(!db.projects.length)return alert('Hãy tạo công trình trước.');
let x=db.logs.find(l=>l.id===lid)||{};const isEdit=!!lid;captureEditVersion('daily_log',lid,x);
logPhotoPicks=[];
if(isEdit&&!canEditLog(x))return alert('Báo cáo ngày này không còn được phép sửa.');
const logProjects=isEdit?(db.projects||[]).filter(p=>p.id===x.projectId):logProjectsForCreate();if(!logProjects.length)return alert('Tài khoản chưa được cấp quyền "Thêm" báo cáo ngày ở công trình nào.');
const initPid=x.projectId||(logProjects[0]&&logProjects[0].id)||'';const initConfirm=canApproveIn(initPid);
currentLogPackage=null;
if(typeof loadBiddingPackages==='function'){
 const controller=new AbortController();
 // Dữ liệu gói thầu bổ sung không được giữ màn hình nhập chờ mạng vô hạn.
 const timer=setTimeout(()=>controller.abort(),1500);
 try{
  const packages=await loadBiddingPackages(initPid,false,{signal:controller.signal});
  if(packages.length&&typeof fetchTeam==='function'){
   const rows=controller.signal.aborted?(db.teamCache?.[initPid]?.rows||[]):await fetchTeam(initPid,{sync:false,signal:controller.signal});const mine=rows.find(r=>r.is_me);
   if(mine?.bidding_package_id)currentLogPackage=packages.find(p=>p.id===mine.bidding_package_id)||null;
  }
 }catch(_){}finally{clearTimeout(timer)}
}
const hasPackageItems=!!(currentLogPackage&&(currentLogPackage.contractors||[]).some(c=>(c.items||[]).length));
const itemFieldsHtml=hasPackageItems
 ?'<div><label>&#x0110;ơn v&#x1ecb; tc (nh&#x00e0; th&#x1ea7;u trong g&#x00f3;i &quot;'+esc(currentLogPackage.name)+'&quot;)</label><select id="lcontractorunit" onchange="syncLogItemCategoryOptions()">'+currentLogPackage.contractors.map(c=>'<option value="'+esc(c.name)+'"'+(c.name===x.contractorUnit?' selected':'')+'>'+esc(c.name)+'</option>').join('')+(x.contractorUnit&&!currentLogPackage.contractors.some(c=>c.name===x.contractorUnit)?'<option value="'+esc(x.contractorUnit)+'" selected>'+esc(x.contractorUnit)+' (cũ)</option>':'')+'</select></div><div><label>H&#x1ea1;ng m&#x1ee5;c</label><select id="litemcategory"></select></div>'
 :'<div><label>&#x0110;ơn v&#x1ecb; tc</label><input id="lcontractorunit" value="'+esc(x.contractorUnit||'')+'"></div><div><label>H&#x1ea1;ng m&#x1ee5;c</label><input id="litemcategory" value="'+esc(x.itemCategory||'')+'"></div>';
openModal(isEdit?'Sửa báo cáo ngày':'Lập báo cáo ngày',`${isEdit?reviewBlockHtml(x,{history:false}):''}<div class="row"><div><label>C&#x00f4;ng tr&#x00ec;nh</label><select id="lproj" onchange="updateLogSubmitLabel()">${logProjects.map(p=>`<option value="${p.id}" ${p.id===x.projectId?'selected':''}>${esc(p.code)} - ${esc(p.name)}</option>`).join('')}</select></div><div><label>Ng&#x00e0;y</label><input id="ldate" type="date" value="${x.date||new Date().toISOString().slice(0,10)}"></div><div><label>Ca l&#224;m vi&#7879;c</label><select id="lshift">${SHIFT_OPTIONS.map(([v,t])=>`<option value="${v}" ${(x.shift||'CA1')===v?'selected':''}>${t}</option>`).join('')}</select></div>${itemFieldsHtml}<div class="full"><label>C&#x00f4;ng vi&#x1ec7;c</label><textarea id="lwork" rows="3">${esc(x.work||'')}</textarea></div><div><label>Cbkt</label><input id="lcbkt" type="number" value="${x.technicalStaffCount??0}"></div><div class="full"><label>Nh&#x00e2;n l&#x1ef1;c (theo lo&#x1ea1;i th&#x1ee3)</label><div id="lworkersBox">${resourceRowsHtml('lworkers',x.workerItems)}</div><button type="button" onclick="addResourceRow('lworkers')">+ Th&#x00eam lo&#x1ea1;i</button></div><div class="full"><label>M&#x00e1;y m&#x00f3;c (theo lo&#x1ea1;i m&#x00e1;y)</label><div id="lmachinesBox">${resourceRowsHtml('lmachines',x.machineItems)}</div><button type="button" onclick="addResourceRow('lmachines')">+ Th&#x00eam lo&#x1ea1;i</button></div><div><label>Thời tiết</label><input id="lweather" value="${esc(x.weather||'')}" placeholder="Nắng / Mưa / Âm u..."><div>${WEATHER_QUICK_HTML}</div></div><div><label>Ghi ch&#x00fa</label><textarea id="lnote" rows="2">${esc(x.note||'')}</textarea></div><div class="full"><label>Ki&#x1ebf;n ngh&#x1ecb;</label><textarea id="lrecommendation" rows="2">${esc(x.recommendation||'')}</textarea></div><div class="full"><label>&#x1ea2;nh hi&#x1ec7;n tr&#x01b0;&#x1edd;ng</label><div class="toolbar"><button id="logCameraButton" type="button" onclick="document.getElementById('lcamera').click()">&#128247; Ch&#7909;p &#7843;nh</button><button id="logPhotoLibraryButton" type="button" onclick="document.getElementById('lphotos').click()">Ch&#7885;n &#7843;nh c&#243; s&#7861;n</button></div><input id="lcamera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onchange="onLogPhotosPicked(this)"><input id="lphotos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="onLogPhotosPicked(this)"><div id="lphotosList" style="margin-top:4px"></div><div class="muted">Bấm nhiều lần để chụp/thêm từng ảnh — ảnh chọn trước không bị mất.</div></div><div class="full"><label>T&#x00e0;i li&#x1ec7;u k&#x00e8;m theo</label><input id="ldocuments" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,image/*" multiple><div class="muted">Cho ph&#x00e9;p t&#x1ea3;i bi&#x00ean b&#x1ea3;n, th&#x01b0; k&#x1ef9; thu&#x1ead;t ho&#x1eb7;c t&#x00e0;i li&#x1ec7;u li&#x00ean quan.</div></div><div class="full toolbar"><button class="primary" onclick="saveLog('${lid}',false)">${isEdit?'Lưu thay đổi':'Lưu nháp'}</button><button id="lsubmitbtn" onclick="saveLog('${lid}',true)">${initConfirm?'Lưu và xác nhận':'Lưu và gửi duyệt'}</button><span class="muted" id="lsubmithint">${initConfirm?'Xác nhận: bạn có quyền Duyệt tại công trình này nên chuyển thẳng Đã duyệt, không qua Chờ duyệt.':'Nháp: còn sửa được. Gửi duyệt: chuyển Trưởng TVGS duyệt, không sửa được nữa.'}</span></div></div>`);
if(hasPackageItems)syncLogItemCategoryOptions(x.itemCategory||'');
renderLogPhotoPicks();
if(isEdit)void renderSavedLogPhotos(x);
}
function syncLogItemCategoryOptions(preselect){
 const contractorSel=document.getElementById('lcontractorunit');const itemSel=document.getElementById('litemcategory');
 if(!contractorSel||!itemSel||!currentLogPackage)return;
 const c=(currentLogPackage.contractors||[]).find(v=>v.name===contractorSel.value);
 const items=c?.items||[];
 itemSel.innerHTML=items.map(it=>'<option value="'+esc(it.name)+'">'+esc(it.name)+(it.unit?' ('+esc(it.unit)+')':'')+'</option>').join('')+(preselect&&!items.some(it=>it.name===preselect)?'<option value="'+esc(preselect)+'" selected>'+esc(preselect)+' (cũ)</option>':'');
 if(preselect&&items.some(it=>it.name===preselect))itemSel.value=preselect;
}
function updateLogSubmitLabel(){const btn=document.getElementById('lsubmitbtn');const hint=document.getElementById('lsubmithint');if(!btn)return;const pid=document.getElementById('lproj')?.value||'';const isConfirm=canApproveIn(pid);btn.textContent=isConfirm?'Lưu và xác nhận':'Lưu và gửi duyệt';if(hint)hint.textContent=isConfirm?'Xác nhận: bạn có quyền Duyệt tại công trình này nên chuyển thẳng Đã duyệt, không qua Chờ duyệt.':'Nháp: còn sửa được. Gửi duyệt: chuyển Trưởng TVGS duyệt, không sửa được nữa.'}
let logSaveRunning=false;
async function saveLog(lid='',submitAfter=false){
 if(logSaveRunning)return;
 logSaveRunning=true;
 const buttons=[...document.querySelectorAll('button[onclick^="saveLog("]')].map(button=>({button,disabled:button.disabled}));
 for(const {button} of buttons)button.disabled=true;
 try{return await persistLog(lid,submitAfter)}
 finally{logSaveRunning=false;for(const {button,disabled} of buttons)if(button.isConnected)button.disabled=disabled}
}
async function persistLog(lid='',submitAfter=false){
if(!canEditDailyLog())return alert('Bạn không có quyền sửa hoặc lập báo cáo ngày.');
let existing=db.logs.find(l=>l.id===lid);if(existing&&!canEditLog(existing))return alert('Báo cáo ngày không còn được phép sửa.');
let photos=[...(existing?.photos||[])];const photoFiles=[...logPhotoPicks];const photoInput=document.getElementById('lphotos'),documentInput=document.getElementById('ldocuments');
if(photoFiles.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>20*1024*1024))return alert('Ảnh phải là JPEG, PNG hoặc WebP, tối đa 20 MB trước khi tối ưu.');
let documents=[...(existing?.documents||[])];const docFiles=[...(document.getElementById('ldocuments')?.files||[])];
for(const f of docFiles)if(f.size>25*1024*1024)return alert('Tài liệu tối đa 25 MB mỗi tệp.');
const shift=document.getElementById('lshift')?.value||'CA1';
const actor=typeof getAuthUser==='function'?getAuthUser():null;const actorId=existing?.createdById||(actor?.id||'');
const dupLog=db.logs.find(l=>l.id!==existing?.id&&l.projectId===lproj.value&&l.date===ldate.value&&String(l.shift||'CA1')===shift&&(l.createdById||'')===actorId);if(dupLog)return alert('Tài khoản này đã có báo cáo ngày '+shiftLabel(shift)+' ngày '+ldate.value+'. Hãy mở báo cáo đó để sửa.');
const workerItems=readResourceRows('lworkers'),machineItems=readResourceRows('lmachines');
const workers=workerItems.reduce((s,x)=>s+x.count,0),machines=machineItems.reduce((s,x)=>s+x.count,0);
const data={expectedRowVersion:editVersion('daily_log',lid,existing),projectId:lproj.value,date:ldate.value,shift,work:lwork.value,weather:(document.getElementById('lweather')?.value||'').trim(),workers,machines,workerItems,machineItems,note:lnote.value,contractorUnit:(document.getElementById('lcontractorunit')?.value||'').trim(),itemCategory:(document.getElementById('litemcategory')?.value||'').trim(),technicalStaffCount:+(document.getElementById('lcbkt')?.value||0),recommendation:(document.getElementById('lrecommendation')?.value||'').trim(),photos,documents,status:existing?.status||'DRAFT',createdBy:existing?.createdBy||(actor?.full_name||db.role),createdById:actorId,version:(existing?.version||0)+1,updatedAt:new Date().toISOString()};
if(existing){Object.assign(existing,data);audit('UPDATE','daily_log',existing.id,`v${existing.version}`);queueSync('daily_log',existing.id,'UPDATE',data)}else{const x={id:id(),...data,createdAt:new Date().toISOString(),version:1};db.logs.unshift(x);queueSync('daily_log',x.id,'CREATE',data);audit('CREATE_AND_CONFIRM','daily_log',x.id,'v1')}
const savedId=existing?.id||db.logs[0]?.id;
const queuedEntries=[...photoFiles.map(file=>({file,kind:'PHOTO',category:'Ảnh hiện trường'})),...docFiles.map(file=>({file,kind:'DOCUMENT',category:'Tài liệu báo cáo ngày'}))];if(queuedEntries.length)await queueOfflineFiles('daily_log',savedId,queuedEntries);
if(queuedEntries.length&&document.getElementById('lphotos')===photoInput){logPhotoPicks=logPhotoPicks.filter(file=>!photoFiles.includes(file));if(documentInput?.isConnected)documentInput.value='';renderLogPhotoPicks();void renderSavedLogPhotos(db.logs.find(log=>log.id===savedId));}
save();if(typeof getAuthToken==='function'&&getAuthToken()&&window.syncPendingDailyLogs)await window.syncPendingDailyLogs();
if(submitAfter){const item=(db.sync||[]).find(v=>v.type==='daily_log'&&v.recordId===savedId&&['PENDING','CONFLICT'].includes(v.status));if(item?.status==='PENDING'||await queuedFileCount('daily_log',savedId))return alert('Báo cáo và tệp đã được giữ trên thiết bị, chưa gửi duyệt. Hãy chờ đồng bộ xong rồi mở báo cáo để gửi duyệt.');}
if(showQueuedConflict('daily_log',savedId))return;
closeModal();
if(submitAfter){const l=db.logs.find(v=>v.id===savedId);if(l?.serverId&&l.status==='DRAFT')await logAction(l.id,canApproveIn(l.projectId)?'confirm':'submit',true);else if(l&&!l.serverId)alert('Báo cáo ngày đã lưu trên thiết bị nhưng chưa lên máy chủ (mất mạng?). Sẽ gửi duyệt được sau khi đồng bộ.')}
if(currentProjectId)renderProjectDetail();
}
function exportDailyLog(lid){
const x=db.logs.find(l=>l.id===lid);
if(!x)return;
if(!canDownloadIn(x.projectId))return alert('Bạn chưa được cấp quyền tải xuống tại công trình này.');
const project=db.projects.find(p=>p.id===x.projectId)||{};
const lines=[
'VINA-SUPERVISION - BÁO CÁO NGÀY CÔNG TRÌNH',
`Công trình: ${project.code||''} - ${project.name||''}`,
`Ngày: ${x.date||''} — ${shiftLabel(x.shift)}`,
`Người lập: ${x.createdBy||'Chưa xác định'}`,
`Công việc: ${x.work||''}`,
`Nhân lực: ${x.workerItems&&x.workerItems.length?x.workerItems.map(i=>i.type+': '+i.count).join(', '):(x.workers||0)}`,
`Máy móc: ${x.machineItems&&x.machineItems.length?x.machineItems.map(i=>i.type+': '+i.count).join(', '):(x.machines||0)}`,
`Thời tiết: ${x.weather||''}`,
`Trạng thái: ${LOG_STATUS[x.status]||x.status||''}`,
`Ghi chú: ${x.note||''}`
];
const text='\ufeff'+lines.join('\r\n');
const safe=String(project.code||'cong-trinh').replace(/[^\w-]+/g,'-');
const file=new File([text],`bao-cao-ngay-${safe}-${x.date||'export'}-${x.shift||'CA1'}.txt`,{type:'text/plain;charset=utf-8'});
const download=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
 navigator.share({title:'Báo cáo ngày công trình',text:`Báo cáo ngày ${project.name||''} ngày ${x.date||''}`,files:[file]}).catch(()=>download());
}else download();
}
function fillReportFromLogs(){const pid=document.getElementById('dproj')?.value||'';const logs=db.logs.filter(x=>x.projectId===pid&&canSeeLog(x));if(!logs.length)return alert('Chưa có báo cáo ngày để tổng hợp.');const latest=logs.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];const avg=logs.reduce((n,x)=>n+Number(x.workers||0),0)/logs.length;const planned=Number(document.getElementById('dplanned')?.value||0);const actual=Number(latest.progress||0);document.getElementById('dactual').value=actual;document.getElementById('dmanpower').value=Math.round(avg);document.getElementById('dschedule').value=actual>planned?'AHEAD':(actual<planned?'DELAYED':'ON_TRACK')}

async function syncDailyLogsFromApi(){
  if(!apiOnline() || typeof apiGetDailyLogs!=='function') return;

  try{
    // Lấy lại danh sách công trình từ PostgreSQL để làm nguồn chuẩn.
    if(typeof apiGetProjects==='function'){
      const remoteProjects = await apiGetProjects();
      if(Array.isArray(remoteProjects)){
        mergeProjectsFromServer(remoteProjects);
      }
    }

    const projects = Array.isArray(db.projects) ? db.projects : [];
    let added = 0;
    let updated = 0;

    for(const project of projects){
      if(!project?.id) continue;

      try{
        // Chụp danh sách bản đã có mã máy chủ TRƯỚC khi tải: bản vừa lên máy chủ trong lúc đang tải (danh sách trả về
        // chưa kịp có nó) không bị coi là "đã mất" và bị xóa nhầm khỏi thiết bị.
        const knownBefore = new Set(db.logs.filter(x => x.projectId === project.id && x.serverId).map(x => x.serverId));
        const remoteLogs = await apiGetDailyLogs(project.id);
        // Bản đã có trên máy chủ mà máy chủ không trả về nữa (đã xóa, hoặc là nháp của người khác) → bỏ khỏi thiết bị.
        // Giữ lại: bản chưa lên máy chủ, bản mới có mã sau khi bắt đầu tải, bản còn thay đổi chờ đồng bộ.
        const remoteIds = new Set(remoteLogs.map(r => r.id));
        const pendingIds = new Set((db.sync || []).filter(q => q.type === 'daily_log' && ['PENDING','CONFLICT'].includes(q.status)).map(q => q.recordId));
        db.logs = db.logs.filter(x => !(x.projectId === project.id && x.serverId && knownBefore.has(x.serverId) && !remoteIds.has(x.serverId) && !pendingIds.has(x.id)));

        for(const remoteLog of remoteLogs){
          const serverId = remoteLog.id;

          const localIndex = db.logs.findIndex(
            x => x.serverId===serverId || x.id===serverId
          );

          const normalized = {
            ...remoteLog,
            serverId
          };

          if(localIndex >= 0){
            const localId = db.logs[localIndex].id;
            if (pendingIds.has(localId)) continue;

            db.logs[localIndex] = {
              ...db.logs[localIndex],
              ...normalized,
              id: localId,
              serverId
            };

            updated++;
          }else{
            db.logs.push(normalized);
            added++;
          }
        }
      }catch(error){
        console.warn(
          'VINA-SUPERVISION: Không đồng bộ nhật ký công trình',
          project.id,
          error.message
        );
      }
    }

    persistLocal();
    renderAll();

    console.log(
      'VINA-SUPERVISION: Đồng bộ nhật ký PostgreSQL:',
      {added, updated, total: db.logs.length}
    );
  }catch(error){
    console.warn(
      'VINA-SUPERVISION: Không đồng bộ được nhật ký PostgreSQL:',
      error.message
    );
  }
}
