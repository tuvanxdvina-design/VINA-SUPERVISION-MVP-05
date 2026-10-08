// ============================================================================
// HỒ SƠ PHÁP LÝ / BÁO CÁO — lưu trên máy chủ (dùng chung mọi tài khoản được phân công)
// Tệp tải thẳng lên máy chủ (không lưu base64 trong trình duyệt → không vượt dung lượng localStorage).
// ============================================================================
const DOC_TYPES=[['HS','Hồ sơ pháp lý'],['BB','Biên bản'],['NK','Nhật ký'],['TK','Thiết kế kỹ thuật'],['TKT','Tiêu chuẩn kỹ thuật'],['BC','Báo cáo'],['KHAC','Khác']];
const DOC_STATUS={DRAFT:'Bản nháp',SUBMITTED:'Chờ duyệt',APPROVED:'Đã duyệt',LOCKED:'Đã khóa'};
const MAX_DOC_FILE=15*1024*1024;
function renderDocs(){
 const pid=document.getElementById('docProject')?.value||'';const group=document.getElementById('docGroup')?.value||'';
 const a=(db.docs||[]).filter(x=>!x.pendingUpload&&(!pid||x.projectId===pid)&&(!group||docGroup(x)===group));
 const addBtn=document.querySelector('#docs .toolbar .primary');if(addBtn)addBtn.style.display=(db.projects||[]).some(p=>canCreateDocIn(p.id))?'':'none';
 const rows=a.map(x=>{const p=db.projects.find(v=>v.id===x.projectId)||{};return '<tr><td>'+esc(x.code||'')+(x.pendingUpload?' <span class="chip warn">Chưa lên máy chủ</span>':'')+'</td><td>'+esc(p.name||'')+'</td><td>'+(docGroup(x)==='REPORT'?'Báo cáo':'Hồ sơ pháp lý')+'</td><td><b>'+esc(x.name||'')+'</b><br><span class="muted">'+esc(docTypeLabel(x.type))+'</span></td><td>'+docStatusBadge(x.status)+returnedChip(x)+'</td><td>'+esc(x.createdBy||'')+(x.updatedBy&&x.updatedBy!==x.createdBy?'<br><span class="muted">Sửa: '+esc(x.updatedBy)+'</span>':'')+'<br><span class="muted">'+esc(fmt(x.updatedAt||x.createdAt))+'</span></td><td>'+docFileLinks(x)+'</td><td><button onclick="viewDoc(\''+x.id+'\')">Xem</button>'+(canModifyDoc(x)?' <button onclick="openDoc(\''+x.id+'\')">Sửa</button>':'')+deleteBtn('doc',x.serverId,x.projectId,(x.code||'')+' '+(x.name||''))+'</td></tr>'}).join('');
 const el=document.getElementById('docsTable');if(!el)return;
 const stuck=(db.docs||[]).filter(x=>x.pendingUpload&&(!pid||x.projectId===pid));
 const stuckHtml=stuck.length?'<div class="notice" style="margin-bottom:12px;background:#fef3f2;border-color:#fecdca"><b>'+stuck.length+' hồ sơ còn nằm trên thiết bị này, chưa lên máy chủ</b> (tài khoản khác chưa thấy):<table style="margin-top:6px"><tbody>'+stuck.map(x=>'<tr><td><b>'+esc(x.code||'')+'</b> '+esc(x.name||'')+'<br><span style="color:#b42318">Lý do: '+esc(x.lastError||'chưa thử đồng bộ')+'</span></td><td style="white-space:nowrap"><button onclick="retryLegacyDocs()">Thử lại</button> <button onclick="downloadLegacyDoc(\''+x.id+'\')">Tải tệp về</button> <button class="danger" onclick="discardLegacyDoc(\''+x.id+'\')">Bỏ bản này</button></td></tr>').join('')+'</tbody></table></div>':'';
 el.innerHTML=stuckHtml+(rows?'<table><thead><tr><th>Mã</th><th>Công trình</th><th>Nhóm</th><th>Tên hồ sơ</th><th>Trạng thái</th><th>Người lập</th><th>Tài liệu</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="muted">Chưa có hồ sơ.'+(apiOnline()?'':' (Đang ngoại tuyến — danh sách lấy từ lần tải gần nhất)')+'</p>');
}
function viewDoc(docId,loadedDoc){
 const x=loadedDoc||db.docs.find(v=>v.id===docId);if(!x)return;if(x.details?.snapshot&&typeof viewReport==='function')return viewReport(docId,loadedDoc);const p=db.projects.find(v=>v.id===x.projectId)||{};const d=x.details||{};const role=roleToken(qualityAuthUser()?.role_name||'');
 const lead=['ADMIN','DIRECTOR','TVGS_LEAD'].includes(role);
 const flow=[x.status==='DRAFT'&&canModifyDoc(x)?['submit','Gửi duyệt']:null,x.status==='SUBMITTED'&&docCanDecide(x)?['approve','Duyệt']:null,x.status==='SUBMITTED'&&docCanDecide(x)?['reject','Trả lại']:null,x.status==='APPROVED'&&docCanDecide(x)?['lock','Khóa hồ sơ']:null,x.status==='LOCKED'&&docCanDecide(x)?['reopen','Mở khóa (tăng phiên bản)']:null].filter(Boolean);
 const pc=Array.isArray(d.personnelChanges)?d.personnelChanges:[];
 setTimeout(()=>loadReviewHistory('documents',x.id),0);
 openModal('Xem '+(docGroup(x)==='REPORT'?'báo cáo':'hồ sơ pháp lý'),reviewBlockHtml(x)+'<div class="card"><p><b>Công trình:</b> '+esc((p.code||'')+' - '+(p.name||''))+'</p><p><b>Mã:</b> '+esc(x.code||'')+' &nbsp; <b>Loại:</b> '+esc(docTypeLabel(x.type))+'</p><p><b>Tên:</b> '+esc(x.name||'')+'</p><p><b>Phiên bản:</b> '+Number(x.version||1)+' &nbsp; <b>Trạng thái:</b> '+docStatusBadge(x.status)+'</p><p><b>Người lập:</b> '+esc(x.createdBy||'')+(x.updatedBy?' &nbsp; <b>Cập nhật cuối:</b> '+esc(x.updatedBy)+' — '+esc(fmt(x.updatedAt)):'')+'</p>'
  +(docGroup(x)==='REPORT'?'<div class="notice"><b>Báo cáo '+esc({DAILY:'ngày',WEEKLY:'tuần',MONTHLY:'tháng',FINAL:'hoàn thành'}[d.reportType]||'')+'</b> · Kỳ: '+esc(d.period||'')+' · Kế hoạch: '+(d.plannedProgress??0)+'% · Thực tế: '+(d.actualProgress??0)+'%<br>Nhân lực: '+(d.manpower??0)+' · Khối lượng: '+esc(d.volumeCompleted||'')+'</div>':'')
  +(pc.length?'<p><b>Biến động nhân sự tổ TVGS:</b></p><ol>'+pc.map(v=>'<li>'+esc(v.date||'')+' — rút: '+esc(v.removed||'')+' → thay: '+esc(v.added||'')+(v.decision?' ('+esc(v.decision)+')':'')+'</li>').join('')+'</ol>':'')
  +'<hr><h4>Tài liệu tải lên</h4>'+docFileLinks(x)+'</div><div class="toolbar">'+(canModifyDoc(x)?'<button class="primary" onclick="closeModal();openDoc(\''+x.id+'\')">Sửa hồ sơ</button>':'')+flow.map(([a,t])=>'<button onclick="docWorkflow(\''+x.id+'\',\''+a+'\')">'+t+'</button>').join('')+deleteBtn('doc',x.serverId,x.projectId,(x.code||'')+' '+(x.name||''))+'</div>');
 if(loadedDoc)document.querySelector('#mbody .toolbar')?.remove();
}
function upsertLocalDoc(doc){db.docs=db.docs||[];const i=db.docs.findIndex(x=>x.id===doc.id);if(i>=0)db.docs[i]=doc;else db.docs.unshift(doc)}
function openDoc(docId='',forceProjectId=''){
 if(!apiOnline())return alert('Cần kết nối mạng để tạo/sửa hồ sơ (tệp được lưu trên máy chủ để mọi tài khoản cùng xem).');
 const x=db.docs.find(v=>v.id===docId)||{};const edit=!!docId;captureEditVersion('document',docId,x);
 if(edit&&!canModifyDoc(x))return alert('Bạn không có quyền sửa hồ sơ này.');
 const projects=edit?(db.projects||[]).filter(p=>p.id===x.projectId):serverProjects().filter(p=>canCreateDocIn(p.id));
 if(!projects.length)return alert('Tài khoản chưa được cấp quyền "Thêm" hồ sơ ở công trình nào.');
 const d=x.details||{};const cur=forceProjectId||document.getElementById('docProject')?.value;
 const slotHtml=(slots,cls)=>slots.map(([label,id,accept,multi])=>'<div class="full '+cls+'"><label>'+esc(label)+'</label><input id="'+id+'" data-category="'+esc(label)+'" type="file" accept="'+accept+'"'+(multi?' multiple':'')+'></div>').join('');
 openModal(edit?'Sửa hồ sơ '+(x.code||''):'Tạo hồ sơ',(edit?reviewBlockHtml(x,{history:false}):'')+'<div class="row">'
  +'<div><label>Công trình</label><select id="dproj">'+projects.map(p=>'<option value="'+p.id+'"'+((x.projectId||cur)===p.id?' selected':'')+'>'+esc(p.code)+' - '+esc(p.name)+'</option>').join('')+'</select></div>'
  +'<div><label>Nhóm hồ sơ</label><select id="dgroup" onchange="toggleReportFields()"><option value="LEGAL">Hồ sơ pháp lý</option>'+(docGroup(x)==='REPORT'?'<option value="REPORT">Báo cáo (kiểu cũ)</option>':'')+'</select><div class="muted">Báo cáo ngày/tuần/tháng lập ở mục <b>Báo cáo</b>.</div></div>'
  +'<div><label>Loại hồ sơ</label><select id="dtype">'+DOC_TYPES.map(([c,t])=>'<option value="'+c+'">'+t+'</option>').join('')+'</select></div>'
  +'<div><label>Mã hồ sơ</label><input value="'+esc(x.code||'Máy chủ tự cấp khi lưu')+'" disabled></div>'
  +'<div class="full"><label>Tên hồ sơ</label><input id="dname" maxlength="255" value="'+esc(x.name||'')+'" placeholder="Ví dụ: Hồ sơ pháp lý công trình"></div>'
  +'<div class="full report-only"><h4>Thông tin báo cáo</h4><div class="row"><div><label>Loại báo cáo</label><select id="dreportType"><option value="DAILY">Ngày</option><option value="WEEKLY">Tuần</option><option value="MONTHLY">Tháng</option><option value="FINAL">Hoàn thành</option></select></div><div><label>Kỳ báo cáo</label><input id="dperiod" type="month" value="'+esc(d.period||'')+'"></div><div><label>Tiến độ kế hoạch (%)</label><input id="dplanned" type="number" min="0" max="100" value="'+(d.plannedProgress??'')+'"></div><div><label>Tiến độ thực tế (%)</label><input id="dactual" type="number" min="0" max="100" value="'+(d.actualProgress??'')+'"></div><div><label>Nhân lực</label><input id="dmanpower" type="number" min="0" value="'+(d.manpower??'')+'"></div><div><label>Khối lượng hoàn thành</label><input id="dvolume" value="'+esc(d.volumeCompleted||'')+'"></div><div><label>Đánh giá tiến độ</label><select id="dschedule"><option value="ON_TRACK">Đúng tiến độ</option><option value="AHEAD">Nhanh hơn</option><option value="DELAYED">Chậm tiến độ</option></select></div></div><button type="button" onclick="fillReportFromLogs()">Tổng hợp từ báo cáo ngày</button></div>'
  +'<div class="full legal-only"><label>Biến động nhân sự trong Quyết định tổ TVGS</label><div id="personnelChangesList">'+personnelChangeRows(d.personnelChanges)+'</div><button type="button" onclick="addPersonnelChangeRow()">+ Thêm lần thay đổi</button></div>'
  +slotHtml(LEGAL_FILE_SLOTS.slice(0,5),'legal-only')+slotHtml(REPORT_FILE_SLOTS.slice(0,1),'report-only')+slotHtml([LEGAL_FILE_SLOTS[5]],'')
  +'<div class="full muted">Mỗi tệp tối đa 15 MB. Tệp được lưu trên máy chủ; mọi tài khoản được phân công công trình đều xem được.</div>'
  +(edit?'<div class="full"><label>Tệp đã lưu</label><div id="docExistingFiles">'+docFileLinks(x,{withDelete:true})+'</div></div>':'')
  +'<div class="full"><button class="primary" id="docSaveBtn" onclick="saveDoc(\''+docId+'\')">'+(edit?'Lưu thay đổi':'Tạo và tải tệp lên')+'</button><div id="docMessage" class="muted" style="margin-top:6px;white-space:pre-line"></div></div></div>');
 document.getElementById('dgroup').value=docGroup(x);document.getElementById('dtype').value=x.type||'HS';
 if(d.reportType)document.getElementById('dreportType').value=d.reportType;if(d.scheduleStatus)document.getElementById('dschedule').value=d.scheduleStatus;
 toggleReportFields();
}
async function saveDoc(docId=''){
 const msg=document.getElementById('docMessage');const btn=document.getElementById('docSaveBtn');const say=t=>{if(msg)msg.textContent=t};
 if(btn?.disabled)return;
 const group=document.getElementById('dgroup').value;const report=group==='REPORT';
 const name=document.getElementById('dname').value.trim();if(!name)return say('Nhập tên hồ sơ.');
 const personnelRows=[...document.querySelectorAll('#personnelChangesList .personnel-change-row')];
 const decisionFiles=[];
 const personnelChanges=personnelRows.map((r,index)=>{const date=r.querySelector('.pc-date')?.value||'';const decision=r.querySelector('.pc-decision')?.value.trim()||'';const category='Quyết định thay thế nhân sự '+(decision||date||String(index+1));const file=r.querySelector('.pc-file')?.files?.[0];if(file)decisionFiles.push({file,category});return {date,removed:r.querySelector('.pc-removed')?.value.trim()||'',added:r.querySelector('.pc-added')?.value.trim()||'',decision,fileCategory:decision||date?category:''}}).filter(v=>v.date||v.removed||v.added||v.decision);
 const details=report?{reportType:document.getElementById('dreportType').value,period:document.getElementById('dperiod').value,plannedProgress:Number(document.getElementById('dplanned').value||0),actualProgress:Number(document.getElementById('dactual').value||0),manpower:Number(document.getElementById('dmanpower').value||0),volumeCompleted:document.getElementById('dvolume').value.trim(),scheduleStatus:document.getElementById('dschedule').value}
  :{personnelChanges};
 const slots=[...document.querySelectorAll('#mbody input[type=file][data-category]')].filter(i=>i.closest('.full')?.style.display!=='none');
 const files=[...decisionFiles];slots.forEach(i=>[...(i.files||[])].forEach(f=>files.push({file:f,category:i.dataset.category})));
 const big=files.find(f=>f.file.size>MAX_DOC_FILE);if(big)return say('Tệp "'+big.file.name+'" vượt 15 MB.');
 if(btn)btn.disabled=true;
 const body={project_id:document.getElementById('dproj').value,doc_group:group,type:document.getElementById('dtype').value,name,details,expected_row_version:editVersion('document',docId)};
 try{
  say('Đang lưu thông tin hồ sơ...');
  let pending=btn?.documentSaveItem||(db.sync||[]).find(x=>x.type==='document'&&x.recordId===docId&&['PENDING','CONFLICT'].includes(x.status));
  if(pending?.sending){say('Hồ sơ đang đồng bộ. Nội dung đang nhập vẫn được giữ.');return}
  if(!pending){
   const created=docId?null:await apiRequest('/documents',{method:'POST',body:JSON.stringify(body)});
   pending={id:id(),type:'document',recordId:docId||created.id,operation:'UPDATE',payload:body,queuedAt:new Date().toISOString(),status:'PENDING'};
   if(created){pending.savedResult=created;upsertLocalDoc(mapDocumentFromApi(created));}
  }else{
   const metadata=value=>JSON.stringify({...value,expected_row_version:null});
   if(pending.savedResult&&metadata(pending.payload)!==metadata(body)){
    body.expected_row_version=pending.savedResult.row_version;
    delete pending.savedResult;
   }else body.expected_row_version=pending.payload.expected_row_version;
   pending.payload=body;
  }
  // Keep the acknowledged metadata and remaining files across retry/reload.
  if(btn)btn.documentSaveItem=pending;
  pending.status='PENDING';
  if(!db.sync.includes(pending))db.sync.push(pending);
  const local=db.docs.find(x=>x.id===pending.recordId);if(local){local.name=name;local.details=details;}
  save();
  if(files.length){
   await queueOfflineFiles('document',pending.recordId,files.map(x=>({file:x.file,category:x.category,kind:'DOCUMENT'})));
   document.querySelectorAll('#mbody input[type=file]').forEach(input=>{input.value=''});
  }
  await syncPendingDocuments();
  if(pending.savedResult)captureEditVersion('document',pending.recordId,{rowVersion:pending.savedResult.row_version});
  if(pending.status!=='SYNCED'){
   say('Không lưu được: '+(pending.lastError||'Hồ sơ đang chờ đồng bộ.')+' Nội dung đang nhập và tệp chờ vẫn được giữ.');return;
  }
  const doc=pending.savedResult;
  audit(docId?'UPDATE':'CREATE','docs',doc.id,(doc.auto_code||'')+' — '+name);save();renderDocs();
  closeModal();if(currentProjectId)renderProjectDetail();
 }catch(error){
  say('Không lưu được: '+error.message+' Nội dung đang nhập vẫn được giữ.');
 }finally{if(btn)btn.disabled=false}
}
async function syncLegacyLocalDocs(){
 const queue=(db.sync||[]).filter(x=>x.type==='docs'&&x.status==='PENDING');
 const legacy=(db.docs||[]).filter(x=>(!x.serverId||x.legacyServerId)&&(queue.some(q=>q.recordId===x.id)||x.pendingUpload));
 if(!legacy.length)return;
 if(!canManageAssignments()&&!qualityPermissionCache.size)await loadQualityPermissions(true); // chờ có quyền rồi mới quyết định
 for(const x of legacy){
  x.pendingUpload=true;
  if(!serverProjects().some(p=>p.id===x.projectId)){x.lastError='Công trình của hồ sơ không có trên máy chủ hoặc tài khoản không được phân công công trình này';continue}
  if(!canCreateDocIn(x.projectId)){x.lastError='Tài khoản chưa có quyền "Thêm" hồ sơ tại công trình này';continue}
  try{
   // Bước 1: tạo hồ sơ trên máy chủ đúng 1 lần (ghi lại id để lần thử sau không tạo trùng)
   if(!x.legacyServerId){
    const created=await apiRequest('/documents',{method:'POST',body:JSON.stringify({project_id:x.projectId,doc_group:x.group==='REPORT'?'REPORT':'LEGAL',type:LEGACY_TYPE[x.type]||(x.group==='REPORT'?'BC':'HS'),name:x.name||'Hồ sơ',details:{personnelChanges:x.personnelChanges||[],reportType:x.reportType,period:x.period,plannedProgress:x.plannedProgress,actualProgress:x.actualProgress,manpower:x.manpower,volumeCompleted:x.volumeCompleted,scheduleStatus:x.scheduleStatus,legacyLocalCode:x.code}})});
    x.legacyServerId=created.id;persistLocal();
   }
   // Bước 2: tải từng tệp; tệp đã tải được đánh dấu để không tải lại
   const missing=[];
   for(const a of x.attachments||[]){
    if(a.uploaded)continue;
    if(!a?.data){missing.push(a?.name||'tệp');continue}
    const blob=await (await fetch(a.data)).blob();
    if(blob.size>MAX_DOC_FILE)throw new Error('Tệp "'+a.name+'" vượt 15 MB — hãy tải tệp về rồi nén/tách trước khi tải lại');
    await uploadDocFile(x.legacyServerId,new File([blob],a.name||'tai-lieu',{type:a.type||blob.type}),a.category||'Tài liệu');
    a.uploaded=true;delete a.data;persistLocal();
   }
   db.docs=db.docs.filter(v=>v.id!==x.id);db.sync=db.sync.filter(q=>!(q.type==='docs'&&q.recordId===x.id));
   audit('SYNC','docs',x.legacyServerId,'Đưa hồ sơ '+(x.code||'')+' lên máy chủ'+(missing.length?' (thiếu tệp đã mất trên thiết bị: '+missing.join(', ')+')':''));
   if(missing.length)alert('Hồ sơ '+(x.code||x.name)+' đã lên máy chủ nhưng '+missing.length+' tệp không còn trên thiết bị (bộ nhớ trình duyệt đã đầy trước đây): '+missing.join(', ')+'. Hãy mở hồ sơ trên máy chủ và tải lại các tệp này.');
  }catch(error){x.lastError=(/failed to fetch|networkerror|load failed/i.test(error.message)?'Mất kết nối tới máy chủ khi đang tải tệp (sẽ tự thử lại)':error.message)+(error.status===403?' — nếu tài khoản là Admin/Giám đốc thì máy chủ đang chạy mã cũ, cần khởi động lại backend':'');console.warn('Chưa đưa được hồ sơ lên máy chủ:',x.code,error.message)}
 }
 persistLocal();
}
async function retryLegacyDocs(){await loadQualityPermissions(true);await syncDocumentsFromApi();renderDocs()}
function downloadLegacyDoc(docId){const x=(db.docs||[]).find(v=>v.id===docId);(x?.attachments||[]).filter(a=>a.data).forEach(a=>{const l=document.createElement('a');l.href=a.data;l.download=a.name||'tai-lieu';document.body.appendChild(l);l.click();l.remove()});if(!(x?.attachments||[]).some(a=>a.data))alert('Hồ sơ này không còn tệp trên thiết bị.')}
function discardLegacyDoc(docId){const x=(db.docs||[]).find(v=>v.id===docId);if(!x)return;if(!confirm('Bỏ bản "'+(x.code||x.name)+'" chỉ nằm trên thiết bị này? Tệp chưa lên máy chủ sẽ mất. Nên bấm "Tải tệp về" trước.'))return;db.docs=db.docs.filter(v=>v.id!==docId);db.sync=db.sync.filter(q=>!(q.type==='docs'&&q.recordId===docId));audit('DISCARD','docs',docId,x.code||x.name);save()}
