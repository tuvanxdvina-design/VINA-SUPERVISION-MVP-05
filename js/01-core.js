
const LEGACY_KEY='vina_supervision_mvp01';
const ACTIVE_USER=(()=>{try{return JSON.parse(localStorage.getItem('vina_supervision_auth')||'null')?.user?.id||''}catch(_){return ''}})();
const KEY=ACTIVE_USER ? `${LEGACY_KEY}:${ACTIVE_USER}` : `${LEGACY_KEY}:guest`;
// Không sao chép dữ liệu khách/thiết bị cũ sang phiên tài khoản mới.
// Danh sách công trình phải lấy từ API theo quyền phân công.
let db=JSON.parse(localStorage.getItem(KEY)||'{"projects":[],"logs":[],"issues":[],"docs":[],"people":[],"audit":[],"sync":[],"role":"Giám đốc"}');
let storageWarned=false;
// Lưu bộ nhớ đệm trên thiết bị. Nếu vượt dung lượng trình duyệt (~5–10 MB) thì bỏ phần tệp nhúng base64
// thay vì làm hỏng thao tác (trước đây lỗi này làm hồ sơ vừa tạo "biến mất" khỏi danh sách).
function persistLocal(){
  try{localStorage.setItem(KEY,JSON.stringify(db));return true}
  catch(error){
    try{
      const slim=JSON.parse(JSON.stringify(db,(k,v)=>typeof v==='string'&&v.startsWith('data:')&&v.length>2000?undefined:v));
      localStorage.setItem(KEY,JSON.stringify(slim));
    }catch(_){}
    if(!storageWarned){storageWarned=true;alert('Bộ nhớ trình duyệt đã đầy nên không lưu được tệp đính kèm trên thiết bị. Dữ liệu trên máy chủ không bị ảnh hưởng; tệp mới hãy tải lên khi có mạng.')}
    return false;
  }
}
const save=()=>{persistLocal();renderAll()};
function queueSync(type,recordId,operation='UPSERT',payload={}){
 const previous=db.sync.find(x=>x.type===type&&x.recordId===recordId&&['PENDING','CONFLICT'].includes(x.status)&&!x.sending&&!x.savedResult&&!x.savedRowVersion);
 if(previous){previous.payload={...payload,expectedRowVersion:previous.payload.expectedRowVersion??payload.expectedRowVersion,expected_row_version:previous.payload.expected_row_version??payload.expected_row_version};previous.lastError='';previous.status='PENDING';return}
 db.sync.push({id:id(),type,recordId,operation,payload,queuedAt:new Date().toISOString(),status:'PENDING'});
}
const id=()=>crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;
    return (c==='x'?r:(r&3|8)).toString(16);
  });
