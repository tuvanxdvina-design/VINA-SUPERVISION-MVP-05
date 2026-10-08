
// ============================================================================
// Tài khoản nhân sự · Quy trình duyệt có ý kiến · Việc cần duyệt (bản 2026-10-01)
// ============================================================================
const REVIEW_ACTION={SUBMIT:'Gửi duyệt',CONFIRM:'Xác nhận (tự duyệt — người lập là Trưởng TVGS)',APPROVE:'Phê duyệt',REJECT:'Yêu cầu chỉnh sửa, bổ sung',ESCALATE:'Trình công ty',LOCK:'Khóa',REOPEN:'Mở khóa'};
// Mục "Việc cần duyệt" chỉ dành cho người có quyền duyệt: Giám đốc/Admin, hoặc người có quyền "Duyệt"
// ở ít nhất một công trình (Trưởng TVGS tại công trình đó). Người khác không thấy mục này.
function isReviewer(){
 if(canManageAssignments())return true;
 if([...qualityPermissionCache.values()].some(v=>(v.permissions||[]).map(x=>String(x).toUpperCase()).includes('APPROVE')))return true;
 return !!inboxData?.can_review;
}
function applyInboxNavVisibility(){
 const show=isReviewer();const nav=document.querySelector('nav button[data-page="inbox"]');if(nav)nav.style.display=show?'':'none';
 if(!show&&document.getElementById('inbox')?.classList.contains('active'))goPage('projects');
}

