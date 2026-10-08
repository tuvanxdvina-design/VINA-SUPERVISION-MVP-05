function personnelChangeRows(value){const arr=Array.isArray(value)?value:(value?[{date:'',removed:'',added:'',decision:String(value)}]:[]);return (arr.length?arr:[{date:'',removed:'',added:'',decision:''}]).map(v=>`<div class="personnel-change-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr minmax(170px,1.2fr) auto;gap:8px;margin:6px 0"><input class="pc-date" type="date" value="${esc(v.date||'')}" aria-label="Ngày thay thế"><input class="pc-removed" value="${esc(v.removed||'')}" placeholder="Người rút"><input class="pc-added" value="${esc(v.added||'')}" placeholder="Người thay thế"><input class="pc-decision" value="${esc(v.decision||'')}" placeholder="Số quyết định TK"><input class="pc-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Tệp quyết định thay thế"><button type="button" onclick="this.parentElement.remove()">Xóa</button></div>`).join('')}
function addPersonnelChangeRow(){const box=document.getElementById('personnelChangesList');if(!box)return;const d=document.createElement('div');d.className='personnel-change-row';d.style='display:grid;grid-template-columns:1fr 1fr 1fr 1fr minmax(170px,1.2fr) auto;gap:8px;margin:6px 0';d.innerHTML='<input class="pc-date" type="date" aria-label="Ngày thay thế"><input class="pc-removed" placeholder="Người rút"><input class="pc-added" placeholder="Người thay thế"><input class="pc-decision" placeholder="Số quyết định TK"><input class="pc-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Tệp quyết định thay thế"><button type="button" onclick="this.parentElement.remove()">Xóa</button>';box.appendChild(d)}
const TITLE_OPTIONS=['TVGS trưởng','GS viên','GS hiện trường','Kỹ sư TVGS','Phụ trách hồ sơ','An toàn lao động','Khác'];
let assignmentUsers=[];
let teamRowsByProject={};
let teamErrorByProject={};
async function syncProjectPersonnel(projectId){
 if(!projectId||!canManageAssignments()||!apiOnline())return;
 const project=(db.projects||[]).find(p=>p.id===projectId);if(!project||project._localOnly)return;
 const pending=(db.people||[]).filter(x=>projectMatchesPerson(x,project)&&x.name&&x.role&&!x.syncedAt);
 let changed=false;
 for(const person of pending){
  try{
   await apiRequest('/project-personnel',{method:'POST',body:JSON.stringify({project_id:projectId,full_name:cleanPersonName(person.name),assignment_title:person.role,certificate:person.certs||''})});
   db.people=db.people.filter(x=>x.id!==person.id);changed=true; // đã lên máy chủ: máy chủ là nguồn chuẩn
  }catch(error){person.lastError=error.message;console.warn('Chưa đồng bộ được nhân sự công trình:',error.message)}
 }
 if(changed)persistLocal();
}
async function fetchTeam(pid,{sync=true}={}){
 const project=(db.projects||[]).find(p=>p.id===pid)||{};
 const pending=(db.people||[]).filter(x=>projectMatchesPerson(x,project)&&!x.syncedAt).map(x=>({key:'l:'+x.id,localId:x.id,full_name:cleanPersonName(x.name),assignment_title:x.role||'',certificate:x.certs||'',account_status:'PENDING_SYNC',access_permissions:[],permission_source:'NONE'}));
 let rows=null;
 if(apiOnline()&&!project._localOnly){
  try{
   if(sync)await syncProjectPersonnel(pid);
   rows=await apiRequest('/project-personnel/project/'+encodeURIComponent(pid)+'/team');
   delete teamErrorByProject[pid];
   db.teamCache=db.teamCache||{};db.teamCache[pid]={at:new Date().toISOString(),rows};persistLocal();
  }catch(error){teamErrorByProject[pid]=error.message;console.warn('Không tải được danh sách nhân sự:',error.message)}
 }
 if(!rows)rows=db.teamCache?.[pid]?.rows||[];
 const stillPending=pending.filter(l=>!rows.some(r=>cleanPersonName(r.full_name).toLocaleLowerCase('vi')===l.full_name.toLocaleLowerCase('vi')));
 const all=[...rows,...stillPending].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),'vi'));
 teamRowsByProject[pid]=all;
 return all;
}
function teamTableHtml(allRows,pid,{compact=false}={}){
 const mgr=allRows.filter(r=>r.role_name==='MANAGER'&&!r.personnel_id);const rows=allRows.filter(r=>!mgr.includes(r));
 if(!rows.length&&!mgr.length)return '<p class="muted">Chưa có nhân sự được phân công.</p>';
 const mgrHtml=mgr.length?'<h4 style="margin:14px 0 6px">Cấp quản lý theo dõi công trình</h4><table><tbody>'+mgr.map(r=>'<tr class="clickable" onclick="openTeamMember(\''+encodeURIComponent(r.key)+'\',\''+pid+'\')"><td><b>'+esc(r.full_name)+'</b></td><td>'+accountCell(r,pid)+'</td><td>'+permChips(r.access_permissions,r.permission_source)+'</td></tr>').join('')+'</tbody></table>':'';
 if(!rows.length)return '<p class="muted">Chưa có nhân sự TVGS.</p>'+mgrHtml;
 const head=compact?'<tr><th>Nhân sự</th><th>Chức danh tại công trình</th><th>Tài khoản</th></tr>':'<tr><th>Nhân sự</th><th>Chức danh tại công trình</th><th>Tài khoản</th><th>'+(canManageAssignments()?'Quyền truy cập':'Quyền của tôi')+'</th><th>Chứng chỉ</th></tr>';
 const body=rows.map(r=>{
  const click=' class="clickable" onclick="openTeamMember(\''+encodeURIComponent(r.key)+'\',\''+pid+'\')" title="Bấm để xem / chọn quyền truy cập"';
  const title=r.assignment_title?esc(r.assignment_title):'<span class="muted">Chưa nhập</span>';
  return compact?'<tr'+click+'><td><b>'+esc(r.full_name)+'</b></td><td>'+title+'</td><td>'+accountCell(r,pid)+'</td></tr>'
   :'<tr'+click+'><td><b>'+esc(r.full_name)+'</b>'+(r.work_scope?'<br><span class="muted">'+esc(r.work_scope)+'</span>':'')+'</td><td>'+title+'</td><td>'+accountCell(r,pid)+'</td><td>'+(canManageAssignments()?permChips(r.access_permissions,r.permission_source)+(r.account_status==='LINKED'&&isLeadTitle(r.assignment_title)&&!(r.access_permissions||[]).includes('APPROVE')?' <span class="chip danger" title="Quyền tùy chỉnh chưa có Duyệt — bấm để cấp">⚠ TVGS trưởng chưa có quyền Duyệt</span>':''):(r.is_me?permChips(r.access_permissions,r.permission_source)+' <span class="chip">Tài khoản của tôi</span>':''))+'</td><td>'+esc(r.certificate||'')+'</td></tr>';
 }).join('');
 return '<table><thead>'+head+'</thead><tbody>'+body+'</tbody></table>'+mgrHtml;
}
function teamErrorNotice(pid){
 const e=teamErrorByProject[pid];if(!e)return '';
 const cached=db.teamCache?.[pid]?.at;
 return '<div class="notice" style="margin-bottom:10px;background:#fef3f2;border-color:#fecdca"><b>Không tải được danh sách nhân sự từ máy chủ:</b> '+esc(e)+(cached?'<br>Đang hiển thị bản lưu lúc '+esc(fmt(cached))+'.':'<br>Danh sách dưới đây chỉ gồm dữ liệu trên thiết bị.')+(/user_id|column|relation/i.test(e)?'<br>Nguyên nhân thường gặp: cơ sở dữ liệu chưa chạy migration. Chạy <code>migrate-db.ps1</code> rồi khởi động lại.':'')+'</div>';
}
async function loadProjectTeamDirectory(projectId=''){
 const el=document.getElementById('projectTeamDirectory');const select=document.getElementById('directoryProject');if(!el||!select)return;
 const addBtn=document.getElementById('addPersonButton');if(addBtn)addBtn.style.display=canManageAssignments()?'':'none';
 const pid=fillProjectSelect(select,projectId||select.value||currentProjectId||'');
 if(!pid){el.innerHTML=localOnlyNotice()+'<p class="muted">Chưa chọn công trình.</p>';return}
 el.innerHTML='<p class="muted">Đang tải...</p>';
 const rows=await fetchTeam(pid);if(select.value!==pid)return;
 el.innerHTML=localOnlyNotice()+teamErrorNotice(pid)+'<p class="muted">Mỗi nhân sự hiển thị một lần. '+(canManageAssignments()?'Bấm vào một người để sửa chức danh, liên kết tài khoản và chọn quyền truy cập.':'Bấm vào một người để xem chi tiết.')+'</p>'+teamTableHtml(rows,pid);
 const extra=await unassignedAuthorsHtml(pid);if(extra&&select.value===pid)el.insertAdjacentHTML('beforeend',extra);
}
function titleSelectHtml(prefix,value){
 const legacy={'Trưởng TVGS':'TVGS trưởng','Tư vấn giám sát viên':'GS viên'};const v=legacy[value]||value||'';
 const sel=TITLE_OPTIONS.includes(v)?v:(v?'Khác':'GS viên');
 return '<select id="'+prefix+'Title" onchange="document.getElementById(\''+prefix+'TitleOther\').style.display=this.value===\'Khác\'?\'\':\'none\'">'+TITLE_OPTIONS.map(o=>'<option'+(o===sel?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select><input id="'+prefix+'TitleOther" maxlength="120" placeholder="Nhập chức danh khác" style="margin-top:6px;display:'+(sel==='Khác'?'':'none')+'" value="'+esc(sel==='Khác'?v:'')+'">';
}
function readTitle(prefix){const s=document.getElementById(prefix+'Title')?.value||'';return s==='Khác'?(document.getElementById(prefix+'TitleOther')?.value||'').trim():s}
// Chọn đúng tên gợi ý (nhân sự đã có ở công trình khác) → điền sẵn chứng chỉ nếu ô chứng chỉ đang trống,
// để khỏi gõ lại — chức danh tại công trình này vẫn do người dùng tự chọn/sửa riêng.
function onTeamNameInput(input){
 const match=(window.__tmNameSuggestions||[]).find(n=>n.full_name.toLocaleLowerCase('vi')===String(input.value||'').trim().toLocaleLowerCase('vi'));
 const certInput=document.getElementById('tmCert');
 if(match&&certInput&&!certInput.value.trim()&&match.certificate)certInput.value=match.certificate;
}
// Đổi chức danh trong cửa sổ → cập nhật quyền mặc định hiển thị (Trưởng TVGS tại công trình = có quyền Duyệt)
function refreshPermDefaults(){
 const span=document.getElementById('tmDefaultsText');if(!span)return;
 const roleName=span.dataset.role||'';const title=readTitle('tm');
 span.textContent='('+defaultsLabel(roleName,title)+')';
 const mode=document.querySelector('input[name="tmPermMode"]:checked')?.value;
 if(mode==='DEFAULT'){const d=defaultPermsFor(roleName,title);document.querySelectorAll('.tmPerm').forEach(c=>c.checked=d.includes(c.value))}
 // Quyền tùy chỉnh là lựa chọn rõ ràng của quản trị; đổi chức danh không tự cấp lại Duyệt.
 const warn=document.getElementById('tmLeadWarn');if(warn)warn.style.display=mode==='CUSTOM'&&isLeadTitle(title)&&!document.querySelector('.tmPerm[value=APPROVE]')?.checked?'':'none';
}
function grantApproveNow(){const c=document.querySelector('.tmPerm[value=APPROVE]');if(c){c.disabled=false;c.checked=true}const w=document.getElementById('tmLeadWarn');if(w)w.innerHTML='✔ Đã tích quyền <b>Duyệt</b> — bấm <b>Lưu thay đổi</b> để áp dụng.'}
function permEditorHtml(r,roleName,titleArg){
 const global=['ADMIN','DIRECTOR'].includes(roleName);
 const custom=r&&r.permission_source==='CUSTOM';
 const title=titleArg!==undefined?titleArg:(document.getElementById('tmTitle')?readTitle('tm'):(r?.assignment_title||''));
 const defaults=defaultPermsFor(roleName,title);
 const current=custom&&Array.isArray(r?.access_permissions)?r.access_permissions:defaults;
 if(global)return '<fieldset class="perm-box"><legend>Quyền truy cập tại công trình</legend><p class="muted">Tài khoản '+esc(ROLE_LABELS[roleName])+' có toàn quyền trên mọi công trình.</p></fieldset>';
 const disabled=custom?'':' disabled';
 return '<fieldset class="perm-box"><legend>Quyền truy cập tại công trình</legend>'
  +'<label class="inline"><input type="radio" name="tmPermMode" value="DEFAULT"'+(custom?'':' checked')+' onchange="toggleTeamPermMode();refreshPermDefaults()"> Theo mặc định <span class="muted" id="tmDefaultsText" data-role="'+esc(roleName||'')+'">('+esc(defaultsLabel(roleName,title))+')</span></label>'
  +'<label class="inline"><input type="radio" name="tmPermMode" value="CUSTOM"'+(custom?' checked':'')+' onchange="toggleTeamPermMode();refreshPermDefaults()"> Tùy chỉnh cho công trình này</label>'
  +'<div id="tmLeadWarn" class="review-note reject" style="margin:6px 0;display:'+(custom&&isLeadTitle(title)&&!current.includes('APPROVE')?'':'none')+'">⚠ Chức danh là <b>'+esc(title)+'</b> nhưng quyền tùy chỉnh <b>chưa có "Duyệt"</b> → người này chưa phê duyệt được và không có mục "Việc cần duyệt". <button type="button" class="primary" onclick="grantApproveNow()">Cấp quyền Duyệt</button> hoặc chọn "Theo mặc định".</div>'
  +'<div class="perm-grid">'+PERM_ORDER.map(k=>'<label class="inline"><input type="checkbox" class="tmPerm" value="'+k+'"'+(current.includes(k)?' checked':'')+(k==='APPROVE'?' onchange="refreshPermDefaults()"':'')+(k==='VIEW'?' onclick="if(!this.checked){document.querySelectorAll(\'.tmPerm\').forEach(c=>c.checked=false)}"':k==='EDIT'?' onchange="if(this.checked){const c=document.querySelector(\'.tmPerm[value=CREATE]\');if(c)c.checked=true}"':k==='CREATE'?' onchange="if(!this.checked){const e=document.querySelector(\'.tmPerm[value=EDIT]\');if(e)e.checked=false}"':'')+disabled+'> '+esc(PERM_LABELS[k])+'</label>').join('')+'</div>'
  +'<p class="muted" style="margin:4px 0 0">Xem: xem dữ liệu · Thêm: lập báo cáo ngày/văn bản và sửa bản nháp của mình · Sửa (bao gồm Thêm): sửa, đóng/mở lại bản ghi của người khác · Tải xuống / in: xuất, in, tải tệp · <b>Duyệt</b>: phê duyệt / yêu cầu chỉnh sửa / trình công ty tại công trình này (mặc định có khi chức danh là TVGS trưởng) · <b>Xóa</b>: xóa báo cáo ngày, hồ sơ, báo cáo, văn bản chất lượng, bảng tiến độ (vào Thùng rác, khôi phục được) — mặc định chỉ Admin/Giám đốc, người khác chỉ có khi được tích ở đây.</p>'
  +'<label>Làm việc ở đâu</label><input id="tmScope" maxlength="240" value="'+esc(r?.work_scope||'')+'" placeholder="Ví dụ: Hiện trường, hồ sơ, báo cáo ngày"></fieldset>';
}
function toggleTeamPermMode(){const custom=document.querySelector('input[name="tmPermMode"]:checked')?.value==='CUSTOM';document.querySelectorAll('.tmPerm').forEach(el=>el.disabled=!custom)}
function readPermEditor(){
 const mode=document.querySelector('input[name="tmPermMode"]:checked')?.value;if(!mode)return {};
 const scope=(document.getElementById('tmScope')?.value||'').trim();
 if(mode==='DEFAULT')return {access_permissions:null,work_scope:scope};
 const list=[...document.querySelectorAll('.tmPerm:checked')].map(x=>x.value);if(list.length&&!list.includes('VIEW'))list.unshift('VIEW');
 return {access_permissions:list,work_scope:scope};
}
async function loadPersonnelFiles(personnelId){
 const box=document.getElementById('tmCertFiles');if(!box||!personnelId)return;
 const canDelete=canManageAssignments();
 try{
  const files=await apiRequest('/project-personnel/'+encodeURIComponent(personnelId)+'/files');
  box.innerHTML=files.length?files.map(f=>'<div><a href="#" onclick="openServerFile(\'/project-personnel/'+personnelId+'/files/'+f.id+'\','+esc(JSON.stringify({name:f.file_name,type:f.file_type}))+',false);return false">'+esc(f.file_name)+'</a> <span class="muted">('+fileSize(f.file_size)+')</span>'+(canDelete?' <button type="button" class="danger" style="padding:1px 6px" onclick="deletePersonnelFile(\''+personnelId+'\',\''+f.id+'\')">✕</button>':'')+'</div>').join(''):'<span class="muted">Chưa có tệp chứng chỉ.</span>';
 }catch(error){box.textContent='Không tải được danh sách tệp: '+error.message}
}
async function deletePersonnelFile(personnelId,fileId){
 if(!confirm('Xóa tệp chứng chỉ này?'))return;
 try{await apiRequest('/project-personnel/'+encodeURIComponent(personnelId)+'/files/'+encodeURIComponent(fileId),{method:'DELETE'});await loadPersonnelFiles(personnelId)}
 catch(error){alert('Không xóa được: '+error.message)}
}
async function uploadPersonnelCertificate(personnelId,file){
 const res=await fetch(API_BASE+'/project-personnel/'+encodeURIComponent(personnelId)+'/files?name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file});
 if(!res.ok){let message='HTTP '+res.status;try{message=(await res.json()).error||message}catch(_){}throw new Error(message)}
 return res.json();
}
async function openTeamMember(encodedKey,pid){
 const key=decodeURIComponent(encodedKey||'');
 const r=key?(teamRowsByProject[pid]||[]).find(x=>x.key===key):null;
 if(key&&!r)return alert('Không tìm thấy nhân sự. Hãy tải lại danh sách.');
 const p=(db.projects||[]).find(x=>x.id===pid)||{};
 const manager=canManageAssignments();
 if(!manager){
  if(!r)return;
  openModal('Nhân sự: '+r.full_name,'<div class="card"><p><b>Công trình:</b> '+esc(projectLabel(p))+'</p><p><b>Chức danh:</b> '+esc(r.assignment_title||'Chưa nhập')+'</p><p><b>Chứng chỉ:</b> '+esc(r.certificate||'—')+'</p>'+(r.personnel_id?'<p><b>Bản chụp/scan:</b></p><div id="tmCertFiles" class="muted">Đang tải...</div>':'')+(r.is_me?'<p><b>Tài khoản:</b> '+accountCell(r,pid)+'</p><p><b>Quyền của tôi tại công trình:</b> '+permChips(r.access_permissions,r.permission_source)+'</p><p><b>Làm việc ở đâu:</b> '+esc(r.work_scope||'—')+'</p>':'')+'</div>');
  if(r.personnel_id)void loadPersonnelFiles(r.personnel_id);
  return;
 }
 if(r&&r.account_status==='PENDING_SYNC')return alert('Nhân sự này đang chờ đồng bộ lên máy chủ. Hãy kết nối mạng và tải lại trang.');
 const users=await loadAssignableUsers();
 const linkedIds=new Set((teamRowsByProject[pid]||[]).filter(x=>x.user_id&&x.account_status==='LINKED'&&x!==r).map(x=>x.user_id));
 const accountOptions=accountOptionsHtml(users.filter(u=>!linkedIds.has(u.id)),r?.user_id);
 const isMemberOnly=r&&!r.personnel_id;
 const packages=await loadBiddingPackages(pid);
 const packageField=packages.length?'<div><label>Gói thầu phụ trách <span style="color:#b42318">*</span></label><select id="tmPackage"><option value="">— Chọn gói thầu —</option>'+packages.map(pk=>'<option value="'+pk.id+'"'+(pk.id===r?.bidding_package_id?' selected':'')+'>'+esc(pk.name)+'</option>').join('')+'</select><div class="muted">Công trình này có nhiều gói thầu — bắt buộc ấn định đúng 1 gói mà người này phụ trách.</div></div>':'';
 // Thêm mới (chưa có r): gợi ý chọn từ nhân sự đã có ở công trình khác thay vì luôn gõ tên mới.
 let nameSuggestions=[];
 if(!r&&canManageAssignments()){try{nameSuggestions=await apiRequest('/project-personnel/search?limit=50')}catch(_){nameSuggestions=[]}}
 window.__tmNameSuggestions=nameSuggestions;
 const nameFieldHtml=!r
  ?'<div><label>Họ tên <span class="muted" style="font-weight:400">(gõ mới hoặc chọn người đã có ở công trình khác)</span></label><input id="tmName" maxlength="255" list="tmNameSuggest" value="" oninput="onTeamNameInput(this)" autocomplete="off"><datalist id="tmNameSuggest">'+nameSuggestions.map(n=>'<option value="'+esc(n.full_name)+'">').join('')+'</datalist></div>'
  :'<div><label>Họ tên</label><input id="tmName" maxlength="255" value="'+esc(r?.full_name||'')+'"'+(isMemberOnly?' disabled title="Lấy theo tên tài khoản"':'')+'></div>';
 const info='<div class="row">'
  +nameFieldHtml
  +'<div><label>Chức danh tại công trình (công việc được giao)</label>'+titleSelectHtml('tm',r?.assignment_title||'')+'</div>'
  +packageField
  +'<div class="full"><label>Chứng chỉ</label><input id="tmCert" value="'+esc(r?.certificate||'')+'"></div>'
  +'<div class="full"><label>Bản chụp/scan chứng chỉ (chọn được nhiều tệp)</label><input id="tmCertFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple><div id="tmCertFiles" class="muted">'+(r?.personnel_id?'Đang tải...':'Tệp sẽ được lưu tập trung sau khi lưu.')+'</div></div>'+'</div>';
 let account='';
 if(r&&r.account_status==='LINKED'){
  const mismatch=r.account_name&&cleanPersonName(r.account_name).toLocaleLowerCase('vi')!==cleanPersonName(r.full_name).toLocaleLowerCase('vi');
  account='<fieldset class="perm-box"><legend>Tài khoản đăng nhập</legend><p id="tmAccLine">Đã liên kết: <b>'+esc(r.username)+'</b>'+(r.account_name?' ('+esc(r.account_name)+')':'')+' · '+esc(ROLE_LABELS[r.role_name]||r.role_name)+'</p>'
   +(mismatch?'<div class="review-note reject" style="margin:6px 0">⚠ Tài khoản <b>'+esc(r.username)+'</b> đang mang họ tên <b>'+esc(r.account_name)+'</b>, khác với nhân sự <b>'+esc(r.full_name)+'</b>.<br>'
     +'• Nếu tài khoản này <b>đúng là của '+esc(r.full_name)+'</b>: <button type="button" class="primary" onclick="openAccountFix(\''+encodedKey+'\',\''+pid+'\')">Đúng người — đổi họ tên tài khoản thành "'+esc(r.full_name)+'"</button><br>'
     +'• Nếu <b>gắn nhầm</b>: bấm "Thu hồi quyền truy cập", rồi mở lại người này để Tạo tài khoản mới.</div>':'')
   +'<div id="tmRenameBox"></div>'
   +'<div class="toolbar" style="margin:6px 0 0"><button type="button" onclick="showRenameUsername(\''+esc(r.user_id)+'\',\''+esc(r.username)+'\',\''+encodedKey+'\',\''+pid+'\')">Đổi tên đăng nhập</button><button type="button" onclick="resetTeamPassword(\''+esc(r.user_id)+'\',\''+encodedKey+'\',\''+pid+'\')">Đặt lại mật khẩu</button>'
   +(r.personnel_id?'<button type="button" onclick="unlinkTeamAccount(\''+encodedKey+'\',\''+pid+'\')">Thu hồi quyền truy cập (giữ trong danh sách)</button>':'')+'</div></fieldset>'+permEditorHtml(r,r.role_name,r.assignment_title||'');
 }else{
  account='<fieldset class="perm-box"><legend>Tài khoản đăng nhập</legend>'+(r?.account_status==='LINKED_NO_ACCESS'?'<p class="muted">Tài khoản <b>'+esc(r.username)+'</b> đã bị thu hồi quyền tại công trình. Chọn lại để cấp lại.</p>':'')
   +'<div class="row"><div><label>Loại tài khoản</label><select id="tmAccType" onchange="onTeamAccountChange()"><option value="">— Không có tài khoản —</option>'+ACCOUNT_TYPES.filter(t=>t!=='ADMIN'||roleToken(qualityAuthUser()?.role_name||'')==='ADMIN').map(t=>'<option value="'+t+'"'+(r?.role_name===t&&r?.user_id?' selected':'')+'>'+esc(ROLE_LABELS[t])+'</option>').join('')+'</select></div><div id="tmAccModeWrap"></div></div><div id="tmAccDetail"></div>'
   +'<input type="hidden" id="tmPrevUser" value="'+esc(r?.user_id||'')+'"><input type="hidden" id="tmProjectId" value="'+esc(pid)+'"></fieldset><div id="tmPermWrap"></div>';
 }
 const actions='<div class="toolbar"><button class="primary" onclick="saveTeamMember(\''+encodedKey+'\',\''+pid+'\')">Lưu thay đổi</button>'
  +(r?'<button class="danger" onclick="removeTeamMember(\''+encodedKey+'\',\''+pid+'\')">Rút khỏi công trình</button>':'')+'</div><div id="tmMessage" class="muted"></div>';
 openModal((r?'Nhân sự: '+r.full_name:'Thêm nhân sự')+' — '+(p.name||''),info+account+actions);
 if(!r||r.account_status!=='LINKED')onTeamAccountChange();
 document.getElementById('tmTitle')?.addEventListener('change',refreshPermDefaults);
 document.getElementById('tmTitleOther')?.addEventListener('input',refreshPermDefaults);
 document.getElementById('tmNewUsername')?.dispatchEvent(new Event('input'));
 if(r?.personnel_id)void loadPersonnelFiles(r.personnel_id);
}
async function saveTeamMember(encodedKey,pid){
 const key=decodeURIComponent(encodedKey||'');const r=key?(teamRowsByProject[pid]||[]).find(x=>x.key===key):null;
 const msg=document.getElementById('tmMessage');const say=t=>{if(msg)msg.textContent=t};
 const name=cleanPersonName(document.getElementById('tmName')?.value);const title=readTitle('tm');const cert=(document.getElementById('tmCert')?.value||'').trim();
 const packageSelect=document.getElementById('tmPackage');const packageId=packageSelect?.value||'';
 const certFiles=[...(document.getElementById('tmCertFile')?.files||[])];const bigCert=certFiles.find(f=>f.size>15*1024*1024);if(bigCert)return say('Tệp "'+bigCert.name+'" vượt 15 MB.');
 if(!name)return say('Nhập họ tên.');if(!title)return say('Chọn hoặc nhập chức danh tại công trình.');
 if(packageSelect&&!packageId)return say('Công trình này đã khai báo Gói thầu — hãy chọn gói thầu phụ trách cho nhân sự này.');
 if(!r){const dup=(teamRowsByProject[pid]||[]).find(x=>cleanPersonName(x.full_name).toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi'));if(dup)return say('Đã có "'+dup.full_name+'" trong danh sách công trình. Đóng cửa sổ này và bấm vào tên đó để sửa.')}
 const perm=readPermEditor();const accType=document.getElementById('tmAccType')?.value||'';const accMode=document.querySelector('input[name="tmAccMode"]:checked')?.value||'';
 let accountId=accType&&accMode==='EXISTING'?(document.getElementById('tmAccount')?.value||''):'';
 const newAccount=accType&&accMode==='NEW'?{username:(document.getElementById('tmNewUsername')?.value||'').trim().toLowerCase(),password:document.getElementById('tmNewPassword')?.value||'',role_name:accType}:null;
 if(newAccount){if(!USERNAME_RE.test(newAccount.username))return say(USERNAME_RULE);if(document.getElementById('tmUserHint')?.dataset.taken==='1')return say('Tên đăng nhập đã có người dùng — chọn tên khác.');if(newAccount.password.length<8)return say('Mật khẩu ban đầu tối thiểu 8 ký tự.')}
 if(accType&&accMode==='EXISTING'&&!accountId)return say('Chọn tài khoản có sẵn.');
 if(!apiOnline()){
  if(certFiles.length)return say('Cần kết nối máy chủ để tải bản chụp/scan chứng chỉ.');
  if(r)return say('Đang mất mạng: chỉ thêm mới được khi offline, sửa/cấp quyền cần kết nối.');
  const p=(db.projects||[]).find(x=>x.id===pid)||{};
  db.people=db.people||[];db.people.push({id:id(),name,role:title,certs:cert,projectId:pid,projectCode:p.code||'',projectName:p.name||''});
  audit('CREATE','person','',name);save();closeModal();return loadProjectTeamDirectory(pid);
 }
 let createdSlip=null;let fileError='';
 try{
  say('Đang lưu...');
  let personnelId=r?.personnel_id||null;
  {
   const body={project_id:pid,full_name:name,assignment_title:title,certificate:cert,bidding_package_id:packageId||null};
   if(r&&!r.personnel_id&&r.user_id)body.user_id=r.user_id;
   const row=r?.personnel_id?await apiRequest('/project-personnel/'+encodeURIComponent(r.personnel_id),{method:'PUT',body:JSON.stringify(body)})
            :await apiRequest('/project-personnel',{method:'POST',body:JSON.stringify(body)});
   personnelId=row.id;
  }
  if(certFiles.length&&personnelId){
   const fails=[];
   for(const[i,f]of certFiles.entries()){say('Đang tải chứng chỉ '+(i+1)+'/'+certFiles.length+': '+f.name);try{await uploadPersonnelCertificate(personnelId,f)}catch(error){fails.push(f.name+': '+error.message)}}
   if(fails.length)fileError=fails.join('\n');
  }
  if(r&&r.account_status==='LINKED'){
   const body={...perm};if(!r.personnel_id)body.assignment_title=title;
   await apiRequest('/project-members/'+encodeURIComponent(r.member_id),{method:'PUT',body:JSON.stringify(body)});
  }else if((accountId||newAccount)&&personnelId){
   if(newAccount){const u=await apiRequest('/users',{method:'POST',body:JSON.stringify({...newAccount,full_name:name})});accountId=u.id;assignmentUsers.push(u);createdSlip={fullName:name,username:u.username,password:newAccount.password,role:ROLE_LABELS[u.role_name]||u.role_name,project:(db.projects||[]).find(x=>x.id===pid)?.name||'',title};say('Đã tạo tài khoản '+u.username+'. Đang cấp quyền...')}
   await apiRequest('/project-personnel/'+encodeURIComponent(personnelId)+'/link-account',{method:'POST',body:JSON.stringify({user_id:accountId,...perm})});
  }
  audit(r?'UPDATE':'CREATE','project_personnel',personnelId||r?.member_id||'',name+' — '+title);save();
  closeModal();await refreshTeamViews(pid);
  if(createdSlip)showAccountSlip(createdSlip);
  if(fileError)alert('Thông tin nhân sự đã lưu, nhưng tệp chứng chỉ chưa tải được: '+fileError);
 }catch(error){say('Không lưu được: '+error.message)}
}
async function unlinkTeamAccount(encodedKey,pid){
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));if(!r?.personnel_id)return;
 if(!confirm('Thu hồi quyền truy cập công trình của tài khoản '+r.username+'? '+r.full_name+' vẫn nằm trong danh sách nhân sự.'))return;
 try{await apiRequest('/project-personnel/'+encodeURIComponent(r.personnel_id)+'/unlink-account',{method:'POST'});audit('UNLINK_ACCOUNT','project_personnel',r.personnel_id,r.full_name);save();closeModal();await refreshTeamViews(pid)}
 catch(error){alert('Không thu hồi được: '+error.message)}
}
async function removeTeamMember(encodedKey,pid){
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));if(!r)return;
 if(!confirm('Rút '+r.full_name+' khỏi công trình? Nếu có tài khoản, quyền truy cập công trình cũng kết thúc.'))return;
 try{
  if(r.personnel_id)await apiRequest('/project-personnel/'+encodeURIComponent(r.personnel_id),{method:'DELETE'});
  else if(r.member_id)await apiRequest('/project-members/'+encodeURIComponent(r.member_id),{method:'DELETE'});
  audit('REMOVE','project_personnel',r.personnel_id||r.member_id,r.full_name);save();closeModal();await refreshTeamViews(pid);
 }catch(error){alert('Không rút được nhân sự: '+error.message)}
}
async function refreshTeamViews(pid){
 await fetchTeam(pid,{sync:false});
 const dir=document.getElementById('directoryProject');if(dir&&document.getElementById('people')?.classList.contains('active'))await loadProjectTeamDirectory(pid);
 const st=document.getElementById('settingsProject');if(st&&document.getElementById('settings')?.classList.contains('active'))await loadSettingsTeam();
 if(currentProjectId===pid)await loadProjectDetailMembers(pid);
 void loadQualityPermissions(true);
}
// ---- Thiết lập → Quản lý quyền theo công trình --------------------------------
async function loadSettingsProjects(){
 const box=document.getElementById('settingsAssignments');if(!box)return;
 box.style.display=canManageAssignments()?'':'none';if(!canManageAssignments()||!getAuthToken())return;
 const sel=document.getElementById('settingsProject');fillProjectSelect(sel,sel.value||currentProjectId||'');
 const users=await loadAssignableUsers(true);
 const userSelect=document.getElementById('assignmentUser');
 if(userSelect)userSelect.innerHTML='<option value="">Chọn tài khoản</option>'+accountOptionsHtml(users.filter(u=>!['ADMIN','DIRECTOR'].includes(u.role_name)));
 await loadSettingsTeam();
}
function loadAssignments(){return loadSettingsProjects()}
async function loadSettingsTeam(){
 const pid=document.getElementById('settingsProject')?.value||'';const el=document.getElementById('settingsTeam');if(!el)return;
 if(!pid){el.innerHTML=localOnlyNotice()+'<p class="muted">Chưa có công trình trên máy chủ để phân công.</p>';return}
 el.innerHTML='<p class="muted">Đang tải...</p>';
 const rows=await fetchTeam(pid);if(document.getElementById('settingsProject')?.value!==pid)return;
 el.innerHTML=localOnlyNotice()+teamErrorNotice(pid)+'<h3>Nhân sự của công trình</h3><p class="muted">Bấm vào một người để chọn quyền truy cập.</p>'+teamTableHtml(rows,pid);
 const extra=await unassignedAuthorsHtml(pid);if(extra&&document.getElementById('settingsProject')?.value===pid)el.insertAdjacentHTML('beforeend',extra);
}
async function addAssignment(){
 const project_id=document.getElementById('settingsProject').value;const user_id=document.getElementById('assignmentUser').value;
 const assignment_title=document.getElementById('assignmentTitle').value.trim();const message=document.getElementById('assignmentMessage');
 const user=assignmentUsers.find(u=>u.id===user_id);
 if(!project_id||!user){message.textContent='Hãy chọn công trình và tài khoản.';return}
 const existing=(teamRowsByProject[project_id]||[]).find(r=>r.user_id===user_id&&r.account_status==='LINKED');
 if(existing){message.textContent='Tài khoản '+user.username+' đã được phân công ('+existing.full_name+'). Bấm vào tên trong danh sách để sửa quyền.';return}
 try{
  await apiRequest('/project-members',{method:'POST',body:JSON.stringify({project_id,user_id,assignment_title})});
  message.textContent='Đã phân công tài khoản '+user.username+(assignment_title?' — '+assignment_title:'')+'. Quyền đang theo mặc định vai trò; bấm vào tên để tùy chỉnh.';
  document.getElementById('assignmentTitle').value='';
  await refreshTeamViews(project_id);
 }catch(error){message.textContent='Không phân công được: '+error.message}
}
// Tương thích lời gọi cũ
function openPerson(){const pid=document.getElementById('directoryProject')?.value||currentProjectId||serverProjects()[0]?.id||'';if(!pid)return alert('Chưa có công trình trên máy chủ.');openTeamMember('',pid)}
