let reportDraft=null;
function reportPeriodLabel(type,from,to){
 if(type==='DAILY')return 'ngày '+progressDate(from);
 if(type==='WEEKLY')return 'tuần '+progressDate(from)+' – '+progressDate(to);
 if(type==='MONTHLY'){const m=String(from).match(/^(\d{4})-(\d{2})/);return m?'tháng '+m[2]+'/'+m[1]:''}
 return progressDate(from)+' – '+progressDate(to);
}
function isReportDoc(x){return docGroup(x)==='REPORT'}
function renderReports(){
 const el=document.getElementById('reportsTable');if(!el)return;
 const sel=document.getElementById('reportProject');if(sel){const old=sel.value;sel.innerHTML='<option value="">Tất cả công trình</option>'+(db.projects||[]).map(p=>'<option value="'+p.id+'">'+esc(p.code||'')+' - '+esc(p.name||'')+'</option>').join('');sel.value=old||''}
 const pid=sel?.value||'';const type=document.getElementById('reportType')?.value||'';
 const addBtn=document.getElementById('newReportButton');if(addBtn)addBtn.style.display=(db.projects||[]).filter(p=>!p._localOnly).some(p=>canCreateDocIn(p.id))?'':'none';
 const list=(db.docs||[]).filter(x=>isReportDoc(x)&&!x.pendingUpload&&(!pid||x.projectId===pid)&&(!type||x.details?.reportType===type))
  .sort((a,b)=>String(b.details?.to||b.createdAt).localeCompare(String(a.details?.to||a.createdAt)));
 if(!list.length){el.innerHTML='<p class="muted">Chưa có báo cáo.'+(apiOnline()?'':' (Đang ngoại tuyến)')+'</p>';return}
 const role=roleToken(qualityAuthUser()?.role_name||'');const lead=['ADMIN','DIRECTOR','TVGS_LEAD'].includes(role);
 el.innerHTML='<table><thead><tr><th>Mã</th><th>Loại</th><th>Kỳ báo cáo</th><th>Công trình</th><th>Trạng thái</th><th>Người lập</th><th></th></tr></thead><tbody>'+list.map(x=>{
  const d=x.details||{};const p=db.projects.find(v=>v.id===x.projectId)||{};
  const flow=[x.status==='DRAFT'&&canModifyDoc(x)?['submit','Gửi duyệt']:null,x.status==='SUBMITTED'&&docCanDecide(x)?['approve','Duyệt']:null,x.status==='SUBMITTED'&&docCanDecide(x)?['reject','Trả lại']:null,x.status==='APPROVED'&&docCanDecide(x)?['lock','Khóa']:null].filter(Boolean);
  return '<tr><td>'+esc(x.code)+'</td><td>'+esc(REPORT_TYPES[d.reportType]||'Báo cáo')+'</td><td>'+esc(d.from?reportPeriodLabel(d.reportType,d.from,d.to):(d.period||''))+'</td><td>'+esc(p.name||'')+'</td><td>'+docStatusBadge(x.status)+returnedChip(x)+'</td><td>'+esc(x.createdBy||'')+'</td><td style="white-space:nowrap"><button onclick="viewReport(\''+x.id+'\')">Xem / In</button>'+(canModifyDoc(x)&&x.status==='DRAFT'&&d.snapshot?' <button onclick="openReport(\''+x.id+'\')">Sửa</button>':'')+flow.map(([a,t])=>' <button onclick="reportWorkflow(\''+x.id+'\',\''+a+'\')">'+t+'</button>').join('')+deleteBtn('doc',x.serverId,x.projectId,(x.code||'')+' '+(x.name||''))+'</td></tr>'}).join('')+'</tbody></table>';
}
async function reportWorkflow(id,action){await docWorkflow(id,action)}
function periodInputsHtml(type,d){
 const today=todayIso();
 if(type==='MONTHLY')return '<label>Tháng báo cáo</label><input id="rpFrom" type="month" value="'+esc((d.from||today).slice(0,7))+'">';
 if(type==='FINAL')return '<div class="row"><div><label>Từ ngày (để trống = ngày khởi công)</label><input id="rpFrom" type="date" value="'+esc(d.from||'')+'"></div><div><label>Đến ngày</label><input id="rpTo" type="date" value="'+esc(d.to||today)+'"></div></div>';
 return '<label>'+(type==='WEEKLY'?'Một ngày bất kỳ trong tuần (Thứ Hai – Chủ nhật)':'Ngày báo cáo')+'</label><input id="rpFrom" type="date" value="'+esc(d.from||today)+'">';
}
function openReport(docId=''){
 if(!apiOnline())return alert('Cần kết nối mạng để lập báo cáo (số liệu tổng hợp từ máy chủ).');
 const x=docId?db.docs.find(v=>v.id===docId):null;const d=x?.details||{};
 const projects=x?(db.projects||[]).filter(p=>p.id===x.projectId):serverProjects().filter(p=>canCreateDocIn(p.id));
 if(!projects.length)return alert('Tài khoản chưa được cấp quyền "Thêm" tại công trình nào.');
 const cur=document.getElementById('reportProject')?.value;const type=d.reportType||'WEEKLY';
 reportDraft={docId,snapshot:d.snapshot||null,sections:d.sections||{},rowVersion:x?.rowVersion??null};
 openModal(x?'Sửa '+(REPORT_TYPES[type]||'báo cáo')+' '+x.code:'Lập báo cáo',
  (x?reviewBlockHtml(x,{history:false}):'')+'<div class="row"><div><label>Công trình</label><select id="rpProject"'+(x?' disabled':'')+'>'+projects.map(p=>'<option value="'+p.id+'"'+((x?.projectId||cur)===p.id?' selected':'')+'>'+esc(p.code)+' - '+esc(p.name)+'</option>').join('')+'</select></div>'
  +'<div><label>Loại báo cáo</label><select id="rpType"'+(x?' disabled':'')+' onchange="document.getElementById(\'rpPeriod\').innerHTML=periodInputsHtml(this.value,{});reportDraft.snapshot=null;renderReportEditor()">'+Object.entries(REPORT_TYPES).map(([k,t])=>'<option value="'+k+'"'+(k===type?' selected':'')+'>'+t+'</option>').join('')+'</select></div>'
  +'<div class="full" id="rpPeriod">'+periodInputsHtml(type,d)+'</div>'
  +'<div class="full"><button type="button" class="primary" onclick="compileReport()">Tổng hợp số liệu</button> <span class="muted">Số liệu lấy từ báo cáo ngày, văn bản chất lượng, hồ sơ và bảng tiến độ trên máy chủ.</span></div></div>'
  +'<div id="rpEditor" style="margin-top:12px"></div><div id="rpMessage" class="muted" style="white-space:pre-line"></div>');
 document.querySelector('#modal .modalbox')?.classList.add('wide');
 renderReportEditor();
}
async function compileReport(){
 const msg=document.getElementById('rpMessage');const pid=document.getElementById('rpProject').value;const type=document.getElementById('rpType').value;
 let from=document.getElementById('rpFrom')?.value||'';const to=document.getElementById('rpTo')?.value||'';
 if(type!=='FINAL'&&!from){msg.textContent='Chọn kỳ báo cáo.';return}
 try{msg.textContent='Đang tổng hợp...';
  const snap=await apiRequest('/reports/compile?project_id='+encodeURIComponent(pid)+'&type='+type+'&from='+encodeURIComponent(from)+(to?'&to='+encodeURIComponent(to):''));
  readReportSections();reportDraft.snapshot=snap;msg.textContent='';
  const dup=(db.docs||[]).find(x=>isReportDoc(x)&&x.id!==reportDraft.docId&&x.projectId===pid&&x.details?.reportType===type&&x.details?.from===snap.period.from&&x.details?.to===snap.period.to);
  if(dup)msg.textContent='Lưu ý: đã có '+REPORT_TYPES[type].toLowerCase()+' cùng kỳ ('+dup.code+').';
  renderReportEditor();
 }catch(error){msg.textContent='Không tổng hợp được: '+error.message}
}
function readReportSections(){document.querySelectorAll('#rpEditor textarea[data-sec]').forEach(t=>{reportDraft.sections[t.dataset.sec]=t.value})}
function renderReportEditor(){
 const box=document.getElementById('rpEditor');if(!box||!reportDraft)return;const s=reportDraft.snapshot;
 if(!s){box.innerHTML='<p class="muted">Chọn kỳ rồi bấm "Tổng hợp số liệu".</p>';return}
 const secs=REPORT_SECTIONS[s.type==='FINAL'?'FINAL':'DEFAULT'];
 box.innerHTML='<div class="card" style="max-height:45vh;overflow:auto">'+reportBodyHtml(s,{})+'</div>'
  +'<h4 style="margin:14px 0 6px">Nhận xét của Tư vấn giám sát</h4>'
  +secs.map(([k,t],i)=>'<label>'+(i+1)+'. '+esc(t)+'</label><textarea rows="3" data-sec="'+k+'" placeholder="'+esc(suggestSection(k,s))+'">'+esc(reportDraft.sections[k]||'')+'</textarea>').join('')
  +reportProgressInputHtml(s)
  +'<label>Tài liệu đính kèm (tùy chọn, mỗi tệp ≤ 15 MB)</label><input id="rpFiles" type="file" multiple>'
  +'<div class="toolbar"><button class="primary" id="rpSave" onclick="saveReport(false)">Lưu nháp</button><button onclick="saveReport(true)">Lưu và gửi duyệt</button></div>';
}
async function saveReport(submit){
 const s=reportDraft?.snapshot;const msg=document.getElementById('rpMessage');if(!s){msg.textContent='Chưa tổng hợp số liệu.';return}
 readReportSections();
 const pid=document.getElementById('rpProject').value;const type=s.type;
 const name=REPORT_TYPES[type]+' '+reportPeriodLabel(type,s.period.from,s.period.to);
 const files=[...(document.getElementById('rpFiles')?.files||[])];if(files.some(f=>f.size>MAX_DOC_FILE)){msg.textContent='Có tệp vượt 15 MB.';return}
 const body={expected_row_version:reportDraft.rowVersion,project_id:pid,doc_group:'REPORT',type:'BC',name,details:{reportType:type,from:s.period.from,to:s.period.to,snapshot:s,sections:reportDraft.sections}};
 const btn=document.getElementById('rpSave');if(btn)btn.disabled=true;
 try{
  let doc=reportDraft.docId?await apiRequest('/documents/'+encodeURIComponent(reportDraft.docId),{method:'PATCH',body:JSON.stringify(body)}):await apiRequest('/documents',{method:'POST',body:JSON.stringify(body)});
  reportDraft.docId=doc.id;reportDraft.rowVersion=doc.row_version;
  // Nhập/điều chỉnh % thực tế trong báo cáo → ghi vào bảng tiến độ tại ngày so sánh, rồi tổng hợp lại số liệu
  const manual=collectReportActuals();
  if(manual&&manual.length){
   msg.textContent='Đang cập nhật tiến độ thực tế ('+manual.length+' hạng mục)...';
   await apiRequest('/projects/'+encodeURIComponent(pid)+'/progress-plans/'+encodeURIComponent(s.progress.plan_id)+'/actuals',{method:'POST',body:JSON.stringify({report_date:s.progress.as_of,rows:manual})});
   const snap=await apiRequest('/reports/compile?project_id='+encodeURIComponent(pid)+'&type='+s.type+'&from='+encodeURIComponent(s.period.from)+(s.type==='FINAL'?'&to='+encodeURIComponent(s.period.to):''));
   reportDraft.snapshot=snap;body.details.snapshot=snap;body.expected_row_version=reportDraft.rowVersion;
   doc=await apiRequest('/documents/'+encodeURIComponent(doc.id),{method:'PATCH',body:JSON.stringify(body)});reportDraft.rowVersion=doc.row_version;
  }
  msg.textContent='Đang lưu...';
  for(const f of files){msg.textContent='Đang tải tệp '+f.name;await uploadDocFile(doc.id,f,'Tài liệu kèm báo cáo')}
  if(submit)doc=await apiRequest('/documents/'+encodeURIComponent(doc.id)+'/submit',{method:'POST',body:'{}'});
  doc=await apiRequest('/documents/'+encodeURIComponent(doc.id));
  upsertLocalDoc(mapDocumentFromApi(doc));audit(reportDraft.docId?'UPDATE':'CREATE','report',doc.id,doc.auto_code+' — '+name);save();
  closeModal();reportDraft=null;renderReports();
 }catch(error){if(error.status===409&&reportDraft.docId){queueSync('document',reportDraft.docId,'UPDATE',body);const pending=db.sync.find(x=>x.type==='document'&&x.recordId===reportDraft.docId);pending.status='CONFLICT';pending.lastError=error.message;pending.lastErrorCode=error.code;save();}msg.textContent='Không lưu được: '+error.message+' Nội dung đang nhập vẫn được giữ.';if(btn)btn.disabled=false}
}
function reportBodyHtml(s,{sections,code,title}={}){
 const P=s.project||{},st=s.stats||{},pr=s.progress,iss=s.issues||{opened:[],closed:[],open_total:0};
 const t=(rows,head)=>rows.length?'<table class="rp"><thead><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>':'<p class="muted">Không có.</p>';
 const td=v=>'<td>'+esc(v??'')+'</td>';
 let exec='';
 if(s.type==='DAILY')exec=t(s.logs.map(l=>'<tr>'+td(shiftLabel(l.shift))+td(l.work)+td(l.weather)+'<td>'+resourceSummary(l.worker_items,l.workers)+'</td><td>'+resourceSummary(l.machine_items,l.machines)+'</td>'+td(l.note)+td(l.created_by)+'</tr>'),['Ca','Công việc thực hiện','Thời tiết','Nhân lực','Máy','Ghi chú','Người lập']);
 else if(s.type==='FINAL'){const m={};s.logs.forEach(l=>{const k=l.date.slice(0,7);const x=m[k]=m[k]||{days:new Set(),n:0,w:0};x.days.add(l.date);x.n++;x.w+=Number(l.workers||0)});exec=t(Object.entries(m).map(([k,x])=>'<tr>'+td(k.slice(5)+'/'+k.slice(0,4))+td(x.days.size)+td(x.n)+td(Math.round(x.w/Math.max(1,x.days.size)))+'</tr>'),['Tháng','Số ngày có báo cáo','Số báo cáo ngày','Nhân lực TB/ngày'])}
 else exec=t(sumByDay(s.logs).map(x=>'<tr>'+td(progressDate(x.date))+td(x.shifts.join(', '))+td(x.work.join('; '))+td(x.weather.join(', '))+td(x.workers)+td(x.machines)+'</tr>'),['Ngày','Ca','Công việc thực hiện','Thời tiết','Nhân lực','Máy']);
 const secs=REPORT_SECTIONS[s.type==='FINAL'?'FINAL':'DEFAULT'];
 return (title?'<h2 class="rp-title">'+esc(title)+'</h2>'+(code?'<p class="center"><b>Số: '+esc(code)+'</b></p>':''):'')
  +'<h3>I. Thông tin chung</h3><table class="rp kv"><tbody>'
  +[['Công trình',(P.code?P.code+' - ':'')+(P.name||'')],['Địa điểm',P.location],['Chủ đầu tư',P.owner],['Nhà thầu thi công',P.contractor],['Hợp đồng TVGS số',P.contract_no+(P.contract_date?' ngày '+progressDate(P.contract_date):'')],['Thời gian thực hiện',(P.start_date?progressDate(P.start_date):'—')+' → '+(P.end_date?progressDate(P.end_date):'—')],['Kỳ báo cáo',reportPeriodLabel(s.type,s.period.from,s.period.to)]].map(([k,v])=>'<tr><th style="width:30%">'+k+'</th><td>'+esc(v||'—')+'</td></tr>').join('')+'</tbody></table>'
  +'<h3>II. Tình hình thi công trong kỳ</h3><p>Số báo cáo ngày: <b>'+st.log_count+'</b> · Số ngày có báo cáo: <b>'+st.days_with_logs+'/'+st.days_in_period+'</b> · Nhân lực bình quân: <b>'+st.workers_avg+'</b> người/ngày (cao nhất '+st.workers_max+') · Máy bình quân: <b>'+st.machines_avg+'</b> · Ảnh hiện trường: <b>'+st.photos+'</b></p>'
  +(st.missing_days?.length?'<p style="color:#b54708">Ngày chưa có báo cáo ngày: '+st.missing_days.map(progressDate).join(', ')+'</p>':'')
  +(st.by_status?.DRAFT||st.by_status?.SUBMITTED?'<p style="color:#b54708">Báo cáo ngày chưa được duyệt trong kỳ: '+((st.by_status.DRAFT||0)+(st.by_status.SUBMITTED||0))+'</p>':'')
  +exec
  +'<h3>III. Tiến độ</h3>'+(pr?'<p>Bảng tiến độ: <b>'+esc(pr.plan_name)+'</b>'+(pr.is_extension&&pr.revised_end_date?' (gia hạn đến '+progressDate(pr.revised_end_date)+')':'')+'</p><table class="rp"><thead><tr><th>Kế hoạch lũy kế</th><th>Thực tế lũy kế</th><th>Chênh lệch</th><th>SPI</th>'+(pr.period_actual_gain!==null?'<th>KH tăng trong kỳ</th><th>TT tăng trong kỳ</th>':'')+'</tr></thead><tbody><tr>'+td(pr.planned_percent+'%')+td(pr.actual_percent+'%')+td((pr.variance>0?'+':'')+pr.variance+' điểm %')+td(pr.spi??'—')+(pr.period_actual_gain!==null?td(pr.period_planned_gain+'%')+td(pr.period_actual_gain+'%'):'')+'</tr></tbody></table>'+(pr.mode!=='ITEMS'?'<p class="muted">Bảng tiến độ chưa có hạng mục: tỷ lệ là số nhập tay.</p>':'')+(pr.late_items.length?'<p><b>Hạng mục chậm/quá hạn:</b></p>'+t(pr.late_items.map(i=>'<tr>'+td(i.name)+td(i.planned+'%')+td(i.actual+'%')+td(progressDate(i.end_date))+'</tr>'),['Hạng mục','KH','TT','Hạn']):''):'<p class="muted">Chưa có bảng tiến độ.</p>')
  +reportItemsTableHtml(s)
  +'<h3>IV. Chất lượng công trình</h3><p>Văn bản/biên bản chất lượng phát sinh trong kỳ: <b>'+iss.opened.length+'</b> · Đã đóng trong kỳ: <b>'+iss.closed.length+'</b> · Còn tồn tại đến cuối kỳ: <b>'+iss.open_total+'</b></p>'
  +(iss.opened.length?t(iss.opened.map(i=>'<tr>'+td(i.issue_code)+td(i.title)+td(progressDate(i.created))+td(i.status==='RESOLVED'?'Đã đóng':'Đang xử lý')+'</tr>'),['Mã','Nội dung','Ngày','Trạng thái']):'')
  +'<h3>V. Hồ sơ phát sinh trong kỳ</h3>'+t((s.documents||[]).map(d=>'<tr>'+td(d.auto_code)+td(d.name)+td(DOC_STATUS[d.status]||d.status)+'</tr>'),['Mã','Tên hồ sơ','Trạng thái'])
  +reportAlertsHtml(s)
  +(sections?'<h3>VI. Nhận xét, đánh giá của Tư vấn giám sát</h3>'+secs.map(([k,tt],i)=>'<p><b>'+(i+1)+'. '+esc(tt)+':</b></p><p class="pre">'+esc(sections[k]||'—')+'</p>').join(''):'');
}
function viewReport(docId,loadedDoc){
 const x=loadedDoc||db.docs.find(v=>v.id===docId);if(!x)return;const d=x.details||{};
 if(!d.snapshot)return viewDoc(docId,loadedDoc); // báo cáo kiểu cũ
 const role=roleToken(qualityAuthUser()?.role_name||'');const lead=['ADMIN','DIRECTOR','TVGS_LEAD'].includes(role);
 const flow=[x.status==='DRAFT'&&canModifyDoc(x)?['submit','Gửi duyệt']:null,x.status==='SUBMITTED'&&docCanDecide(x)?['approve','Duyệt']:null,x.status==='SUBMITTED'&&docCanDecide(x)?['reject','Trả lại']:null,x.status==='APPROVED'&&docCanDecide(x)?['lock','Khóa']:null].filter(Boolean);
 setTimeout(()=>loadReviewHistory('documents',x.id),0);
 openModal(x.name,reviewBlockHtml(x)+'<div class="card">'+reportBodyHtml(d.snapshot,{sections:d.sections||{}})+'<hr><p class="muted">Trạng thái: '+docStatusBadge(x.status)+' · Người lập: '+esc(x.createdBy)+' · Số liệu chốt lúc '+esc(fmt(d.snapshot.generated_at))+'</p>'+((x.files||[]).length?'<h4>Tài liệu đính kèm</h4>'+docFileLinks(x):'')+'</div><div class="toolbar"><button class="primary" onclick="printReport(\''+x.id+'\')">In / Xuất PDF</button>'+(canModifyDoc(x)&&x.status==='DRAFT'?'<button onclick="closeModal();openReport(\''+x.id+'\')">Sửa</button>':'')+flow.map(([a,t])=>'<button onclick="reportWorkflow(\''+x.id+'\',\''+a+'\')">'+t+'</button>').join('')+deleteBtn('doc',x.serverId,x.projectId,(x.code||'')+' '+(x.name||''))+'</div>');
 document.querySelector('#modal .modalbox')?.classList.add('wide');
 if(loadedDoc)document.querySelector('#mbody .toolbar')?.remove();
}
function printReport(docId){
 const x=db.docs.find(v=>v.id===docId);if(!x?.details?.snapshot)return;const d=x.details;const w=window.open('','_blank');if(!w)return alert('Trình duyệt chặn cửa sổ in. Hãy cho phép cửa sổ bật lên.');
 const title='BÁO CÁO TƯ VẤN GIÁM SÁT'+({DAILY:' NGÀY',WEEKLY:' TUẦN',MONTHLY:' THÁNG',FINAL:' HOÀN THÀNH'}[d.reportType]||'');
 w.document.write('<!doctype html><meta charset="utf-8"><title>'+esc(x.name)+'</title><style>@page{size:A4;margin:15mm}body{font-family:"Times New Roman",serif;font-size:13px;color:#111;line-height:1.4}.letterhead{display:flex;justify-content:space-between;gap:16px}.brand{display:flex;gap:10px;align-items:center;max-width:58%}.brand img{width:56px;height:56px;object-fit:contain}.brand small{display:block;font-size:9px}.national{text-align:center;font-size:11px}.national span{text-decoration:underline}.rp-title{text-align:center;font-size:17px;margin:16px 0 2px}.center{text-align:center}h3{font-size:14px;margin:14px 0 6px}table.rp{width:100%;border-collapse:collapse;margin:4px 0 8px}table.rp th,table.rp td{border:1px solid #666;padding:4px 6px;font-size:12px;text-align:left;vertical-align:top}table.rp th{background:#f2f2f2}.pre{white-space:pre-wrap;margin:2px 0 8px 14px}.muted{color:#666}.signs{display:grid;grid-template-columns:repeat(3,1fr);text-align:center;margin-top:28px;font-size:12px}.signs div{min-height:110px}</style>'
  +'<div class="letterhead"><div class="brand"><img src="'+location.origin+'/assets/vicoad-logo.png" alt=""><div><b>CÔNG TY TNHH TƯ VẤN XÂY DỰNG VÀ QUẢNG CÁO VINA</b><small>Số 58 ngõ 291 phố Khương Trung, Khương Đình, Hà Nội · Tel: 0988355580</small></div></div><div class="national"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><span>Độc lập - Tự do - Hạnh phúc</span></div></div><hr>'
  +reportBodyHtml(d.snapshot,{sections:d.sections||{},code:x.code,title})
  +'<div class="signs"><div><b>NGƯỜI LẬP</b><br>(Ký, ghi rõ họ tên)<br><br><br><br>'+esc(x.createdBy||'')+'</div><div><b>TƯ VẤN GIÁM SÁT TRƯỞNG</b><br>(Ký, ghi rõ họ tên)</div><div><b>GIÁM ĐỐC</b><br>(Ký tên, đóng dấu)</div></div>');
 w.document.close();setTimeout(()=>{w.focus();w.print()},400);
}