// ---- Ý kiến duyệt ----
function returnedChip(x){
 const r=x?.lastReview;if(!x||!r)return '';
 if(x.status==='DRAFT'&&r.action==='REJECT')return '<br><span class="chip danger" title="'+esc(r.comment||'')+'">↩ Bị trả lại — cần sửa</span>';
 if(x.status==='SUBMITTED'&&r.action==='ESCALATE')return '<br><span class="chip warn" title="'+esc(r.comment||'')+'">⇪ Đã trình công ty</span>';
 return '';
}
function reviewBlockHtml(x,{history=true}={}){
 const r=x?.lastReview;let h='';
 if(r&&r.action==='REJECT'&&x.status==='DRAFT')h+='<div class="review-note reject"><b>Yêu cầu chỉnh sửa, bổ sung</b> — '+esc(r.by||'')+' · '+esc(fmt(r.at))+'<br>'+esc(r.comment||'')+'</div>';
 else if(r&&r.action==='ESCALATE'&&x.status==='SUBMITTED')h+='<div class="review-note"><b>Trưởng TVGS đã trình công ty</b> — '+esc(r.by||'')+' · '+esc(fmt(r.at))+'<br>'+esc(r.comment||'')+'</div>';
 else if(r&&r.action==='APPROVE'&&r.comment)h+='<div class="review-note approve"><b>Ý kiến khi phê duyệt</b> — '+esc(r.by||'')+' · '+esc(fmt(r.at))+'<br>'+esc(r.comment)+'</div>';
 if(history&&x?.serverId)h+='<details style="margin:6px 0"><summary>Lịch sử duyệt</summary><ol class="review-history" id="reviewHistory"><li class="muted">Đang tải...</li></ol></details>';
 return h;
}
async function loadReviewHistory(kind,id){
 const el=document.getElementById('reviewHistory');if(!el)return;
 let rows;try{rows=await apiRequest('/reviews/'+kind+'/'+encodeURIComponent(id))}catch(error){el.innerHTML='<li class="muted">Không tải được: '+esc(error.message)+'</li>';return}
 if(!rows.length){el.innerHTML='<li class="muted">Chưa gửi duyệt lần nào.</li>';return}
 el.innerHTML=rows.map(n=>'<li><b>'+esc(REVIEW_ACTION[n.action]||n.action)+'</b> — '+esc(n.actor_name||'')+' · '+esc(fmt(n.created_at))+(n.comment?'<div class="pre" style="white-space:pre-wrap;color:#475467">'+esc(n.comment)+'</div>':'')+'</li>').join('');
}
let reviewDecisionContext=null;
let reviewDecisionLoad=0;
function reviewItem(kind,id,loaded){
 const fromInbox=[...(inboxData?.to_review||[]),...(inboxData?.escalated||[]),...(inboxData?.monitor||[])].find(v=>v.kind===kind&&v.id===id);
 const lastOf=local=>fromInbox?.last_action?{action:fromInbox.last_action,comment:fromInbox.last_comment,by:fromInbox.last_by,at:fromInbox.last_at}:(local?.lastReview||null);
 if(kind==='documents'){const d=loaded||(db.docs||[]).find(v=>v.id===id);return {title:d?((d.code||'')+' — '+(d.name||'')):((fromInbox?.code||'')+' — '+(fromInbox?.title||'')),by:d?.createdBy||fromInbox?.created_by_name||'',at:d?.submittedAt||fromInbox?.submitted_at||'',local:d,projectId:d?.projectId||fromInbox?.project_id,last:loaded?d.lastReview:lastOf(d),extra:''}}
 const l=loaded||(db.logs||[]).find(v=>v.serverId===id);const p=(db.projects||[]).find(v=>v.id===(l?.projectId||fromInbox?.project_id))||{};
 const date=l?.date||fromInbox?.log_date||'',shift=l?.shift||fromInbox?.shift||'';
 return {title:'Báo cáo ngày '+progressDate(date)+' — '+shiftLabel(shift)+(p.name?' · '+p.name:''),by:l?.createdBy||fromInbox?.created_by_name||'',at:l?.submittedAt||fromInbox?.submitted_at||'',local:l,projectId:l?.projectId||fromInbox?.project_id,last:loaded?l.lastReview:lastOf(l),
  extra:l?'<p>'+(l.contractorUnit?'<b>Đơn vị tc:</b> '+esc(l.contractorUnit)+' · ':'')+(l.itemCategory?'<b>Hạng mục:</b> '+esc(l.itemCategory):'')+'</p><p><b>Công việc:</b> '+esc(l.work||'')+'</p><p class="muted">Thời tiết: '+esc(l.weather||'—')+' · Cbkt: '+Number(l.technicalStaffCount||0)+' · Nhân lực: '+resourceSummary(l.workerItems,l.workers)+' · Máy: '+resourceSummary(l.machineItems,l.machines)+(l.note?' · Ghi chú: '+esc(l.note):'')+'</p>'+(l.recommendation?'<p><b>Kiến nghị:</b> '+esc(l.recommendation)+'</p>':'')+((l.fileCount||l.photoCount)?'<button type="button" onclick="showReviewLogFiles()">Xem tệp/ảnh ('+((l.fileCount||0)+(l.photoCount||0))+')</button>':''):'<p class="muted">'+esc(fromInbox?.title||'')+'</p>'};
}
async function openReviewDecision(kind,id,preset){
 if(!apiOnline())return alert('Cần kết nối mạng để duyệt.');
 if(!['documents','daily_logs'].includes(kind))return;
 const load=++reviewDecisionLoad,token=getAuthToken();reviewDecisionContext=null;
 openModal('Đang tải nội dung cần duyệt','<p id="rvLoading" class="muted">Đang tải bản hiện tại từ máy chủ...</p>');
 const loading=document.getElementById('rvLoading');
 let record;
 try{record=await apiRequest('/'+(kind==='documents'?'documents':'daily-logs')+'/'+encodeURIComponent(id))}
 catch(error){if(load===reviewDecisionLoad&&loading?.isConnected&&document.getElementById('modal')?.classList.contains('show'))loading.textContent='Không tải được nội dung; chưa thể duyệt. '+error.message;return}
 if(load!==reviewDecisionLoad||token!==getAuthToken()||!loading?.isConnected||!document.getElementById('modal')?.classList.contains('show'))return;
 if(record.id!==id||record.status!=='SUBMITTED'){loading.textContent='Bản này không còn chờ duyệt. Hãy tải lại danh sách.';void loadInbox();return}
 const loaded=kind==='documents'?mapDocumentFromApi(record):{...mapDailyLogFromApi(record),serverId:record.id};
 const it=reviewItem(kind,id,loaded);const k=JSON.stringify(kind).replace(/"/g,'&quot;'),i=JSON.stringify(id).replace(/"/g,'&quot;');
 const viewBtn=kind==='documents'?'<button type="button" onclick="viewReviewDocument()">Xem toàn văn</button>':'';
 const company=canManageAssignments();const escalated=it.last?.action==='ESCALATE';
 if(escalated&&!company){loading.textContent='Bản này đã trình công ty — chờ Giám đốc/Admin quyết định.';return}
 reviewDecisionContext={kind,id,record:loaded};
 const escNote=escalated?'<div class="review-note"><b>Trưởng TVGS trình công ty</b> — '+esc(it.last.by||'')+' · '+esc(fmt(it.last.at))+'<br>'+esc(it.last.comment||'')+'</div>':'';
 openModal(company?'Quyết định của công ty':'Xem xét và phê duyệt',escNote+'<div class="card"><p><b>'+esc(it.title)+'</b></p><p class="muted">Người lập: '+esc(it.by||'—')+(it.at?' · Gửi duyệt lúc '+esc(fmt(it.at)):'')+'</p>'+it.extra+viewBtn+'</div>'
  +'<label for="rvComment">'+(company?'Ý kiến của Giám đốc/công ty':'Ý kiến của Trưởng TVGS')+'</label><textarea id="rvComment" rows="5" maxlength="4000" placeholder="Phê duyệt: ý kiến không bắt buộc.\nYêu cầu chỉnh sửa, bổ sung: BẮT BUỘC ghi rõ mục cần sửa, số liệu sai, tài liệu cần bổ sung...'+(company?'':'\nTrình công ty (việc vượt thẩm quyền): BẮT BUỘC ghi nội dung cần công ty quyết định.')+'"></textarea>'
  +'<div class="toolbar"><button class="primary" onclick="submitReviewDecision('+k+','+i+',\'approve\')">✔ Phê duyệt</button><button class="danger" onclick="submitReviewDecision('+k+','+i+',\'reject\')">↩ Yêu cầu chỉnh sửa, bổ sung</button>'
  +(company?'':'<button onclick="submitReviewDecision('+k+','+i+',\'escalate\')" title="Việc vượt thẩm quyền của Trưởng TVGS">⇪ Trình công ty</button>')+'</div><div id="rvMsg" class="muted"></div>');
 if(preset==='reject')setTimeout(()=>document.getElementById('rvComment')?.focus(),50);
}
function showReviewLogFiles(){const ctx=reviewDecisionContext;if(ctx?.kind==='daily_logs')return showLogFiles(ctx.id,ctx.record)}
function showReviewPhotos(){const ctx=reviewDecisionContext;if(ctx?.kind==='daily_logs')return showLogPhotos(ctx.id,ctx.record)}
function viewReviewDocument(){const ctx=reviewDecisionContext;if(ctx?.kind==='documents')return viewDoc(ctx.id,ctx.record)}
async function submitReviewDecision(kind,id,action){
 if(!document.getElementById('rvComment')||reviewDecisionContext?.kind!==kind||reviewDecisionContext.id!==id)return;
 const comment=(document.getElementById('rvComment')?.value||'').trim();const msg=document.getElementById('rvMsg');const say=t=>{if(msg)msg.textContent=t};
 if(action==='reject'&&comment.length<3){say('Nhập nội dung yêu cầu chỉnh sửa, bổ sung để người lập biết cần sửa gì.');document.getElementById('rvComment')?.focus();return}
 if(action==='escalate'&&comment.length<3){say('Nhập nội dung cần công ty quyết định (vì sao vượt thẩm quyền).');document.getElementById('rvComment')?.focus();return}
 document.querySelectorAll('#mbody .toolbar button').forEach(b=>b.disabled=true);say('Đang gửi...');
 try{
  const r=await apiRequest('/'+(kind==='documents'?'documents':'daily-logs')+'/'+encodeURIComponent(id)+'/'+action,{method:'POST',body:JSON.stringify({comment})});
  const review={action:action.toUpperCase(),comment,by:meName(),at:new Date().toISOString()};
  if(kind==='documents')upsertLocalDoc(mapDocumentFromApi(r));
  else{const l=(db.logs||[]).find(v=>v.serverId===id);if(l){l.status=r.status;l.version=Number(r.version||l.version||1);l.canEdit=false;l.lastReview=review}}
  audit(action.toUpperCase(),kind,id,comment);save();
  closeModal();renderLogs();renderDocs();if(typeof renderReports==='function')renderReports();
  await loadInbox();
 }catch(error){say('Không thực hiện được: '+error.message);document.querySelectorAll('#mbody .toolbar button').forEach(b=>b.disabled=false)}
}

