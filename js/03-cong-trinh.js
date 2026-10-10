let currentProjectId=null;
function mergeProjectsFromServer(remoteProjects){
  const localQueue=db.sync.filter(x=>x.type==='project' && (x.status==='PENDING'||x.status==='CONFLICT'));
  const pendingIds=new Set(localQueue.map(x=>x.recordId));
  const queuedIds=new Set(localQueue.map(x=>x.recordId));
  const localById=new Map(db.projects.map(p=>[p.id,p]));
  const remoteById=new Map();remoteProjects.forEach(p=>{if(p&&p.id&&!remoteById.has(p.id))remoteById.set(p.id,p)});
  const conflicts=new Map(localQueue.filter(x=>x.status==='CONFLICT').map(x=>[x.recordId,x.lastError||'Bị máy chủ từ chối']));
  db.projects=[
    ...[...remoteById.values()].map(p=>pendingIds.has(p.id)?{...(localById.get(p.id)||p),_localOnly:false}:p),
    // Công trình tạo trên thiết bị nhưng chưa có trên máy chủ: giữ lại để không mất dữ liệu, gắn cờ để không đưa vào phân công.
    ...db.projects.filter(p=>queuedIds.has(p.id)&&!remoteById.has(p.id)).map(p=>({...p,_localOnly:true,_syncError:conflicts.get(p.id)||''}))
  ];
  const visibleIds=new Set(db.projects.map(p=>p.id));
  db.hidden=db.hidden||{};
  for(const collection of ['logs','issues','docs','people']){
    const records=new Map([...(db.hidden[collection]||[]),...(db[collection]||[])].map(x=>[x.id,x]));
    db[collection]=[...records.values()].filter(x=>!x.projectId||visibleIds.has(x.projectId));
    db.hidden[collection]=[...records.values()].filter(x=>x.projectId&&!visibleIds.has(x.projectId));
  }
}
function logProjectsForCreate(){return (db.projects||[]).filter(p=>canCreateLogIn(p.id))}
function projectsOptions(idSel){return db.projects.map(p=>`<option value="${p.id}" ${p.id===idSel?'selected':''}>${esc(p.code)} - ${esc(p.name)}</option>`).join('')}
function projectMatchesPerson(person,project){
  if(!person||!project)return false;
  if(String(person.projectId||'')===String(project.id||''))return true;
  const normalize=v=>String(v||'').trim().toLowerCase();
  const pCode=normalize(person.projectCode||person.contractNo);
  const pName=normalize(person.projectName);
  return (pCode&&pCode===normalize(project.code||project.contractNo))||(pName&&pName===normalize(project.name));
}
function goProjects(){currentProjectId=null;goPage('projects');renderAll()}
function openProjectSection(page){
  if(!currentProjectId)return;
  goPage(page);
  const selectId={daily:'logProject',issues:'issueProject',docs:'docProject'}[page];
  if(selectId){const el=document.getElementById(selectId);if(el){el.value=currentProjectId;el.dispatchEvent(new Event('change'));}}
  
  renderAll();
}
function openProjectDetail(pid){currentProjectId=pid;goPage('projectDetail');renderProjectDetail();void loadQualityPermissions(true);void syncDocumentsFromApi();void loadProjectDetailMembers(pid);void loadProjectProgressPlans(pid);if(typeof loadProjectHealth==='function')void loadProjectHealth(pid)}
function projectRows(arr,forDash=false){
return `<table><thead><tr><th>M&#x00e3;</th><th>C&#x00f4;ng tr&#x00ec;nh</th><th>&#x110;&#x1ecb;a b&#x00e0;n</th><th>H&#x1ee3;p &#x0111;&#x1ed3;ng</th><th>Ti&#x1ebfn &#x0111;&#x1ed9;</th><th>Tr&#x1ea1;ng th&#x00e1;i</th><th></th></tr></thead><tbody>${arr.map(p=>`<tr class="${forDash?'clickable':''}" ${forDash?`onclick="openProjectDetail('${p.id}')"`:''}><td>${esc(p.code)}</td><td><b>${esc(p.name)}</b>${p._localOnly?` <span class="chip warn" title="${esc(p._syncError||'')}">${p._syncError?'Máy chủ từ chối: '+esc(p._syncError):'Chưa đồng bộ'}</span>`:''}<br><span class="muted">${esc(p.client||'')}</span></td><td>${esc(p.province||'')}</td><td>${p.contractNo?esc(p.contractNo):'<span class="muted">—</span>'}${p.contractValue?`<br><span class="muted">${Number(p.contractValue).toLocaleString('vi-VN')} &#x0111;</span>`:''}</td><td>${p.progress||0}%</td><td>${statusBadge(p.status)}</td><td>${forDash?`<button onclick="event.stopPropagation();openProjectDetail('${p.id}')">Xem</button>`:`${canEditProject(p.id)?`<button onclick="openProject('${p.id}')">S&#x1eed;a</button> `:''}<button onclick="openProjectDetail('${p.id}')">Chi ti&#x1ebft</button>`}</td></tr>`).join('')}</tbody></table>`}
function renderProjects(){const nb=document.getElementById('newProjectButton');if(nb)nb.style.display=canManageAssignments()?'':'none';let q=(document.getElementById('projectSearch')?.value||'').toLowerCase();document.getElementById('projectsTable').innerHTML=projectRows(db.projects.filter(p=>(p.name+p.code+(p.province||'')+(p.contractNo||'')).toLowerCase().includes(q)))||'<p class="muted">Chưa có công trình.</p>'}
async function refreshProjectFromServer(projectId){try{const projects=await apiGetProjects();mergeProjectsFromServer(projects);save()}catch(_){}}

function renderProjectDetail(){
if(!currentProjectId)return;
const p=db.projects.find(x=>x.id===currentProjectId);
if(!p){goDashboard();return}
document.getElementById('pdEditBtn').style.display=canEditProject(p.id)?'':'none';
document.getElementById('pdTitle').textContent=`${p.code} — ${p.name}`;
document.getElementById('pdSub').textContent=`${p.client||''} · ${p.province||''} · Tiến độ ${p.progress||0}%`;
updateProjectRoleBadge(p.id);
document.getElementById('pdMeta').innerHTML=`
<div class="item"><b>Tr&#x1ea1;ng th&#x00e1;i</b>${statusBadge(p.status)}</div>
<div class="item"><b>&#x0110;&#x1ecb;a ch&#x1ec9;</b>${esc(p.address||'—')}</div>
<div class="item"><b>Ch&#x1ee7; &#x0111;&#x1ea7;u t&#x01b0;</b>${esc(p.client||'—')}</div>
<div class="item"><b>&#x0110;&#x1ecb;a b&#x00e0;n</b>${esc(p.province||'—')}</div>
<div class="item"><b>Ti&#x1ebfn &#x0111;&#x1ed9;</b>${p.progress||0}%</div>
<div class="item"><b>Ng&#x00e0;y t&#x1ea1;o</b>${fmt(p.createdAt)}</div>`;
const projectFileLink=(category,label)=>{const f=(p.files||[]).filter(x=>x.category===category).slice(-1)[0];return f?`<p><a href="#" onclick="openServerFile('/projects/${p.id}/files/${f.id}',${esc(JSON.stringify({name:f.name,type:f.type}))},false);return false">${label}: ${esc(f.name)}</a> <span class="muted">(${fileSize(f.size)})</span></p>`:''};
const tvgsLink=projectFileLink('TVGS_CONTRACT','Hợp đồng TVGS');
const contractorLink=projectFileLink('CONTRACTOR_CONTRACT','Hợp đồng nhà thầu');
document.getElementById('pdContract').innerHTML=`
<h4 style="margin:8px 0 6px">Thông tin hợp đồng</h4>
<h5>Tư vấn giám sát</h5><div class="detail-meta">
<div class="item"><b>Số hợp đồng</b>${esc(p.contractNo||'—')}</div><div class="item"><b>Ngày ký</b>${p.contractDate?fmtDate(p.contractDate):'—'}</div><div class="item"><b>Giá trị</b>${p.contractValue!=null&&p.contractValue!==''?Number(p.contractValue).toLocaleString('vi-VN')+' đ':'—'}</div></div>
${p.contractContent?`<p><b>Nội dung</b><br>${esc(p.contractContent).replace(/\n/g,'<br>')}</p>`:''}${tvgsLink}
<h5>Nhà thầu</h5><div class="detail-meta"><div class="item"><b>Số hợp đồng</b>${esc(p.contractorContractNo||'—')}</div><div class="item"><b>Ngày ký</b>${p.contractorContractDate?fmtDate(p.contractorContractDate):'—'}</div><div class="item"><b>Giá trị</b>${p.contractorContractValue!=null&&p.contractorContractValue!==''?Number(p.contractorContractValue).toLocaleString('vi-VN')+' đ':'—'}</div></div>
${p.contractorContractContent?`<p><b>Nội dung</b><br>${esc(p.contractorContractContent).replace(/\n/g,'<br>')}</p>`:''}${contractorLink}`;
renderProjectProgress(p);
const logs=db.logs.filter(x=>x.projectId===p.id&&canSeeLog(x));
const issues=db.issues.filter(x=>x.projectId===p.id);
const docs=db.docs.filter(x=>x.projectId===p.id);

document.getElementById('pdLogs').innerHTML=logs.length?`<table><thead><tr><th>Ngày</th><th>Công việc</th><th>NL</th><th>Máy</th><th>Trạng thái</th><th></th></tr></thead><tbody>${logs.map(x=>`<tr><td>${esc(x.date)}<br><span class="muted">${esc(shiftLabel(x.shift))}</span></td><td>${esc(x.work)}</td><td>${x.workers}</td><td>${x.machines}</td><td>${logStatusBadge(x.status)}</td><td>${canEditLog(x)?`<button onclick="openLog('${x.id}')">Sửa</button>`:'<span class="muted">Chỉ xem</span>'}</td></tr>`).join('')}</tbody></table>`:'<span class="muted">Chưa có báo cáo ngày</span>';
document.getElementById('pdIssues').innerHTML=issues.length?`<table><thead><tr><th>Mã</th><th>Tên văn bản</th><th>Loại văn bản</th><th>Trạng thái</th><th>Người tạo</th></tr></thead><tbody>${issues.map(x=>`<tr><td>${esc(x.code||'')}</td><td><b>${esc(x.title||typeLabel(x))}</b></td><td>${esc(typeLabel(x))}</td><td>${statusBadge(x.status)}</td><td>${esc(x.createdBy||x.created_by_name||'Chưa xác định')}</td></tr>`).join('')}</tbody></table>`:'<span class="muted">Không có nội dung chất lượng</span>';
document.getElementById('pdDocs').innerHTML=docs.length?`<table><thead><tr><th>Mã</th><th>Hồ sơ</th><th>Ver</th><th>TT</th><th></th></tr></thead><tbody>${docs.map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>v${x.version}</td><td>${docStatusBadge(x.status)}</td><td><button onclick="viewDoc('${x.id}')">Xem</button>${canModifyDoc(x)?` <button onclick="openDoc('${x.id}')">Sửa</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<span class="muted">Chưa có hồ sơ</span>';
{const pdPeople=document.getElementById('pdPeople');const cachedTeam=db.teamCache?.[p.id]?.rows;if(pdPeople)pdPeople.innerHTML=cachedTeam&&typeof teamTableHtml==='function'?teamTableHtml(cachedTeam,p.id,{compact:true}):'<span class="muted">Đang tải nhân sự...</span>'}
}
function editCurrentProject(){if(currentProjectId)openProject(currentProjectId)}
const CONTRACT_NATURE_TYPES=[['CONSULTING','Hợp đồng tư vấn xây dựng'],['CONSTRUCTION','Hợp đồng thi công xây dựng'],['SUPPLY','Hợp đồng mua sắm vật tư, thiết bị'],['EP','Hợp đồng EP (thiết kế - mua sắm)'],['EC','Hợp đồng EC (thiết kế - thi công)'],['PC','Hợp đồng PC (mua sắm - thi công)'],['EPC','Hợp đồng EPC'],['TURNKEY','Hợp đồng chìa khóa trao tay'],['OTHER','Hợp đồng khác']];
const CONTRACT_PRICE_TYPES=[['LUMP_SUM','Trọn gói'],['FIXED_UNIT_PRICE','Đơn giá cố định'],['ADJUSTABLE_UNIT_PRICE','Đơn giá điều chỉnh'],['TIME_BASED','Theo thời gian'],['COST_PLUS_FEE','Chi phí cộng phí'],['OUTPUT_BASED','Theo kết quả đầu ra'],['PERCENTAGE','Theo tỷ lệ phần trăm'],['MIXED','Kết hợp'],['OTHER','Hình thức khác']];
function contractOptions(items,current){return items.map(([value,label])=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`).join('')}
function parseVnNumber(value){const clean=String(value??'').replace(/\s/g,'').replace(/\./g,'').replace(',','.');const number=Number(clean);return Number.isFinite(number)?number:null}
function formatVnNumberInput(input){const number=parseVnNumber(input?.value);if(input&&number!==null)input.value=number.toLocaleString('vi-VN',{maximumFractionDigits:2})}
function dateFromDuration(start,duration){if(!start||!Number.isInteger(duration)||duration<1)return '';const date=new Date(start+'T00:00:00');date.setDate(date.getDate()+duration-1);return date.toISOString().slice(0,10)}
function durationFromDates(start,end){if(!start||!end)return null;const days=Math.round((new Date(end+'T00:00:00')-new Date(start+'T00:00:00'))/86400000)+1;return days>0?days:null}
function syncContractDuration(prefix,source){const start=document.getElementById(prefix+'StartDate');const end=document.getElementById(prefix+'EndDate');const days=document.getElementById(prefix+'ExecutionDays');if(!start||!end||!days)return;if(source==='days'){const value=Number(days.value);if(start.value&&Number.isInteger(value)&&value>0)end.value=dateFromDuration(start.value,value);return}days.value=durationFromDates(start.value,end.value)||''}
function openProject(pid=''){
if(pid?!canEditProject(pid):!canManageAssignments()){alert(pid?'Tài khoản chỉ được xem công trình được phân công.':'Chỉ Admin/Giám đốc được tạo công trình mới.');return;}
let p=db.projects.find(x=>x.id===pid)||{};captureEditVersion('project',pid,p);
const tvgsCurrent=(p.files||[]).filter(x=>x.category==='TVGS_CONTRACT').slice(-1)[0];const contractorCurrent=(p.files||[]).filter(x=>x.category==='CONTRACTOR_CONTRACT').slice(-1)[0];
const tvgsFile=tvgsCurrent?'<p class="muted">Tệp hiện tại: '+esc(tvgsCurrent.name)+'</p>':'';
const contractorFile=contractorCurrent?'<p class="muted">Tệp hiện tại: '+esc(contractorCurrent.name)+'</p>':'';
openModal(pid?'Sửa công trình':'Thêm công trình',`<div class="row">
<h3 class="full" style="margin:0">TƯ VẤN GIÁM SÁT</h3>
<div><label>Mã công trình</label><input id="fcode" value="${esc(p.code||'CT-2026-001')}"></div>
<div><label>Tên công trình</label><input id="fname" value="${esc(p.name||'')}"></div>
<div><label>Địa điểm</label><input id="fprovince" value="${esc(p.province||'')}"></div>
<div><label>Chủ đầu tư</label><input id="fclient" value="${esc(p.client||'')}"></div>
<div><label>Loại hợp đồng</label><select id="fconsultantContractType">${contractOptions(CONTRACT_NATURE_TYPES,p.consultantContractType||'CONSULTING')}</select></div>
<div><label>Hình thức giá hợp đồng</label><select id="fconsultantPriceType"><option value="">Chọn hình thức giá</option>${contractOptions(CONTRACT_PRICE_TYPES,p.consultantPriceType||'')}</select></div>
<div><label>Số hợp đồng</label><input id="fcontractNo" value="${esc(p.contractNo||'')}"></div>
<div><label>Ngày ký hợp đồng</label><input id="fcontractDate" type="date" value="${p.contractDate||''}"></div>
<div><label>Giá trị hợp đồng (VNĐ)</label><input id="fcontractValue" inputmode="decimal" value="${p.contractValue==null?'':Number(p.contractValue).toLocaleString('vi-VN',{maximumFractionDigits:2})}" onblur="formatVnNumberInput(this)"></div>
<div><label>Ngày bắt đầu TVGS</label><input id="fStartDate" type="date" value="${p.startDate||''}" onchange="syncContractDuration('f','dates')"></div>
<div><label>Ngày kết thúc TVGS</label><input id="fEndDate" type="date" value="${p.endDate||''}" onchange="syncContractDuration('f','dates')"></div>
<div><label>Số ngày thực hiện hợp đồng</label><input id="fExecutionDays" type="number" min="1" step="1" value="${p.contractDurationDays||durationFromDates(p.startDate,p.endDate)||''}" oninput="syncContractDuration('f','days')"></div>
<div class="full"><label>Nội dung hợp đồng</label><textarea id="fcontractContent" rows="3">${esc(p.contractContent||'')}</textarea></div>
<div class="full"><label>Tệp hợp đồng TVGS</label><input id="fcontractFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,image/*">${tvgsFile}</div>
<h3 class="full" style="margin:8px 0 0">GÓI THẦU (tùy chọn)</h3>
<div class="full"><p class="muted" style="margin:0 0 6px">Chỉ cần khai báo khi công trình có nhiều gói thầu/nhiều nhà thầu, mỗi nhà thầu thi công một số hạng mục riêng. Công trình đơn giản (1 nhà thầu) dùng ô "Tên nhà thầu" bên dưới, không cần khai báo mục này.</p>${pid&&!canManageAssignments()?'<p class="muted">Chỉ Admin/Giám đốc khai báo/sửa Gói thầu.</p>':pid?'<button type="button" onclick="openBiddingPackages(\''+pid+'\')">Quản lý Gói thầu</button>':'<p class="muted">Lưu công trình trước, sau đó bấm "Sửa công trình" lại để khai báo Gói thầu.</p>'}</div>
<h3 class="full" style="margin:8px 0 0">NHÀ THẦU</h3>
<div><label>Tên nhà thầu</label><input id="fcontractor" value="${esc(p.contractorName||'')}"></div>
<div><label>Loại hợp đồng</label><select id="fcontractorContractType">${contractOptions(CONTRACT_NATURE_TYPES,p.contractorContractType||'CONSTRUCTION')}</select></div>
<div><label>Hình thức giá hợp đồng</label><select id="fcontractorPriceType"><option value="">Chọn hình thức giá</option>${contractOptions(CONTRACT_PRICE_TYPES,p.contractorPriceType||'')}</select></div>
<div><label>Số hợp đồng nhà thầu</label><input id="fcontractorContractNo" value="${esc(p.contractorContractNo||'')}"></div>
<div><label>Ngày ký hợp đồng nhà thầu</label><input id="fcontractorContractDate" type="date" value="${p.contractorContractDate||''}"></div>
<div><label>Giá trị hợp đồng nhà thầu (VNĐ)</label><input id="fcontractorContractValue" inputmode="decimal" value="${p.contractorContractValue==null?'':Number(p.contractorContractValue).toLocaleString('vi-VN',{maximumFractionDigits:2})}" onblur="formatVnNumberInput(this)"></div>
<div><label>Ngày bắt đầu hoạt động</label><input id="fcontractorStartDate" type="date" value="${p.contractorStartDate||''}" onchange="syncContractDuration('fcontractor','dates')"></div>
<div><label>Ngày kết thúc hoạt động</label><input id="fcontractorEndDate" type="date" value="${p.contractorEndDate||''}" onchange="syncContractDuration('fcontractor','dates')"></div>
<div><label>Số ngày hoạt động của nhà thầu</label><input id="fcontractorExecutionDays" type="number" min="1" step="1" value="${p.contractorDurationDays||durationFromDates(p.contractorStartDate,p.contractorEndDate)||''}" oninput="syncContractDuration('fcontractor','days')"></div>
<div class="full"><label>Nội dung hợp đồng nhà thầu</label><textarea id="fcontractorContractContent" rows="3">${esc(p.contractorContractContent||'')}</textarea></div>
<div class="full"><label>Tệp hợp đồng nhà thầu</label><input id="fcontractorContractFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,image/*">${contractorFile}</div>
<div><label>Tiến độ kế hoạch hiện hành (%)</label><input id="fplannedProgress" type="number" min="0" max="100" step="0.1" value="${p.plannedProgress??''}"></div><div class="full"><label>Bảng tiến độ cơ sở của Nhà thầu (PDF hoặc ảnh)</label><input id="fbaselineProgressFile" type="file" accept="application/pdf,image/*"><div class="muted">Tệp là căn cứ đối chiếu tiến độ kế hoạch và thực tế.</div></div>
<div><label>Tiến độ thực tế tổng thể dự phòng (%)</label><input id="fprogress" type="number" min="0" max="100" step="0.1" value="${p.progress||0}"><div class="muted">Chỉ nhập khi chưa có bảng tiến độ chi tiết; khi có bảng, hệ thống dùng số liệu cập nhật mới nhất.</div></div>
<div><label>Trạng thái</label><select id="fstatus"><option>ĐANG THI CÔNG</option><option>CHUẨN BỊ</option><option>TẠM DỪNG</option><option>HOÀN THÀNH</option></select></div>
<div class="full"><label>Địa chỉ chi tiết</label><input id="faddress" value="${esc(p.address||'')}"></div>
<div class="full"><button class="primary" onclick="saveProject('${pid}')">Lưu công trình</button></div>
</div>`);
if(p.status)document.getElementById('fstatus').value=p.status;
}
async function saveProject(pid){
if(pid?!canEditProject(pid):!canManageAssignments())return alert('Bạn không có quyền sửa công trình.');
let p=db.projects.find(x=>x.id===pid);
const tvgsFile=document.getElementById('fcontractFile')?.files?.[0]||null;const contractorFile=document.getElementById('fcontractorContractFile')?.files?.[0]||null;
if([tvgsFile,contractorFile].some(f=>f&&f.size>25*1024*1024))return alert('Mỗi tệp hợp đồng tối đa 25 MB.');
const baselineFileInput=document.getElementById('fbaselineProgressFile')?.files?.[0];
if(baselineFileInput&&baselineFileInput.size>10*1024*1024)return alert('Bảng tiến độ tối đa 10 MB.');
let data={expectedRowVersion:editVersion('project',pid,p),code:fcode.value.trim(),name:fname.value.trim(),province:fprovince.value.trim(),client:fclient.value.trim(),contractorName:fcontractor.value.trim(),progress:+fprogress.value,plannedProgress:fplannedProgress.value===''?null:+fplannedProgress.value,address:faddress.value.trim(),status:fstatus.value,contractNo:fcontractNo.value.trim(),contractDate:fcontractDate.value||'',startDate:fStartDate.value||'',endDate:fEndDate.value||'',contractValue:parseVnNumber(fcontractValue.value),contractContent:fcontractContent.value.trim(),consultantContractType:fconsultantContractType.value,consultantPriceType:fconsultantPriceType.value||null,contractDurationDays:fExecutionDays.value?+fExecutionDays.value:null,contractorContractNo:fcontractorContractNo.value.trim(),contractorContractDate:fcontractorContractDate.value||'',contractorContractValue:parseVnNumber(fcontractorContractValue.value),contractorContractContent:fcontractorContractContent.value.trim(),contractorContractType:fcontractorContractType.value,contractorPriceType:fcontractorPriceType.value||null,contractorStartDate:fcontractorStartDate.value||'',contractorEndDate:fcontractorEndDate.value||'',contractorDurationDays:fcontractorExecutionDays.value?+fcontractorExecutionDays.value:null};
if(!data.name)return alert('Nhập tên công trình');
if(data.startDate&&data.endDate&&!durationFromDates(data.startDate,data.endDate))return alert('Ngày kết thúc TVGS phải từ ngày bắt đầu trở đi.');
if(data.contractorStartDate&&data.contractorEndDate&&!durationFromDates(data.contractorStartDate,data.contractorEndDate))return alert('Ngày kết thúc hoạt động nhà thầu phải từ ngày bắt đầu trở đi.');
if(p){Object.assign(p,data);p.updatedAt=new Date().toISOString()}else{p={id:id(),...data,createdAt:new Date().toISOString()};db.projects.push(p)}
const entries=[];if(tvgsFile)entries.push({file:tvgsFile,kind:'PROJECT_FILE',category:'TVGS_CONTRACT'});if(contractorFile)entries.push({file:contractorFile,kind:'PROJECT_FILE',category:'CONTRACTOR_CONTRACT'});if(baselineFileInput)entries.push({file:baselineFileInput,kind:'PROGRESS_BASELINE',category:'PROGRESS_BASELINE'});const queued=entries.length?await queueOfflineFiles('project',p.id,entries):[];
if(baselineFileInput){db.pendingInitialProgressPlans[p.id]={plan_name:'Bảng tiến độ cơ sở Nhà thầu',report_date:new Date().toISOString().slice(0,10),planned_percent:Number(data.plannedProgress??0),actual_percent:Number(data.progress||0),original_end_date:data.endDate||null,is_extension:false,is_current:true,attachment_queue_id:queued[queued.length-1]}}
audit(pid?'UPDATE':'CREATE','project',p.id,data.name+(data.contractNo?' / '+data.contractNo:''));queueSync('project',p.id,pid?'UPDATE':'CREATE',data);save();if(apiOnline()&&window.syncPendingProjects){await window.syncPendingProjects();if(showQueuedConflict('project',p.id))return;await syncInitialProgressPlans();}closeModal();if(currentProjectId===p.id)renderProjectDetail();
}
function serverProjects(){return (db.projects||[]).filter(p=>!p._localOnly)}
function projectLabel(p){return (p.code?p.code+' - ':'')+(p.name||'')}
function fillProjectSelect(select,old){
 const list=serverProjects();
 select.innerHTML='<option value="">Chọn công trình</option>'+list.map(p=>'<option value="'+p.id+'">'+esc(projectLabel(p))+'</option>').join('');
 const pid=list.some(p=>p.id===old)?old:(list[0]?.id||'');select.value=pid;return pid;
}
// Vai trò/chức danh của tài khoản đang đăng nhập TẠI CÔNG TRÌNH đang xem (khác vai trò toàn cục) — chỉ để hiển thị,
// không dùng để cấp quyền (quyền thật vẫn theo qualityPermissions(pid)/canApproveIn(pid) như trước).
function updateProjectRoleBadge(pid){
 const el=document.getElementById('pdRole');if(!el)return;
 if(canManageAssignments()){el.textContent='Vai trò của bạn tại công trình này: Quản trị / Giám đốc — toàn quyền';return}
 const rows=db.teamCache?.[pid]?.rows;
 if(!rows){el.textContent='Vai trò của bạn tại công trình này: Đang tải...';return}
 const me=rows.find(r=>r.is_me);
 el.textContent='Vai trò của bạn tại công trình này: '+(me?(me.assignment_title||'Chưa nhập chức danh'):'Chưa được phân công vai trò cụ thể');
}
async function loadProjectDetailMembers(pid){
 const el=document.getElementById('pdPeople');if(!el||!pid)return;
 const cached=db.teamCache?.[pid]?.rows;if(cached)el.innerHTML=teamTableHtml(cached,pid,{compact:true});
 if(currentProjectId===pid)updateProjectRoleBadge(pid);
 const rows=await fetchTeam(pid,{sync:false});
 if(currentProjectId===pid){el.innerHTML=teamErrorNotice(pid)+teamTableHtml(rows,pid,{compact:true});updateProjectRoleBadge(pid)}
}

// ============================================================================
// GÓI THẦU — một công trình có thể có nhiều gói thầu, mỗi gói thầu nhiều nhà thầu,
// mỗi nhà thầu thi công một số hạng mục (tên + đơn vị tính). Tùy chọn, không bắt buộc
// cho công trình đơn giản (vẫn dùng ô "Tên nhà thầu"). Khi đã khai báo, phân công GS viên
// (js/09-nhan-su.js) bắt buộc chọn gói thầu, và lập nhật ký (js/05-nhat-ky.js) chọn
// Hạng mục qua dropdown xếp tầng theo đúng gói thầu được gán, thay vì gõ tự do.
// ============================================================================
let biddingPackagesByProject={};
async function loadBiddingPackages(pid,force=false,{signal}={}){
 if(!pid)return [];
 if(!force&&biddingPackagesByProject[pid])return biddingPackagesByProject[pid];
 if(!apiOnline()||navigator.onLine===false)return biddingPackagesByProject[pid]||db.biddingPackagesCache?.[pid]||[];
 try{
  biddingPackagesByProject[pid]=await apiRequest('/bidding-packages?project_id='+encodeURIComponent(pid),{signal});
  db.biddingPackagesCache=db.biddingPackagesCache||{};db.biddingPackagesCache[pid]=biddingPackagesByProject[pid];persistLocal();
 }
 catch(error){console.warn('Không tải được gói thầu:',error.message)}
 return biddingPackagesByProject[pid]||db.biddingPackagesCache?.[pid]||[];
}
function biddingItemChips(contractorId,items){
 return (items||[]).map((it,i)=>'<span class="chip" style="margin:2px 4px 2px 0">'+esc(it.name)+(it.unit?' ('+esc(it.unit)+')':'')+' <a href="#" onclick="removeBiddingItem(\''+contractorId+'\','+i+');return false" title="Xóa hạng mục">✕</a></span>').join('')||'<span class="muted">Chưa có hạng mục</span>';
}
function biddingPackagesHtml(pid){
 const packages=biddingPackagesByProject[pid]||[];
 if(!packages.length)return '<p class="muted">Công trình chưa có gói thầu nào.</p>';
 return packages.map(pk=>'<div class="card" style="margin-bottom:10px"><div class="toolbar" style="margin:0 0 6px"><b style="flex:1">'+esc(pk.name)+'</b><button type="button" onclick="renameBiddingPackage(\''+pid+'\',\''+pk.id+'\')">Đổi tên</button><button type="button" class="danger" onclick="removeBiddingPackage(\''+pid+'\',\''+pk.id+'\')">Xóa gói thầu</button></div>'
  +(pk.contractors||[]).map(c=>'<div style="margin:6px 0;padding:8px;border:1px solid var(--border,#e4e7ec);border-radius:8px"><div class="toolbar" style="margin:0 0 4px"><b style="flex:1">'+esc(c.name)+'</b><button type="button" onclick="renameBiddingContractor(\''+pid+'\',\''+c.id+'\')">Đổi tên</button><button type="button" onclick="addBiddingItem(\''+pid+'\',\''+c.id+'\')">+ Hạng mục</button><button type="button" class="danger" onclick="removeBiddingContractor(\''+pid+'\',\''+c.id+'\')">Xóa nhà thầu</button></div><div>'+biddingItemChips(c.id,c.items)+'</div></div>').join('')
  +'<div class="toolbar" style="margin-top:6px"><input id="bpNewContractor_'+pk.id+'" placeholder="Tên nhà thầu mới" style="flex:1"><button type="button" onclick="addBiddingContractor(\''+pid+'\',\''+pk.id+'\')">+ Thêm nhà thầu</button></div></div>').join('');
}
function refreshBiddingPackagesModal(pid){const box=document.getElementById('bpList');if(box)box.innerHTML=biddingPackagesHtml(pid)}
async function openBiddingPackages(pid){
 const p=(db.projects||[]).find(x=>x.id===pid)||{};
 openModal('Gói thầu — '+(p.name||''),'<div id="bpList">Đang tải...</div><div class="toolbar" style="margin-top:10px"><input id="bpNewName" placeholder="Tên gói thầu mới" style="flex:1"><button class="primary" onclick="addBiddingPackage(\''+pid+'\')">+ Thêm gói thầu</button></div>');
 wideModal();
 await loadBiddingPackages(pid,true);
 refreshBiddingPackagesModal(pid);
}
async function addBiddingPackage(pid){
 const input=document.getElementById('bpNewName');const name=(input?.value||'').trim();if(!name)return alert('Nhập tên gói thầu.');
 try{await apiRequest('/bidding-packages',{method:'POST',body:JSON.stringify({project_id:pid,name})});if(input)input.value='';await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không thêm được: '+error.message)}
}
async function renameBiddingPackage(pid,packageId){
 const current=(biddingPackagesByProject[pid]||[]).find(p=>p.id===packageId);
 const name=prompt('Tên gói thầu:',current?.name||'');if(name===null)return;
 try{await apiRequest('/bidding-packages/'+encodeURIComponent(packageId),{method:'PATCH',body:JSON.stringify({name})});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không đổi tên được: '+error.message)}
}
async function removeBiddingPackage(pid,packageId){
 if(!confirm('Xóa gói thầu này? Toàn bộ nhà thầu/hạng mục trong gói sẽ mất; nhân sự đã gán gói này sẽ cần gán lại.'))return;
 try{await apiRequest('/bidding-packages/'+encodeURIComponent(packageId),{method:'DELETE'});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không xóa được: '+error.message)}
}
async function addBiddingContractor(pid,packageId){
 const input=document.getElementById('bpNewContractor_'+packageId);const name=(input?.value||'').trim();if(!name)return alert('Nhập tên nhà thầu.');
 try{await apiRequest('/bidding-packages/'+encodeURIComponent(packageId)+'/contractors',{method:'POST',body:JSON.stringify({name})});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không thêm được: '+error.message)}
}
function findBiddingContractor(contractorId){for(const pid in biddingPackagesByProject)for(const pk of biddingPackagesByProject[pid])for(const c of pk.contractors||[])if(c.id===contractorId)return {pid,contractor:c};return {pid:null,contractor:null}}
async function renameBiddingContractor(pid,contractorId){
 const {contractor}=findBiddingContractor(contractorId);
 const name=prompt('Tên nhà thầu:',contractor?.name||'');if(name===null)return;
 try{await apiRequest('/bidding-packages/contractors/'+encodeURIComponent(contractorId),{method:'PATCH',body:JSON.stringify({name})});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không đổi tên được: '+error.message)}
}
async function removeBiddingContractor(pid,contractorId){
 if(!confirm('Xóa nhà thầu này khỏi gói thầu?'))return;
 try{await apiRequest('/bidding-packages/contractors/'+encodeURIComponent(contractorId),{method:'DELETE'});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không xóa được: '+error.message)}
}
async function addBiddingItem(pid,contractorId){
 const name=prompt('Tên hạng mục:');if(!name||!name.trim())return;
 const unit=prompt('Đơn vị tính (ví dụ m3, m2, tấn — có thể để trống):','')||'';
 const {contractor}=findBiddingContractor(contractorId);
 const items=[...(contractor?.items||[]),{name:name.trim(),unit:unit.trim()}];
 try{await apiRequest('/bidding-packages/contractors/'+encodeURIComponent(contractorId),{method:'PATCH',body:JSON.stringify({items})});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không thêm được: '+error.message)}
}
async function removeBiddingItem(contractorId,index){
 const {pid,contractor}=findBiddingContractor(contractorId);if(!contractor)return;
 const items=(contractor.items||[]).filter((_,i)=>i!==index);
 try{await apiRequest('/bidding-packages/contractors/'+encodeURIComponent(contractorId),{method:'PATCH',body:JSON.stringify({items})});await loadBiddingPackages(pid,true);refreshBiddingPackagesModal(pid)}
 catch(error){alert('Không xóa được: '+error.message)}
}