function audit(action,entity,entityId,detail){db.audit.unshift({id:id(),at:new Date().toISOString(),actor:db.role,action,entity,entityId,detail})}
function setRole(v){db.role=v;audit('CHANGE_ROLE','system','',v);save()}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(d){return d?new Date(d).toLocaleString('vi-VN'):''}
function fmtDate(d){return d?new Date(d).toLocaleDateString('vi-VN'):''}
function executionDays(start,end){if(!start||!end)return '';const a=new Date(start),b=new Date(end);const days=Math.round((b-a)/86400000)+1;return days>0?days:''}
// Mã trạng thái thô từ máy chủ (ACTIVE/OPEN/...) → chữ tiếng Việt; giá trị đã là tiếng Việt giữ nguyên.
const STATUS_LABELS={ACTIVE:'ĐANG THI CÔNG',INACTIVE:'TẠM DỪNG',SUSPENDED:'TẠM DỪNG',COMPLETED:'HOÀN THÀNH',PLANNING:'CHUẨN BỊ',OPEN:'Đang xử lý',IN_PROGRESS:'Đang xử lý',RESOLVED:'Đã đóng',CLOSED:'Đã đóng'};
function statusBadge(s){return `<span class="badge ${String(s||'').toLowerCase().replace(/\s+/g,'')}">${esc(STATUS_LABELS[String(s||'').toUpperCase()]||s)}</span>`}
function enforceDashboardAccess(){
  const allowed=canViewDashboard();
  const btn=document.querySelector('nav button[data-page="dashboard"]');
  const page=document.getElementById('dashboard');
  if(btn) btn.style.display=allowed?'':'none';
  if(page) page.style.display=allowed?'':'none';
  if(!allowed && page?.classList.contains('active')){
    page.classList.remove('active');
    document.getElementById('projects')?.classList.add('active');
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
    document.querySelector('nav button[data-page="projects"]')?.classList.add('active');
  }
}
function canEdit(){return [
'\u0047i\u00e1m \u0111\u1ed1c',
'Admin',
'\u0054r\u01b0\u1edfng TVGS',
'K\u1ef9 s\u01b0 TVGS'
].includes(db.role)}
function canCreateLogIn(projectId){if(canManageAssignments())return true;return qualityPermissions(projectId).includes('CREATE')}
function isPrivilegedLogEditor(){return canManageAssignments()}
function renderSelects(){['logProject','issueProject','docProject'].forEach(sid=>{let el=document.getElementById(sid);if(el){let old=el.value;el.innerHTML='<option value="">Tất cả công trình</option>'+projectsOptions(old);el.value=old||''}})}
function goPage(page){if(page==='dashboard'&&!canViewDashboard())page='projects';if(page==='settings'&&!canManageAssignments())page='projects';document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));const navKey=page==='daily'?'reports':page;const btn=document.querySelector(`nav button[data-page="${navKey}"]`);if(btn)btn.classList.add('active');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById(page).classList.add('active');document.querySelectorAll('.report-hub-tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===page))}
function goDashboard(){currentProjectId=null;goPage('dashboard');renderAll()}
function logStatusBadge(st){return '<span class="badge '+String(st||'').toLowerCase()+'">'+esc(LOG_STATUS[st]||st||'')+'</span>'}
function logActionsHtml(x){
 const b=[];
 if(canEditLog(x))b.push('<button onclick="openLog(\''+x.id+'\')">Sửa</button>');
 if(!x.serverId)b.push('<span class="chip warn">Chờ đồng bộ</span>');
 if(canSubmitLog(x)){const act=canApproveIn(x.projectId)?'confirm':'submit';b.push('<button class="primary" onclick="logAction(\''+x.id+'\',\''+act+'\')">'+(act==='confirm'?'Xác nhận':'Gửi duyệt')+'</button>')}
 if(x.serverId&&x.status==='SUBMITTED'&&isLogLead(x.projectId)&&(canManageAssignments()||x.lastReview?.action!=='ESCALATE'))b.push('<button class="primary" onclick="logAction(\''+x.id+'\',\'approve\')">Duyệt</button>','<button onclick="logAction(\''+x.id+'\',\'reject\')">Trả lại</button>');
 if(x.serverId&&x.status==='APPROVED'&&isLogLead(x.projectId))b.push('<button onclick="logAction(\''+x.id+'\',\'lock\')">Khóa</button>');
 if(canReopenLog(x))b.push('<button onclick="reopenLog(\''+x.id+'\')">Mở lại</button>');
 if(x.serverId&&(x.fileCount||x.photoCount))b.push('<button onclick="showLogFiles(\''+x.id+'\')">Tệp ('+((x.fileCount||0)+(x.photoCount||0))+')</button>');
 if(canDownloadIn(x.projectId))b.push('<button onclick="exportDailyLog(\''+x.id+'\')">Xuất</button>');
 if(x.serverId)b.push(deleteBtn('log',x.serverId,x.projectId,'Báo cáo ngày '+progressDate(x.date)+' — '+shiftLabel(x.shift)));
 return b.join(' ');
}
async function showLogFiles(logId,loadedLog){
 const l=loadedLog||db.logs.find(v=>v.id===logId);if(!l?.serverId)return;
 try{const files=await apiRequest('/daily-logs/'+encodeURIComponent(l.serverId)+'/files');
  openModal('Tệp kèm báo cáo ngày '+progressDate(l.date)+' — '+shiftLabel(l.shift),'<div class="card">'+(files.length?'<ul>'+files.map(f=>'<li><a href="#" onclick="openServerFile(\'/daily-logs/'+l.serverId+'/files/'+f.id+'\','+esc(JSON.stringify({name:f.file_name,type:f.file_type}))+',false);return false">'+esc(f.file_name)+'</a> <span class="muted">('+fileSize(f.file_size)+')</span></li>').join('')+'</ul>':'<p class="muted">Không có tài liệu.</p>')+(l.photoCount?'<button onclick="'+(loadedLog?'showReviewPhotos()':'showLogPhotos(\''+l.id+'\')')+'">Xem '+l.photoCount+' ảnh hiện trường</button>':'')+'</div>')}
 catch(error){alert('Không tải được danh sách tệp: '+error.message)}
}
async function logAction(logId,action,silent){
 const l=db.logs.find(v=>v.id===logId);if(!l?.serverId)return alert('Báo cáo ngày chưa lên máy chủ.');
 if((action==='submit'||action==='confirm')&&(db.sync||[]).some(x=>x.type==='daily_log'&&x.recordId===l.id&&['PENDING','CONFLICT'].includes(x.status)))return alert('Báo cáo ngày còn nội dung chưa đồng bộ hoặc xung đột. Hãy đồng bộ và đối chiếu trước khi gửi duyệt.');
 if((action==='submit'||action==='confirm')&&typeof queuedFileCount==='function'&&await queuedFileCount('daily_log',l.id))return alert('Báo cáo ngày còn ảnh hoặc tài liệu chưa đồng bộ. Hãy kết nối mạng và chờ tải xong trước khi gửi duyệt.');
 if((action==='approve'||action==='reject')&&!silent)return openReviewDecision('daily_logs',l.serverId,action);
 const ask={submit:'Gửi báo cáo ngày này cho Trưởng TVGS duyệt? Sau khi gửi sẽ không sửa được (trừ khi bị trả lại).',confirm:'Xác nhận báo cáo ngày này? Bạn là người có quyền Duyệt tại công trình này nên báo cáo sẽ chuyển thẳng sang Đã duyệt, không qua bước Chờ duyệt.',reject:'Trả lại báo cáo ngày cho người lập sửa?',lock:'Khóa báo cáo ngày? Báo cáo đã khóa là hồ sơ chính thức.'}[action];
 if(ask&&!silent&&!confirm(ask))return;
 try{const r=await apiRequest('/daily-logs/'+encodeURIComponent(l.serverId)+'/'+action,{method:'POST'});l.status=r.status;l.version=Number(r.version||l.version||1);l.rowVersion=Number(r.row_version||l.rowVersion);l.canEdit=false;audit(action.toUpperCase(),'daily_log',l.serverId,l.date+' '+shiftLabel(l.shift));save()}
 catch(error){alert('Không thực hiện được: '+error.message)}
}
// Mở lại báo cáo ngày đã gửi/duyệt/khóa về Nháp để người lập sửa và gửi duyệt lại.
async function reopenLog(logId){
 const l=db.logs.find(v=>v.id===logId);if(!l?.serverId)return alert('Báo cáo ngày chưa lên máy chủ.');
 if(!confirm('Mở lại báo cáo ngày này về Nháp để sửa? Báo cáo sẽ cần gửi duyệt lại từ đầu.'))return;
 try{const r=await apiRequest('/daily-logs/'+encodeURIComponent(l.serverId)+'/reopen',{method:'POST'});l.status=r.status;l.version=Number(r.version||l.version||1);l.rowVersion=Number(r.row_version||l.rowVersion);l.canEdit=true;audit('REOPEN','daily_log',l.serverId,l.date+' '+shiftLabel(l.shift));save()}
 catch(error){alert('Không mở lại được: '+error.message)}
}
// TVGS trưởng: một nút "Duyệt tất cả" = Xác nhận nháp của chính mình + Duyệt bản thành viên đã gửi.
async function logBulkLead(confirmIds,approveIds){
 if(!confirmIds.length&&!approveIds.length)return;
 if(confirmIds.length&&typeof queuedFileCount==='function'){for(const id of confirmIds)if(await queuedFileCount('daily_log',id))return alert('Có báo cáo ngày của bạn còn ảnh hoặc tài liệu chưa đồng bộ. Hãy kết nối mạng và chờ tải xong trước khi xác nhận.')}
 const parts=[confirmIds.length?'Xác nhận '+confirmIds.length+' báo cáo ngày của bạn':'',approveIds.length?'Duyệt '+approveIds.length+' báo cáo ngày thành viên đã gửi':''].filter(Boolean);
 if(!confirm(parts.join('\n')+'?'))return;
 const lines=[];
 for(const [action,ids,label] of [['confirm',confirmIds,'Xác nhận'],['approve',approveIds,'Duyệt']]){
  if(!ids.length)continue;
  try{const r=await apiRequest('/daily-logs/bulk',{method:'POST',body:JSON.stringify({action,ids:ids.map(id=>db.logs.find(l=>l.id===id)?.serverId).filter(Boolean)})});
   r.done.forEach(x=>{const l=db.logs.find(v=>v.serverId===x.id);if(l){l.status=x.status;l.canEdit=false}});
   lines.push(label+' thành công '+r.done.length+'/'+ids.length+(r.failed.length?'. Không thực hiện được:\n'+r.failed.map(f=>{const l=db.logs.find(v=>v.serverId===f.id);return '- '+(l?l.date+' '+shiftLabel(l.shift):f.id)+': '+f.error}).join('\n'):'.'))}
  catch(error){lines.push(label+': không thực hiện được — '+error.message)}
 }
 save();alert(lines.join('\n'));
}
async function logBulk(action,ids){
 if(!ids.length)return;
 if(action==='submit'&&typeof queuedFileCount==='function'){const blocked=[];for(const id of ids)if(await queuedFileCount('daily_log',id))blocked.push(id);if(blocked.length)return alert(blocked.length+' báo cáo ngày còn ảnh hoặc tài liệu chưa đồng bộ. Hãy kết nối mạng và chờ tải xong trước khi gửi duyệt.')}
 const label={submit:'Gửi duyệt',approve:'Duyệt',lock:'Khóa'}[action];
 if(!confirm(label+' '+ids.length+' báo cáo ngày?'))return;
 try{const r=await apiRequest('/daily-logs/bulk',{method:'POST',body:JSON.stringify({action,ids:ids.map(id=>db.logs.find(l=>l.id===id)?.serverId).filter(Boolean)})});
  r.done.forEach(x=>{const l=db.logs.find(v=>v.serverId===x.id);if(l){l.status=x.status;l.canEdit=false}});save();
  alert(label+' thành công '+r.done.length+'/'+ids.length+(r.failed.length?'.\nKhông thực hiện được:\n'+r.failed.map(f=>{const l=db.logs.find(v=>v.serverId===f.id);return '- '+(l?l.date+' '+shiftLabel(l.shift):f.id)+': '+f.error}).join('\n'):'.'))}
 catch(error){alert('Không thực hiện được: '+error.message)}
}
const typeLabel=x=>qualityType(x)==='LETTER'?'Th\u01b0 k\u1ef9 thu\u1eadt':(qualityType(x)==='MINUTES'?'Bi\u00ean b\u1ea3n hi\u1ec7n tr\u01b0\u1eddng':'Ch\u01b0a x\u00e1c \u0111\u1ecbnh');
function renderPeople(){}
function renderAudit(){document.getElementById('auditTable').innerHTML=`<table><thead><tr><th>Th&#x1edd;i gian</th><th>Ng&#x01b0;&#x1eddi th&#x1ef1;c hi&#x1ec7;n</th><th>H&#x00e0;nh &#x0111;&#x1ed9;ng</th><th>&#x0110;&#x1ed1;i t&#x01b0;&#x1ee3ng</th><th>Chi ti&#x1ebft</th></tr></thead><tbody>${db.audit.slice(0,100).map(x=>`<tr><td>${fmt(x.at)}</td><td>${esc(x.actor)}</td><td>${esc(x.action)}</td><td>${esc(x.entity)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</tbody></table>`}
// ============================================================================
// TIẾN ĐỘ THI CÔNG — bảng tiến độ có cấu trúc, so sánh kế hoạch/thực tế theo hạng mục
// Số liệu so sánh lấy từ danh sách hạng mục (nhập từ Excel/dán/nhập tay).
// Tệp gốc (PDF/ảnh/Excel) chỉ là căn cứ đính kèm, mở qua API (không dùng data: URL).
// ============================================================================
const WEIGHT_BASIS_LABELS={VALUE:'Theo giá trị dự toán',MANUAL:'Theo tỷ trọng % nhập tay',DURATION:'Theo thời gian thực hiện'};
function todayIso(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function daysBetween(a,b){if(!a||!b)return '';return Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000)+1}
function numVN(n,k=0){if(n===null||n===undefined||n==='')return '';return Number(n).toLocaleString('vi-VN',{maximumFractionDigits:k})}
function canUpdateActual(pid){return canManageAssignments()||(typeof canCreateLogIn==='function'&&canCreateLogIn(pid))}
function apiOnline(){return typeof getAuthToken==='function'&&!!getAuthToken()}
function applyParsed(result){
 if(!result.items?.length&&result.error){alert(result.error);return}
 if(progressEditor.items.some(i=>i.hasActual)&&!confirm('Bảng này đã có số liệu thực tế. Nạp danh sách mới sẽ thay toàn bộ hạng mục và XÓA số liệu thực tế cũ khi lưu. Nên tạo "Bảng tiến độ mới / gia hạn" thay vì ghi đè. Vẫn tiếp tục?'))return;
 progressEditor.items=result.items.map(i=>({code:i.code||'',name:i.name,unit:i.unit||'',quantity:i.quantity,weight:i.weight,start_date:i.start_date,end_date:i.end_date,include:i.include,is_group:i.is_group,problems:i.problems}));
 progressEditor.warnings=[...(result.header_row?['Đã đọc tiêu đề ở dòng '+result.header_row+': '+Object.values(result.columns||{}).join(' | ')]:[]),...(result.warnings||[])];
 const basisSel=document.getElementById('ppBasis');if(basisSel&&result.columns&&!result.columns.weight)basisSel.value='DURATION';
 renderProgressItems();
}
function wideModal(){document.querySelector('#modal .modalbox')?.classList.add('wide')}
function renderAll(){
const qualityNav=document.querySelector('nav button[data-page="issues"]');if(qualityNav)qualityNav.innerHTML='⚠️ <span>Chất lượng công trình</span>';const qualityHeading=document.querySelector('#issues h2');if(qualityHeading)qualityHeading.textContent='Chất lượng công trình';
const addPersonButton=document.getElementById('addPersonButton');if(addPersonButton)addPersonButton.style.display=canManageAssignments()?'':'none';
const settingsNav=document.querySelector('nav button[data-page="settings"]');if(settingsNav)settingsNav.style.display=canManageAssignments()?'':'none';if(!canManageAssignments()&&document.getElementById('settings')?.classList.contains('active'))goPage('projects');
if(typeof applyInboxNavVisibility==='function')applyInboxNavVisibility();
if(typeof applyTrashNavVisibility==='function')applyTrashNavVisibility();
enforceDashboardAccess();renderSelects();if(canViewDashboard())renderDashboard();renderProjects();renderLogs();renderIssues();renderDocs();if(typeof renderReports==='function')renderReports();renderPeople();renderAudit();
document.getElementById('role').value=db.role;updateNet();renderHeaderUser();
if(currentProjectId&&document.getElementById('projectDetail').classList.contains('active'))renderProjectDetail();
}
function openModal(title,body){if(window.__forcePw)return;document.querySelector('#modal .modalbox')?.classList.remove('wide');document.getElementById('mtitle').textContent=title;document.getElementById('mbody').innerHTML=body;document.getElementById('modal').classList.add('show')}
function closeModal(){if(window.__forcePw)return;document.getElementById('modal').classList.remove('show')}
function toDataURL(file){return new Promise(r=>{let a=new FileReader();a.onload=()=>r(a.result);a.readAsDataURL(file)})}
const LEGAL_FILE_SLOTS=[['Hồ sơ dự thầu / HSĐX','d_hs_sdt','.pdf,.doc,.docx,.xls,.xlsx,.zip,image/*',true],['Đề cương giám sát','d_de_cuong','.pdf,.doc,.docx',true],['Biểu mẫu kèm theo đề cương giám sát','d_bieu_mau','.pdf,.doc,.docx,.xls,.xlsx,.zip',true],['Quyết định phê duyệt tổ tư vấn giám sát','d_quyet_dinh','.pdf,.doc,.docx,image/*',true],['Chứng chỉ của các thành viên tổ giám sát','d_chung_chi','.pdf,.doc,.docx,.zip,image/*',true],['Tài liệu khác','d_khac','*/*',true]];
const REPORT_FILE_SLOTS=[['Nguồn báo cáo nhà thầu','d_reportFile','.pdf,.doc,.docx,.xls,.xlsx,image/*',true],['Tài liệu khác','d_khac','*/*',true]];
function docTypeLabel(code){return (DOC_TYPES.find(x=>x[0]===code)||[code,code||'Tài liệu'])[1]}
function docGroup(x){return x?.group==='REPORT'?'REPORT':'LEGAL'}
function docStatusBadge(s){return '<span class="badge '+String(s||'').toLowerCase()+'">'+esc(DOC_STATUS[s]||s||'')+'</span>'}
function fileSize(n){n=Number(n||0);return n>1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB'}
// Chỉ PDF/ảnh thường được mở trực tiếp. Tệp mở bằng blob: chạy cùng nguồn với ứng dụng,
// nên HTML/SVG do người khác tải lên có thể đọc token đăng nhập → luôn tải về dạng nhị phân.
async function safeFileBlob(res){
 const t=String(res.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
 const inline=/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(t);
 return {blob:new Blob([await res.arrayBuffer()],{type:inline?t:'application/octet-stream'}),inline};
}
// Mở/tải tệp từ máy chủ có kèm token đăng nhập
async function openServerFile(apiPath,meta,download){
 const match=apiPath.match(/^\/(documents|daily-logs|issues|projects)\/([^/]+)\//);
 if(match){const collection={documents:'docs','daily-logs':'logs',issues:'issues',projects:'projects'}[match[1]];const record=(db[collection]||[]).find(x=>x.id===match[2]||x.serverId===match[2]);if(record&&!canDownloadIn(match[1]==='projects'?record.id:record.projectId))return alert('Bạn chưa được cấp quyền tải xuống tại công trình này.');}
 if(!apiOnline())return alert('Cần kết nối mạng để mở tệp.');
 const viewable=/^(application\/pdf|image\/)/i.test(meta?.type||'')||/\.(pdf|png|jpe?g|webp|gif)$/i.test(meta?.name||'');
 if(!viewable)download=true;
 const win=download?null:window.open('','_blank');
 try{
  const res=await fetch(API_BASE+apiPath,{headers:{Authorization:'Bearer '+getAuthToken()}});
  if(!res.ok){let m='HTTP '+res.status;try{m=(await res.json()).error||m}catch(_){}throw new Error(m)}
  const f=await safeFileBlob(res);if(!f.inline){download=true;if(win)win.close()}
  const url=URL.createObjectURL(f.blob);
  if(download||!win){const a=document.createElement('a');a.href=url;a.download=meta?.name||'tai-lieu';document.body.appendChild(a);a.click();a.remove()}else win.location.href=url;
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){if(win)win.close();alert('Không mở được tệp: '+error.message)}
}
function docFileLinks(x,{withDelete=false}={}){
 const files=x.files||[];if(!files.length)return '<span class="muted">Chưa có tệp</span>';
 if(!canDownloadIn(x.projectId))return files.map(f=>'<span class="muted">'+esc(f.name)+'</span>'+(withDelete?' <button type="button" class="danger" onclick="deleteDocFile(\''+x.id+'\',\''+f.id+'\')">✕</button>':'')).join(', ');
 const groups={};files.forEach(f=>{(groups[f.category||'Tài liệu']=groups[f.category||'Tài liệu']||[]).push(f)});
 return Object.entries(groups).map(([cat,list])=>'<div style="margin:3px 0"><b>'+esc(cat)+'</b>: '+list.map(f=>'<a href="#" onclick="openServerFile(\'/documents/'+x.id+'/files/'+f.id+'\','+esc(JSON.stringify({name:f.name,type:f.type}))+',false);return false">'+esc(f.name)+'</a> <span class="muted">('+fileSize(f.size)+')</span>'+(withDelete?' <button type="button" class="danger" style="padding:2px 6px" onclick="deleteDocFile(\''+x.id+'\',\''+f.id+'\')">✕</button>':'')).join(', ')+'</div>').join('');
}
async function docWorkflow(docId,action){
 if(action==='approve'||action==='reject')return openReviewDecision('documents',docId,action);
 let body={};if(action==='reopen'){const reason=prompt('Lý do mở khóa hồ sơ:');if(!reason)return;body={reason}}
 try{const r=await apiRequest('/documents/'+encodeURIComponent(docId)+'/'+action,{method:'POST',body:JSON.stringify(body)});upsertLocalDoc(mapDocumentFromApi(r));save();viewDoc(docId);if(typeof renderReports==='function')renderReports()}
 catch(error){alert('Không thực hiện được: '+error.message)}
}
async function deleteDocFile(docId,fileId){
 if(!confirm('Xóa tệp này khỏi hồ sơ?'))return;
 try{await apiRequest('/documents/'+encodeURIComponent(docId)+'/files/'+encodeURIComponent(fileId),{method:'DELETE'});const r=await apiRequest('/documents/'+encodeURIComponent(docId));const doc=mapDocumentFromApi(r);upsertLocalDoc(doc);save();const box=document.getElementById('docExistingFiles');if(box)box.innerHTML=docFileLinks(doc,{withDelete:true})}
 catch(error){alert('Không xóa được: '+error.message)}
}
async function uploadDocFile(docId,file,category){
 const res=await fetch(API_BASE+'/documents/'+encodeURIComponent(docId)+'/files?category='+encodeURIComponent(category)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file});
 if(!res.ok){let m='HTTP '+res.status;try{m=(await res.json()).error||m}catch(_){}throw new Error(m)}
 return res.json();
}
// Tệp đính kèm văn bản chất lượng (bản ký/scan) — lưu qua issue_files trên máy chủ, không còn base64 cục bộ.
async function uploadIssueFile(issueId,file){
 const res=await fetch(API_BASE+'/issues/'+encodeURIComponent(issueId)+'/files?name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file});
 if(!res.ok){let m='HTTP '+res.status;try{m=(await res.json()).error||m}catch(_){}throw new Error(m)}
 return res.json();
}
function issueFileLinksHtml(files){
 if(!Array.isArray(files)||!files.length)return '<span class="muted">Chưa có tệp</span>';
 const issue=db.issues.find(x=>x.id===files[0].issueId);
 if(issue&&!canDownloadIn(issue.projectId))return files.map(f=>'<span class="muted">'+esc(f.file_name)+'</span>').join(', ');
 return files.map(f=>'<a href="#" onclick="openServerFile(\'/issues/'+f.issueId+'/files/'+f.id+'\','+esc(JSON.stringify({name:f.file_name,type:f.file_type}))+',false);return false">'+esc(f.file_name)+'</a> <span class="muted">('+fileSize(f.file_size)+')</span>').join(', ');
}
// Đổ danh sách tệp đã tải lên vào khung `boxId` sau khi mở modal (văn bản đã tồn tại trên máy chủ mới có tệp để liệt kê).
async function renderIssueFilesBox(boxId,issueId){
 const box=document.getElementById(boxId);if(!box)return;
 if(!issueId||!apiOnline()){box.innerHTML='';return}
 try{
  const files=await apiRequest('/issues/'+encodeURIComponent(issueId)+'/files');
  box.innerHTML=files.length?('<b>Bản ký/tài liệu đính kèm đã lưu trên máy chủ:</b> '+issueFileLinksHtml(files.map(f=>({...f,issueId})))):'';
 }catch(_){box.innerHTML=''}
}
// Lấy hồ sơ từ máy chủ cho mọi công trình được xem; đồng thời đẩy hồ sơ cũ còn nằm trong trình duyệt lên máy chủ.
async function syncDocumentsFromApi(){
 if(!apiOnline()||typeof apiGetDocuments!=='function')return;
 await syncLegacyLocalDocs();
 await syncPendingDocuments();
 const fetched=[];let failed=false;
 for(const project of serverProjects()){try{fetched.push(...await apiGetDocuments(project.id))}catch(error){failed=true;console.warn('Không tải được hồ sơ công trình:',project.id,error.message)}}
 const pending=new Set((db.sync||[]).filter(x=>x.type==='document'&&['PENDING','CONFLICT'].includes(x.status)).map(x=>x.recordId));
 const leftover=(db.docs||[]).filter(x=>x.pendingUpload||pending.has(x.id));
 if(!failed||fetched.length)db.docs=[...fetched.filter(x=>!pending.has(x.id)),...leftover];
 save();
}
const LEGACY_TYPE={'HỒ SƠ PHÁP LÝ':'HS','BIÊN BẢN':'BB','NHẬT KÝ':'NK','THIẾT KẾ THUẬT':'TK','BÁO CÁO':'BC'};
function downloadDocumentFile(docId,index){const x=db.docs.find(v=>v.id===docId);const f=x?.files?.[index];if(f)openServerFile('/documents/'+x.id+'/files/'+f.id,{name:f.name,type:f.type},true)}

// ============================================================================
// BÁO CÁO TVGS: ngày / tuần / tháng / hoàn thành
// Số liệu tổng hợp tự động từ nhật ký, văn bản chất lượng, hồ sơ, bảng tiến độ → người lập bổ sung
// nhận xét, kiến nghị → lưu thành hồ sơ nhóm "Báo cáo" (dùng chung quy trình Gửi duyệt/Duyệt/Khóa).
// ============================================================================
const REPORT_TYPES={DAILY:'Tổng hợp ngày',WEEKLY:'Báo cáo tuần',MONTHLY:'Báo cáo tháng',FINAL:'Báo cáo hoàn thành'};
const REPORT_SECTIONS={
 DEFAULT:[['quality','Đánh giá chất lượng thi công'],['schedule','Đánh giá tiến độ'],['safety','An toàn lao động, vệ sinh môi trường'],['issues','Tồn tại và kiến nghị'],['next','Kế hoạch kỳ tới']],
 FINAL:[['quality','Đánh giá chất lượng công trình'],['schedule','Đánh giá tiến độ thực hiện'],['safety','An toàn lao động, vệ sinh môi trường'],['issues','Tồn tại đã/chưa khắc phục'],['conclusion','Kết luận và đề nghị nghiệm thu']]
};
function suggestSection(k,s){
 const p=s.progress;
 if(k==='schedule'&&p)return 'Gợi ý: Kế hoạch lũy kế '+p.planned_percent+'%, thực tế '+p.actual_percent+'% ('+(p.variance>=0?'+':'')+p.variance+' điểm %).'+(p.late_items.length?' Hạng mục chậm: '+p.late_items.map(i=>i.name).join(', ')+'.':'');
 if(k==='issues'&&s.issues.open_total)return 'Gợi ý: còn '+s.issues.open_total+' nội dung chất lượng chưa đóng.';
 if(k==='quality')return 'Nhận xét về vật liệu, công tác nghiệm thu, biên bản kiểm tra trong kỳ...';
 return '';
}
function sumByDay(logs){const m={};logs.forEach(l=>{const x=m[l.date]=m[l.date]||{date:l.date,shifts:[],work:[],workers:0,machines:0,weather:[]};x.shifts.push(shiftLabel(l.shift));if(l.work)x.work.push(l.work);if(l.weather)x.weather.push(l.weather);x.workers+=Number(l.workers||0);x.machines+=Number(l.machines||0)});return Object.values(m)}
function seed(){
if(db.projects.length)return alert('Đã có dữ liệu.');
let p1={id:id(),code:'CT-2026-001',name:'Công trình mẫu Hà Nội',province:'Hà Nội',client:'Chủ đầu tư A',address:'Hà Nội',progress:62,status:'ĐANG THI CÔNG',
contractNo:'HĐ-TVGS-2026-001',contractDate:'2026-01-15',contractValue:2500000000,contractContent:'Giám sát thi công phần móng và thân nhà cao tầng. Thời hạn 18 tháng. Bao gồm giám sát chất lượng, an toàn, tiến độ.'};
let p2={id:id(),code:'CT-2026-002',name:'Công trình mẫu Phú Yên',province:'Phú Yên',client:'Chủ đầu tư B',address:'Phú Yên',progress:48,status:'ĐANG THI CÔNG',
contractNo:'HĐ-TVGS-2026-002',contractDate:'2026-03-01',contractValue:1800000000,contractContent:'Giám sát hạ tầng giao thông và hệ thống thoát nước.'};
p1.createdAt=p2.createdAt=new Date().toISOString(); db.projects.push(p1,p2);
db.people.push({id:id(),name:'Nguyễn Văn A',role:'Trưởng TVGS',certs:'CCGS',projectId:p1.id},{id:id(),name:'Trần Văn B',role:'Kỹ sư TVGS',certs:'',projectId:p1.id});
db.logs.push({id:id(),projectId:p1.id,date:new Date().toISOString().slice(0,10),work:'Thi công bê tông móng M1',workers:35,machines:8,progress:62,note:'Bình thường',photos:[],status:'ĐÃ KIỂM TRA',version:1,createdBy:'Trưởng TVGS'});
db.issues.push({id:id(),code:'VĐ-2026-0001',projectId:p1.id,title:'Chậm cung cấp vật liệu',detail:'Nhà thầu cần bổ sung kế hoạch cung ứng.',priority:'CAO',due:'2026-09-17',status:'ĐANG XỬ LÝ'});
db.docs.push({id:id(),code:'HS-2026-0001',projectId:p1.id,type:'BÁO CÁO',name:'Báo cáo tuần mẫu',version:1,status:'ĐÃ KHÓA',createdBy:'Trưởng TVGS'});
audit('SEED','system','', 'Dữ liệu mẫu');
save();
}
function exportJSON(){let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vina-supervision-backup.json';a.click()}
function clearAll(){if(confirm('Xóa toàn bộ dữ liệu cục bộ?')){localStorage.removeItem(KEY);location.reload()}}
function updateNet(){let el=document.getElementById('net');const conflicts=(db.sync||[]).filter(x=>x.status==='CONFLICT');const pending=(db.sync||[]).filter(x=>x.status==='PENDING');el.textContent=(navigator.onLine?'● ONLINE':'● OFFLINE')+(conflicts.length?' · '+conflicts.length+' bản cần đối chiếu':pending.length?' · '+pending.length+' bản chờ':'');el.style.background=conflicts.length?'#b42318':(navigator.onLine?'#027a48':'#b54708');el.onclick=(conflicts.length||pending.length)?showConflictDrafts:null}

let activeEditVersion=null;
function captureEditVersion(type,recordId,record){activeEditVersion={type,recordId,version:record?.rowVersion??null}}
function editVersion(type,recordId,record){return activeEditVersion?.type===type&&activeEditVersion.recordId===recordId?activeEditVersion.version:record?.rowVersion??null}
function showQueuedConflict(type,recordId){
 const item=(db.sync||[]).find(x=>x.type===type&&x.recordId===recordId&&(x.status==='CONFLICT'||(x.status==='PENDING'&&x.lastError&&apiOnline())));
 if(!item)return false;
 alert((item.lastError||'Nội dung đã được người khác cập nhật.')+' Nội dung đang nhập và tệp chờ vẫn được giữ trên thiết bị.');
 updateNet();return true;
}
function exportConflictDraft(queueId){
 const item=(db.sync||[]).find(x=>x.id===queueId);if(!item)return;
 const blob=new Blob([JSON.stringify({type:item.type,recordId:item.recordId,payload:item.payload,error:item.lastError},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='vina-ban-nhap-'+item.recordId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const DRAFT_TYPES={project:'Công trình',daily_log:'Báo cáo ngày',issue:'Chất lượng',document:'Hồ sơ / báo cáo'};
const DRAFT_COLLECTIONS={project:'projects',daily_log:'logs',issue:'issues',document:'docs'};
const DRAFT_PATHS={project:'projects',daily_log:'daily-logs',issue:'issues',document:'documents'};
function draftKind(x){return x.lastErrorCode==='EDIT_CONFLICT'?'Người khác đã sửa':x.status==='CONFLICT'?'Dữ liệu bị từ chối':'Chưa đồng bộ';}
function draftIsNew(x){const local=db[DRAFT_COLLECTIONS[x.type]]?.find(r=>r.id===x.recordId);return x.operation==='CREATE'&&!local?.serverId&&!x.savedResult&&!x.savedRowVersion;}
function showConflictDrafts(){
 const items=(db.sync||[]).filter(x=>['CONFLICT','PENDING'].includes(x.status));
 openModal('Bản nhập cần đối chiếu','<p>Nội dung và tệp trên thiết bị được giữ. Đối chiếu chỉ đọc; không tự ghi đè bản máy chủ.</p>'+items.map(x=>'<div class="card"><b>'+esc(DRAFT_TYPES[x.type]||x.type)+'</b><p><strong>'+esc(draftKind(x))+'</strong> '+esc(x.lastError||'Đang chờ gửi')+'</p><button onclick="compareConflictDraft(\''+x.id+'\')">Xem hai bản</button> '+(x.status==='PENDING'?'<button onclick="retryPendingDraft(\''+x.id+'\')">Thử đồng bộ lại</button> ':'')+(draftIsNew(x)||draftKind(x)==='Dữ liệu bị từ chối'?'<button onclick="editRejectedDraft(\''+x.id+'\')">Sửa bản nhập</button> ':'')+'<button onclick="exportConflictDraft(\''+x.id+'\')">Xuất bản nháp JSON</button> <button onclick="discardConflictDraft(\''+x.id+'\')">'+(draftIsNew(x)?'Bỏ bản tạo mới trên máy':'Bỏ bản nháp, tải bản mới')+'</button></div>').join('')+(items.length?'':'<p>Không có bản nhập đang chờ.</p>'));
}
async function retryPendingDraft(queueId){
 const item=(db.sync||[]).find(x=>x.id===queueId);if(!item||item.status!=='PENDING')return;
 if(!navigator.onLine)return alert('Thiết bị đang mất mạng. Bản nhập vẫn được giữ.');
 const fn={project:syncPendingProjects,daily_log:syncPendingDailyLogs,document:syncPendingDocuments,issue:syncPendingIssues}[item.type];
 try{if(fn)await fn();}catch(error){alert('Chưa đồng bộ được; bản nhập vẫn được giữ. '+error.message)}
 showConflictDrafts();
}
async function editRejectedDraft(queueId){
 const x=(db.sync||[]).find(r=>r.id===queueId);if(!x||(!draftIsNew(x)&&draftKind(x)!=='Dữ liệu bị từ chối'))return;
 const open={project:openProject,daily_log:openLog,document:openDoc,issue:openIssue}[x.type];if(open)await open(x.recordId);
}
function draftReadable(value){
 if(value===null||value===undefined||value==='')return '—';
 if(Array.isArray(value))return value.map(draftReadable).join('\n')||'—';
 if(typeof value==='object')return Object.entries(value).filter(([k])=>!['id','data','content','blob','serverId'].includes(k)).map(([k,v])=>(DRAFT_LABELS[k]||k)+': '+draftReadable(v)).join('\n')||'—';
 const words={DRAFT:'Nháp',SUBMITTED:'Chờ duyệt',APPROVED:'Đã duyệt',LOCKED:'Đã khóa',RETURNED:'Yêu cầu chỉnh sửa',OPEN:'Đang mở',CLOSED:'Đã đóng',CA1:'Ca 1',CA2:'Ca 2',CA3:'Ca 3'};
 return typeof value==='boolean'?(value?'Có':'Không'):(Object.hasOwn(words,value)?words[value]:String(value));
}
const DRAFT_LABELS={name:'Tên',code:'Mã',title:'Tiêu đề',detail:'Nội dung',date:'Ngày',shift:'Ca',work:'Công việc',note:'Ghi chú',weather:'Thời tiết',workers:'Nhân lực',machines:'Máy móc',workerItems:'Loại nhân lực',machineItems:'Loại máy',technicalStaffCount:'Cán bộ kỹ thuật',recommendation:'Kiến nghị',contractorUnit:'Nhà thầu',itemCategory:'Hạng mục',contractNo:'Số hợp đồng',contractDate:'Ngày hợp đồng',contractValue:'Giá trị hợp đồng',contractContent:'Nội dung hợp đồng',province:'Tỉnh/thành',address:'Địa chỉ',client:'Chủ đầu tư',progress:'Tiến độ',status:'Trạng thái',priority:'Mức độ',due:'Hạn',type:'Loại',details:'Nội dung chi tiết',sections:'Nhận xét',quality:'Chất lượng',schedule:'Tiến độ',safety:'An toàn',issues:'Tồn tại',next:'Kế hoạch tới',conclusion:'Kết luận',count:'Số lượng',unit:'Đơn vị',recipients:'Nơi nhận',documentType:'Loại văn bản',file_name:'Tên tệp',file_size:'Dung lượng',full_name:'Họ tên'};
DRAFT_LABELS.files='Tệp trên máy / tệp đang chờ';
function draftComparisonRows(label,left,right,hasServer){
 if((left&&typeof left==='object'&&!Array.isArray(left))||(right&&typeof right==='object'&&!Array.isArray(right))){
  const keys=[...new Set([...Object.keys(left||{}),...Object.keys(right||{})])].filter(k=>!['id','data','content','blob','serverId'].includes(k));
  return keys.map(k=>draftComparisonRows(label+' / '+(DRAFT_LABELS[k]||k),left?.[k],right?.[k],hasServer)).join('');
 }
 const a=draftReadable(left),b=hasServer?draftReadable(right):'Chưa có / chưa tải được';const different=hasServer&&a!==b;
 return '<tr'+(different?' style="background:#fff3cd"':'')+'><th>'+esc(label)+(different?' · Khác':'')+'</th><td style="white-space:pre-wrap">'+esc(a)+'</td><td style="white-space:pre-wrap">'+esc(b)+'</td></tr>';
}
async function compareConflictDraft(queueId){
 const item=(db.sync||[]).find(x=>x.id===queueId);if(!item)return;
 openModal('Đối chiếu '+(DRAFT_TYPES[item.type]||''),'<p id="draftCompare">Đang tải bản máy chủ; bản nhập trên máy được giữ nguyên...</p>');
 const box=document.getElementById('draftCompare');
 const local=db[DRAFT_COLLECTIONS[item.type]]?.find(r=>r.id===item.recordId)||{};
 let server=null,message='Bản tạo mới chưa có trên máy chủ.';
 if(!draftIsNew(item))try{
   const raw=await apiRequest('/'+DRAFT_PATHS[item.type]+'/'+encodeURIComponent(local.serverId||item.recordId));
   server={project:mapProjectFromApi,daily_log:mapDailyLogFromApi,document:mapDocumentFromApi,issue:mapIssueFromApi}[item.type](raw);
 }catch(error){message='Không tải được bản máy chủ: '+error.message;}
 if(!box.isConnected)return;
 const payload=item.type==='document'?{...local,...(item.payload.name!==undefined?{name:item.payload.name}:{}),...(item.payload.details!==undefined?{details:item.payload.details}:{}),...(item.payload.type!==undefined?{type:item.payload.type}:{})}:item.payload||{};
 const left={...local,...payload};
 const pendingFiles=typeof queuedFiles==='function'?await queuedFiles(item.type,item.recordId):[];
 left.files=[...(local.files||[]).map(f=>({name:f.name||f.file_name})),...pendingFiles.map(f=>({name:f.name}))];
 if(!box.isConnected)return;
 const fields=Object.keys(DRAFT_LABELS).filter(k=>k in left||(server&&k in server));
 box.outerHTML='<div id="draftCompare"><p>'+esc(draftKind(item))+'. '+(server?'Ô màu vàng có nội dung khác nhau.':esc(message))+'</p><div style="overflow:auto"><table><thead><tr><th>Nội dung</th><th>Bản trên máy</th><th>Bản máy chủ</th></tr></thead><tbody>'+fields.map(k=>draftComparisonRows(DRAFT_LABELS[k],left[k],server?.[k],!!server)).join('')+'</tbody></table></div><p>Bản nhập và hàng đợi/tệp vẫn được giữ. Bản máy chủ không bị thay đổi.</p><button onclick="showConflictDrafts()">Quay lại danh sách</button></div>';
}
async function discardConflictDraft(queueId){
 const fresh=(db.sync||[]).find(x=>x.id===queueId);if(!fresh||fresh.sending)return;
 if(draftIsNew(fresh)){
  if(!confirm('Bỏ bản tạo mới và tệp chờ trên thiết bị này? Nội dung chưa có trên máy chủ sẽ bị bỏ.'))return;
  if(typeof queuedFiles==='function')for(const file of await queuedFiles(fresh.type,fresh.recordId))await removeQueuedFile(file.id);
  db[DRAFT_COLLECTIONS[fresh.type]]=db[DRAFT_COLLECTIONS[fresh.type]].filter(x=>x.id!==fresh.recordId);
  db.sync=db.sync.filter(x=>x.recordId!==fresh.recordId||x.type!==fresh.type);save();showConflictDrafts();return;
 }
 if(!apiOnline())return alert('Cần kết nối mạng để tải bản mới.');
 if(!confirm('Bạn đã xuất hoặc sao chép nội dung cần giữ? Bỏ bản nháp chỉ trên thiết bị này và tải lại bản máy chủ.'))return;
 const item=db.sync.find(x=>x.id===queueId);if(!item)return;
 // Fetch before discarding: a failed request must preserve the draft.
 try{
  const paths={project:'projects',daily_log:'daily-logs',issue:'issues',document:'documents'};
  const raw=await apiRequest('/'+paths[item.type]+'/'+encodeURIComponent(item.recordId));
  const collection={project:'projects',daily_log:'logs',issue:'issues',document:'docs'}[item.type];
  const mapper={project:mapProjectFromApi,daily_log:mapDailyLogFromApi,issue:mapIssueFromApi,document:mapDocumentFromApi}[item.type];
  const index=db[collection].findIndex(x=>x.id===item.recordId||x.serverId===item.recordId);
  if(index>=0)db[collection][index]={...mapper(raw),id:db[collection][index].id,serverId:raw.id};
  db.sync=db.sync.filter(x=>x.id!==queueId);save();closeModal();
 }catch(error){alert('Chưa tải được bản mới; bản nháp vẫn được giữ. '+error.message)}
}
function renderHeaderUser(){const el=document.getElementById('hdrUser');if(!el)return;const u=typeof getAuthUser==='function'?getAuthUser():null;if(!u){el.textContent='';return}const roleLabel=(typeof ROLE_LABELS!=='undefined'&&ROLE_LABELS[u.role_name])||db.role||u.role_name||'';el.textContent=(u.full_name||u.username||'')+(roleLabel?' · '+roleLabel:'')}

async function showLogPhotos(logId,loadedLog){
  const log=loadedLog||db.logs.find(x=>x.id===logId);
  if(!log)return;
  openModal('Ảnh hiện trường','<p id="photoGallery" class="muted">Đang tải ảnh...</p>');
  let photos=(log.photos||[]).filter(x=>x.data);
  if(apiOnline() && (log.serverId||log.id)){
    try{
      const serverId=log.serverId||log.id;
      const files=await apiRequest('/daily-logs/'+encodeURIComponent(serverId)+'/attachments');
      photos=[];
      for(const file of files){
        const image=await apiRequest('/daily-logs/'+encodeURIComponent(serverId)+'/attachments/'+encodeURIComponent(file.id));
        photos.push({name:file.file_name,data:image.data_url});
      }
    }catch(error){const gallery=document.getElementById('photoGallery');if(gallery)gallery.textContent='Không tải được ảnh: '+error.message;return}
  }
  const gallery=document.getElementById('photoGallery');
  if(gallery)gallery.innerHTML=photos.length
    ? photos.map(p=>`<div><img class="photo" src="${p.data}" alt="${esc(p.name)}"><div class="muted">${esc(p.name)}</div></div>`).join('')
    : 'Báo cáo ngày này chưa có ảnh.';
}
const ACCOUNT_TYPES=['TVGS_LEAD','ENGINEER','MANAGER','DIRECTOR','ADMIN'];
function cleanPersonName(v){return String(v||'').normalize('NFC').replace(/\s+/g,' ').trim()}
async function quickAssign(pid,userId){
 const title=prompt('Chức danh tại công trình (công việc được giao):','GS viên');if(title===null)return;
 try{await apiRequest('/project-members',{method:'POST',body:JSON.stringify({project_id:pid,user_id:userId,assignment_title:title.trim()})});await refreshTeamViews(pid)}
 catch(error){alert('Không phân công được: '+error.message)}
}
function accountOptionsHtml(users,selectedId){
 const order=ACCOUNT_TYPES;const groups={};
 users.forEach(u=>{(groups[u.role_name]=groups[u.role_name]||[]).push(u)});
 return Object.keys(groups).sort((a,b)=>(order.indexOf(a)+99*(order.indexOf(a)<0))-(order.indexOf(b)+99*(order.indexOf(b)<0))).map(role=>'<optgroup label="'+esc(ROLE_LABELS[role]||role)+'">'+groups[role].sort((a,b)=>a.username.localeCompare(b.username)).map(u=>'<option value="'+u.id+'"'+(u.id===selectedId?' selected':'')+'>'+esc(u.username)+'</option>').join('')+'</optgroup>').join('');
}
function localOnlyNotice(){
 const n=(db.projects||[]).filter(p=>p._localOnly).length;
 return n?'<div class="notice" style="margin-bottom:10px">'+n+' công trình chỉ có trên thiết bị (chưa đồng bộ hoặc bị từ chối do trùng mã/số hợp đồng) nên không phân công được. Xem mục Công trình.</div>':'';
}
async function loadAssignableUsers(force=false){
 if(!canManageAssignments()||!getAuthToken())return [];
 if(assignmentUsers.length&&!force)return assignmentUsers;
 try{assignmentUsers=(await apiRequest('/users')).filter(u=>u.is_active!==false)}catch(error){console.warn('Không tải được tài khoản:',error.message)}
 return assignmentUsers;
}
// Tên đăng nhập tự đặt (khớp backend userService.normalizeUsername)
const USERNAME_RE=/^[a-z0-9][a-z0-9._@-]{2,49}$/;
const USERNAME_RULE='Tên đăng nhập 3–50 ký tự: chữ không dấu, số, dấu chấm, gạch dưới, gạch ngang, @ (không bắt đầu bằng ký hiệu).';
function meName(){return qualityAuthUser()?.full_name||qualityAuthUser()?.username||''}

// ---- Phiếu tài khoản: hiện 1 lần sau khi tạo / đặt lại mật khẩu ----
let lastSlip=null;
async function copyAccountSlip(){
 if(!lastSlip)return;const t=slipText(lastSlip);const m=document.getElementById('slipMsg');
 try{await navigator.clipboard.writeText(t);if(m)m.textContent='Đã sao chép — dán vào Zalo/email gửi cho người dùng.'}
 catch(_){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');if(m)m.textContent='Đã sao chép.'}catch(__){if(m)m.textContent='Trình duyệt chặn sao chép — hãy bôi đen và sao chép thủ công.'}ta.remove()}
}
function printAccountSlip(){
 if(!lastSlip)return;const w=window.open('','_blank');if(!w)return alert('Trình duyệt chặn cửa sổ in.');
 w.document.write('<!doctype html><meta charset="utf-8"><title>Phiếu tài khoản</title><style>body{font-family:Arial,sans-serif;padding:24px}pre{font-size:16px;line-height:1.8;border:2px dashed #999;padding:16px;white-space:pre-wrap}</style><pre>'+esc(slipText(lastSlip))+'</pre>');
 w.document.close();setTimeout(()=>{w.focus();w.print()},300);
}
function returnedHtml(){
 const k=v=>JSON.stringify(v).replace(/"/g,'&quot;');const ret=inboxData?.returned||[];
 return ret.length?'<table><thead><tr><th>Loại</th><th>Nội dung</th><th>Công trình</th><th>Yêu cầu</th><th></th></tr></thead><tbody>'+ret.map(it=>'<tr><td>'+esc(inboxKindLabel(it))+'</td><td>'+inboxContent(it)+'</td><td>'+esc(it.project_name||'')+'</td><td><div class="review-note reject" style="margin:0">'+esc(it.comment||'')+'<br><span class="muted">'+esc(it.reviewer_name||'')+' · '+esc(fmt(it.reviewed_at))+'</span></div></td><td><button class="primary" onclick="closeModal();openReturnedItem('+k(it.kind)+','+k(it.id)+')">Sửa và gửi lại</button></td></tr>').join('')+'</tbody></table>':'<p class="muted">Không có bản nào bị trả lại.</p>';
}
function openReturnedModal(){document.getElementById('inboxBanner')?.remove();openModal('Bản của tôi bị yêu cầu chỉnh sửa, bổ sung',returnedHtml());document.querySelector('#modal .modalbox')?.classList.add('wide')}
async function openReturnedItem(kind,id){
 if(kind==='documents'){
  let d=(db.docs||[]).find(v=>v.id===id);
  if(!d){try{d=mapDocumentFromApi(await apiRequest('/documents/'+encodeURIComponent(id)));upsertLocalDoc(d);save()}catch(error){return alert('Không mở được: '+error.message)}}
  return d.details?.snapshot?openReport(id):openDoc(id);
 }
 const l=(db.logs||[]).find(v=>v.serverId===id);
 if(!l)return alert('Báo cáo ngày chưa tải về thiết bị này. Hãy tải lại trang (Ctrl+F5) rồi thử lại.');
 openLog(l.id);
}
// ============================================================================
// TỔNG QUAN TIẾN ĐỘ & CẢNH BÁO (bản 2026-10-04)
// Admin/Giám đốc: toàn bộ công trình · Thành viên: chỉ công trình được phân công (máy chủ lọc)
// ============================================================================
const HEALTH_LABEL={RED:'Nghiêm trọng',AMBER:'Cần chú ý',GREEN:'Bình thường',DONE:'Hoàn thành',PAUSED:'Tạm dừng',UNKNOWN:'Chưa rõ'};
function signed(v){return v==null?'—':(v>0?'+':'')+v}
function toggleRpActMode(){const manual=document.querySelector('input[name="rpActMode"]:checked')?.value==='MANUAL';document.querySelectorAll('.rpAct').forEach(i=>i.disabled=!manual)}
function rpActChanged(input){const v=Number(input.value),p=Number(input.dataset.planned);const cell=input.closest('tr')?.querySelector('.rpVar');if(cell&&Number.isFinite(v)){const d=Math.round((v-p)*100)/100;cell.textContent=signed(d);cell.style.color=d<-5?'#b42318':'inherit'}input.style.background=String(input.value)!==String(input.dataset.orig)?'#fffaeb':''}