function toggleReportFields(){const report=document.getElementById('dgroup')?.value==='REPORT';document.querySelectorAll('.report-only').forEach(e=>e.style.display=report?'':'none');document.querySelectorAll('.legal-only').forEach(e=>e.style.display=report?'none':'')}

// ---- Báo cáo tuần/tháng: so sánh hạng mục với bảng tiến độ; nhập hoặc lấy tự động % thực tế ----
function reportItemsTableHtml(s){
 const pr=s?.progress;if(!pr||pr.mode!=='ITEMS'||s.type==='DAILY'||!(pr.items||[]).length)return '';
 const list=pr.items.filter(i=>i.in_period!==undefined?i.in_period:i.status!=='CHUA_DEN_HAN');if(!list.length)return '';
 const td=v=>'<td>'+esc(v??'')+'</td>';
 return '<p><b>So sánh các hạng mục thực hiện trong kỳ với bảng tiến độ (đến ngày '+progressDate(pr.as_of)+'):</b></p><table class="rp"><thead><tr><th>Hạng mục</th><th>Thời gian kế hoạch</th><th>KH</th><th>TT</th><th>Lệch (điểm)</th><th>Đánh giá</th></tr></thead><tbody>'
  +list.map(i=>'<tr>'+td((i.code?i.code+'. ':'')+i.name)+td(i.start_date?progressDate(i.start_date)+' → '+progressDate(i.end_date):'')+td(i.planned+'%')+td(i.actual+'%')+td(i.variance!=null?signed(i.variance):signed(Math.round((i.actual-i.planned)*100)/100))+td((ITEM_STATUS[i.status]||[i.status])[0])+'</tr>').join('')+'</tbody></table>';
}
function collectReportActuals(){
 if(document.querySelector('input[name="rpActMode"]:checked')?.value!=='MANUAL')return [];
 const rows=[];
 for(const i of document.querySelectorAll('.rpAct')){
  if(String(i.value)===String(i.dataset.orig))continue;
  const v=Number(i.value);if(!(v>=0&&v<=100))throw new Error('Tỷ lệ thực tế phải trong khoảng 0–100%');
  rows.push({item_id:i.dataset.item,actual_percent:v});
 }
 return rows;
}