// ---- Việc cần duyệt ----
let inboxData=null;
function inboxKindLabel(it){if(it.kind==='daily_logs')return 'Báo cáo ngày';return it.doc_group==='REPORT'?((typeof REPORT_TYPES!=='undefined'&&REPORT_TYPES[it.report_type])||'Báo cáo'):'Hồ sơ'}
function inboxContent(it){return it.kind==='daily_logs'?progressDate(it.log_date)+' — '+shiftLabel(it.shift)+(it.title?'<br><span class="muted">'+esc(it.title)+'</span>':''):esc(it.code||'')+' — '+esc(it.title||'')}
async function loadInbox(){
 if(!getAuthToken()||window.__forcePw)return;
 try{inboxData=await apiRequest('/reviews/inbox')}
 catch(error){const el=document.getElementById('inboxBody');if(el)el.innerHTML='<p class="muted">Không tải được: '+esc(error.message)+'</p>';return}
 applyInboxNavVisibility();updateInboxBadge();renderInbox();
}
function updateInboxBadge(){
 const c=inboxData?.counts||{};const reviewer=isReviewer();
 const b=document.getElementById('inboxBadge');if(b)b.textContent=reviewer&&(c.to_review||0)+(c.returned||0)?String((c.to_review||0)+(c.returned||0)):'';
 const main=document.querySelector('main');let ban=document.getElementById('inboxBanner');
 const parts=[];
 if(reviewer&&c.to_review)parts.push('<b>'+c.to_review+'</b> '+(inboxData?.is_company?'việc trình công ty / công trình chưa có Trưởng TVGS':'báo cáo/hồ sơ/báo cáo ngày đang chờ bạn phê duyệt'));
 if(c.returned)parts.push('<b>'+c.returned+'</b> bản của bạn bị yêu cầu chỉnh sửa, bổ sung');
 if(!parts.length||document.getElementById('inbox')?.classList.contains('active')){if(ban)ban.remove();return}
 // Người không có quyền duyệt không có mục "Việc cần duyệt" → mở danh sách bản bị trả lại trong cửa sổ
 const html='✉ Có '+parts.join(' · ')+'. <button onclick="'+(reviewer?'openInboxPage()':'openReturnedModal()')+'">Xem ngay</button>';
 if(ban)ban.innerHTML=html;else if(main)main.insertAdjacentHTML('afterbegin','<div id="inboxBanner" class="notice" style="margin-bottom:12px;background:#fffaeb;border-color:#fedf89">'+html+'</div>');
}
function openInboxPage(){if(!isReviewer())return openReturnedModal();currentProjectId=null;goPage('inbox');document.getElementById('inboxBanner')?.remove();renderInbox();void loadInbox()}
function inboxTable(list,{action=true,note=false}={}){
 const k=v=>JSON.stringify(v).replace(/"/g,'&quot;');
 return '<table><thead><tr><th>Loại</th><th>Nội dung</th><th>Công trình</th><th>Người lập</th><th>Gửi lúc</th>'+(note?'<th>Trưởng TVGS trình</th>':'')+'<th></th></tr></thead><tbody>'+list.map(it=>'<tr><td>'+esc(inboxKindLabel(it))+(it.reason==='NO_APPROVER'?'<br><span class="chip warn">Công trình chưa có Trưởng TVGS</span>':'')+'</td><td>'+inboxContent(it)+'</td><td>'+esc(it.project_name||'')+'</td><td>'+esc(it.created_by_name||'')+'</td><td>'+esc(fmt(it.submitted_at))+'</td>'+(note?'<td>'+(it.last_action==='ESCALATE'?'<div class="review-note" style="margin:0">'+esc(it.last_comment||'')+'<br><span class="muted">'+esc(it.last_by||'')+' · '+esc(fmt(it.last_at))+'</span></div>':'')+'</td>':'')+'<td>'+(action?'<button class="primary" onclick="openReviewDecision('+k(it.kind)+','+k(it.id)+')">Xem xét</button>':'')+'</td></tr>').join('')+'</tbody></table>';
}
function renderInbox(){
 const el=document.getElementById('inboxBody');if(!el)return;if(!inboxData){el.innerHTML='<p class="muted">'+(apiOnline()?'Đang tải...':'Cần kết nối mạng.')+'</p>';return}
 let h='';
 if(inboxData.is_company){
  const list=inboxData.to_review||[],mon=inboxData.monitor||[];
  h+='<div class="card"><h3>Trình công ty / cần công ty quyết định ('+list.length+')</h3><p class="muted">Việc Trưởng TVGS trình vì vượt thẩm quyền, và bản chờ duyệt ở công trình chưa có ai được quyền Duyệt.</p>'+(list.length?inboxTable(list,{note:true}):'<p class="muted">Không có việc cần công ty quyết định.</p>')+'</div>';
  h+='<details class="card" style="margin-top:14px"><summary><b>Theo dõi: đang chờ Trưởng TVGS các công trình duyệt ('+mon.length+')</b></summary><p class="muted">Trưởng TVGS quyết định tại công trình; công ty chỉ theo dõi. Có thể quyết định thay nếu cần.</p>'+(mon.length?inboxTable(mon):'<p class="muted">Không có.</p>')+'</details>';
 }else{
  const list=inboxData.to_review||[],esc2=inboxData.escalated||[];
  h+='<div class="card"><h3>Chờ tôi phê duyệt ('+list.length+')</h3>'+(list.length?inboxTable(list):'<p class="muted">Không có bản nào đang chờ duyệt.</p>')+'</div>';
  if(esc2.length)h+='<div class="card" style="margin-top:14px"><h3>Đã trình công ty — chờ Giám đốc quyết định ('+esc2.length+')</h3>'+inboxTable(esc2,{action:false,note:true})+'</div>';
 }
 const ret=inboxData.returned||[];
 if(ret.length)h+='<div class="card" style="margin-top:14px"><h3>Của tôi — bị yêu cầu chỉnh sửa, bổ sung ('+ret.length+')</h3>'+returnedHtml()+'</div>';
 const ok=inboxData.approved||[];
 if(ok.length)h+='<div class="card" style="margin-top:14px"><h3>Của tôi — đã được phê duyệt (7 ngày gần đây)</h3><ul>'+ok.map(it=>'<li><span class="chip ok">Đã duyệt</span> '+esc(inboxKindLabel(it))+': '+inboxContent(it)+' <span class="muted">— '+esc(it.reviewer_name||'')+' · '+esc(fmt(it.reviewed_at))+(it.comment?' · “'+esc(it.comment)+'”':'')+'</span></li>').join('')+'</ul></div>';
 el.innerHTML=h;
}
