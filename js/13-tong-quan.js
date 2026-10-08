function renderDashboard(){
document.getElementById('kProjects').textContent=db.projects.length;document.getElementById('kLogs').textContent=db.logs.length;
document.getElementById('kIssues').textContent=db.issues.filter(x=>x.status!=='ĐÃ ĐÓNG').length;document.getElementById('kDocs').textContent=db.docs.filter(x=>x.status==='APPROVED'||x.status==='LOCKED').length;
let st={};db.projects.forEach(p=>st[p.status]=(st[p.status]||0)+1);document.getElementById('projectStats').innerHTML=Object.entries(st).map(([k,v])=>`<p>${esc(k)}: <b>${v}</b></p>`).join('')||'<span class="muted">&#x43;h&#x01b0;a c&#x00f3; d&#x1eef; li&#x1ec7;u</span>';
document.getElementById('syncStats').innerHTML=`<p>Bản ghi đang chờ: <b>${db.sync.filter(x=>x.status!=='CONFLICT').length}</b></p><p>Tệp/ảnh đang chờ trên thiết bị: <b id="offlineFileCount">...</b></p>${db.sync.some(x=>x.status==='CONFLICT')?`<p style="color:#b42318">Cần xử lý: <b>${db.sync.filter(x=>x.status==='CONFLICT').length}</b></p>`:''}${db.sync.length?'<button onclick="showConflictDrafts()">Bản nhập cần đối chiếu / thử đồng bộ lại</button>':''}<p>Trạng thái mạng: <b>${navigator.onLine?'ONLINE':'OFFLINE'}</b></p>`;if(typeof refreshQueuedFileCount==='function')void refreshQueuedFileCount();
document.getElementById('projectProgress').innerHTML=db.projects.length?db.projects.slice(0,8).map(p=>`<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(p.name)}</b><span>${Number(p.progress||0)}%</span></div><div class="progress-track"><span class="progress-fill" style="width:${Math.max(0,Math.min(100,Number(p.progress)||0))}%"></span></div><div class="muted">${esc(p.status||'')}</div></div>`).join(''):'<span class="muted">&#x43;h&#x01b0;a c&#x00f3; c&#x00f4;ng tr&#x00ec;nh</span>';
document.getElementById('dashProjects').innerHTML=projectRows(db.projects.slice(0,20),true);
}
const SEV_LABEL={CRITICAL:'Nghiêm trọng',WARNING:'Cảnh báo',INFO:'Thông tin'};
let portfolioData=null;
function healthChip(h){return '<span class="health '+esc(h||'UNKNOWN')+'">'+esc(HEALTH_LABEL[h]||h||'')+'</span>'}
function pctBar(planned,actual,health){
 if(planned==null&&actual==null)return '<span class="muted">—</span>';
 const color={RED:'#d92d20',AMBER:'#f79009',GREEN:'#12b76a'}[health]||'#2e90fa';
 return '<div class="pbar" title="Kế hoạch '+planned+'% · Thực tế '+actual+'%"><span class="ac" style="width:'+Math.max(0,Math.min(100,Number(actual)||0))+'%;background:'+color+'"></span><span class="pl" style="left:calc('+Math.max(0,Math.min(100,Number(planned)||0))+'% - 1px)"></span></div><div class="muted" style="font-size:12px;margin-top:3px">KH '+(planned??'—')+'% · TT <b>'+(actual??'—')+'%</b></div>';
}
function alertItemHtml(a,p){
 const k=v=>JSON.stringify(v).replace(/"/g,'&quot;');
 return '<div class="alert-item" onclick="goAlertTarget('+k(p?.id||'')+','+k(a.target||'project')+')"><span class="sev '+esc(a.severity)+'">'+esc(SEV_LABEL[a.severity]||a.severity)+'</span><div>'+(p?'<b>'+esc(p.code||'')+' — '+esc(p.name||'')+':</b> ':'')+'<b>'+esc(a.title)+'</b>'+(a.detail?'<div class="muted" style="font-size:12px">'+esc(a.detail)+'</div>':'')+'</div></div>';
}
function goAlertTarget(pid,target){
 if(target==='inbox'&&typeof isReviewer==='function'&&isReviewer())return openInboxPage();
 if(!pid)return;
 if(target==='daily'||target==='issues'){currentProjectId=pid;return openProjectSection(target)}
 if(target==='people'){goPage('people');return loadProjectTeamDirectory(pid)}
 if(target==='reports'){goPage('reports');const sel=document.getElementById('reportProject');if(sel){sel.value=pid;}if(typeof renderReports==='function')renderReports();return}
 openProjectDetail(pid);
 if(target==='progress')setTimeout(()=>document.getElementById('pdProgress')?.scrollIntoView({behavior:'smooth'}),400);
}
async function loadPortfolio(force){
 if(typeof getAuthToken!=='function'||!getAuthToken()||!apiOnline()||window.__forcePw)return;
 const box=document.getElementById('portfolioBox');if(force&&box)box.innerHTML='<p class="muted">Đang tổng hợp...</p>';
 try{portfolioData=await apiRequest('/reports/portfolio')}
 catch(error){if(box)box.innerHTML='<p class="muted">Không tải được tổng quan: '+esc(error.message)+'</p>';return}
 const b=document.getElementById('alertBadge');if(b)b.textContent=portfolioData.summary.critical?String(portfolioData.summary.critical):'';
 renderPortfolio();
}
function renderPortfolio(){
 const box=document.getElementById('portfolioBox');if(!box)return;
 const admin=canManageAssignments();
 const t=document.getElementById('pfTitle');if(t)t.textContent=admin?'Tổng quan tiến độ toàn bộ công trình':'Tiến độ công trình được phân công';
 if(!portfolioData){box.innerHTML='<p class="muted">'+(apiOnline()?'Đang tổng hợp...':'Cần kết nối mạng để xem tổng quan tiến độ.')+'</p>';return}
 const d=portfolioData,sm=d.summary,f=document.getElementById('pfFilter')?.value||'';
 const list=d.projects.filter(p=>!f||p.health===f);
 let h='<div class="grid g4"><div class="card"><div class="muted">'+(admin?'Công trình':'Công trình của tôi')+'</div><div class="kpi">'+sm.projects+'</div></div>'
  +'<div class="card"><div class="muted">● Nghiêm trọng (đỏ)</div><div class="kpi red">'+sm.red+'</div></div>'
  +'<div class="card"><div class="muted">● Cần chú ý (vàng)</div><div class="kpi amber">'+sm.amber+'</div></div>'
  +'<div class="card"><div class="muted">● Bình thường (xanh)</div><div class="kpi green">'+sm.green+'</div></div></div>';
 h+='<div class="card" style="margin-top:14px"><h3>Tình trạng từng công trình <span class="muted" style="font-weight:400;font-size:13px">— tính đến '+progressDate(d.as_of)+'</span></h3>'
  +(list.length?'<div style="overflow:auto"><table><thead><tr><th>Trạng thái</th><th>Công trình</th><th>Kế hoạch / Thực tế</th><th>Lệch</th><th>SPI</th><th>Dự báo xong · Hạn</th><th>Báo cáo ngày gần nhất</th><th>Chờ duyệt</th><th>Cảnh báo</th></tr></thead><tbody>'
  +list.map(p=>{const pl=p.plan||{};const al=(p.alerts||[]).filter(a=>a.severity!=='INFO');
    return '<tr class="clickable" onclick="openProjectDetail(\''+p.id+'\')"><td>'+healthChip(p.health)+'</td><td><b>'+esc(p.code||'')+'</b> — '+esc(p.name||'')+(pl.name?'<br><span class="muted" style="font-size:12px">'+esc(pl.name)+'</span>':'')+'</td>'
     +'<td>'+(p.plan?pctBar(pl.planned,pl.actual,p.health):'<span class="muted">Chưa có bảng tiến độ</span>')+'</td>'
     +'<td style="color:'+((pl.variance||0)<0?'#b42318':'#067647')+'">'+(p.plan?signed(pl.variance):'—')+'</td><td>'+(pl.spi??'—')+'</td>'
     +'<td style="font-size:12px">'+(pl.forecast_end?'<b'+(pl.contract_end&&pl.forecast_end>pl.contract_end?' style="color:#b42318"':'')+'>'+progressDate(pl.forecast_end)+'</b>':'—')+'<br><span class="muted">Hạn '+(pl.contract_end?progressDate(pl.contract_end):'—')+'</span></td>'
     +'<td style="font-size:12px">'+(p.logs?.last_date?progressDate(p.logs.last_date):'—')+(p.logs?.missing_days?.length?'<br><span style="color:#b54708">thiếu '+p.logs.missing_days.length+' ngày</span>':'')+'</td>'
     +'<td>'+(p.approvals?.pending?'<b>'+p.approvals.pending+'</b><br><span class="muted" style="font-size:12px">lâu nhất '+p.approvals.oldest_days+' ngày</span>':'—')+'</td>'
     +'<td style="font-size:12px">'+(al.length?al.slice(0,2).map(a=>'<span class="sev '+a.severity+'" style="display:inline-block;margin:1px 0;padding:1px 6px;border-radius:99px">'+esc(a.title)+'</span>').join('<br>')+(al.length>2?'<br><span class="muted">+'+(al.length-2)+' cảnh báo khác</span>':''):'<span class="muted">—</span>')+'</td></tr>'}).join('')
  +'</tbody></table></div>':'<p class="muted">'+(d.projects.length?'Không có công trình ở trạng thái này.':(admin?'Chưa có công trình.':'Bạn chưa được phân công công trình nào.'))+'</p>')+'</div>';
 const alerts=d.projects.flatMap(p=>(p.alerts||[]).filter(a=>a.severity!=='INFO').map(a=>({a,p}))).filter(x=>!f||x.p.health===f);
 const order={CRITICAL:0,WARNING:1};alerts.sort((x,y)=>order[x.a.severity]-order[y.a.severity]);
 h+='<div class="card" style="margin-top:14px"><h3>Cảnh báo cần xử lý ('+alerts.length+')</h3>'+(alerts.length?alerts.map(x=>alertItemHtml(x.a,x.p)).join(''):'<p class="muted">Không có cảnh báo. 👍</p>')
  +'<details style="margin-top:8px"><summary class="muted">Cách hệ thống đánh giá</summary><ul class="muted" style="font-size:13px">'
  +'<li><b>Tiến độ</b> (chuẩn EVM, như Primavera P6 / MS Project): SPI = % thực tế ÷ % kế hoạch. SPI &lt; '+d.thresholds.spiWarn+' hoặc chậm ≥ '+(-d.thresholds.varianceWarn)+' điểm % → cảnh báo; SPI &lt; '+d.thresholds.spiCrit+' hoặc chậm ≥ '+(-d.thresholds.varianceCrit)+' điểm → nghiêm trọng. Hạng mục quá hạn chưa xong → nghiêm trọng.</li>'
  +'<li><b>Dự báo hoàn thành</b> = thời gian kế hoạch ÷ SPI; trễ hơn hạn hợp đồng → nghiêm trọng.</li>'
  +'<li><b>Cập nhật thực tế</b>: quá '+d.thresholds.staleWarnDays+' ngày chưa cập nhật % thực tế → cảnh báo, quá '+d.thresholds.staleCritDays+' ngày → nghiêm trọng.</li>'
  +'<li><b>Báo cáo ngày</b> (như Procore Daily Log): trong '+d.thresholds.logWindowDays+' ngày qua (trừ Chủ nhật) thiếu ≥ '+d.thresholds.logMissWarn+' ngày → cảnh báo, ≥ '+d.thresholds.logMissCrit+' ngày → nghiêm trọng.</li>'
  +'<li><b>Chờ duyệt quá hạn</b> (như Aconex workflow): quá '+d.thresholds.approvalWarnDays+' ngày → cảnh báo, quá '+d.thresholds.approvalCritDays+' ngày → nghiêm trọng. <b>Vấn đề chất lượng</b> quá hạn xử lý → nghiêm trọng.</li>'
  +'<li><b>Báo cáo định kỳ</b>: từ Thứ Tư chưa có báo cáo tuần trước, sau ngày 5 chưa có báo cáo tháng trước → cảnh báo. <b>Kế hoạch '+d.thresholds.lookaheadDays+' ngày tới</b> (look-ahead): hạng mục sắp bắt đầu → thông tin.</li>'
  +'</ul></details></div>';
 box.innerHTML=h;
}
async function loadProjectHealth(pid){
 const el=document.getElementById('pdHealth');if(!el)return;el.innerHTML='';
 if(!apiOnline())return;
 let d;try{d=await apiRequest('/reports/health/'+encodeURIComponent(pid))}catch(_){return}
 if(currentProjectId!==pid)return;
 const pl=d.plan||{};const al=d.alerts||[];
 el.innerHTML='<div class="card" style="margin-bottom:14px"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Tình trạng công trình</h3>'+healthChip(d.health)
  +(d.plan?'<div style="min-width:200px">'+pctBar(pl.planned,pl.actual,d.health)+'</div><span>Lệch <b>'+signed(pl.variance)+'</b> điểm · SPI <b>'+(pl.spi??'—')+'</b>'+(pl.forecast_end?' · Dự báo xong <b>'+progressDate(pl.forecast_end)+'</b>':'')+(pl.contract_end?' · Hạn '+progressDate(pl.contract_end):'')+'</span>':'')+'</div>'
  +(al.length?al.map(a=>alertItemHtml(a,null).replace('goAlertTarget(&quot;&quot;','goAlertTarget(&quot;'+pid+'&quot;')).join(''):'<p class="muted" style="margin:8px 0 0">Không có cảnh báo.</p>')+'</div>';
}
function reportAlertsHtml(s){
 if(!Array.isArray(s?.alerts))return '';
 const a=s.alerts.filter(x=>x.severity!=='INFO');
 return '<h3>Cảnh báo tự động tại ngày '+progressDate(s.progress?.as_of||s.period?.to)+'</h3>'+(a.length?'<table class="rp"><thead><tr><th style="width:15%">Mức</th><th style="width:30%">Nội dung</th><th>Chi tiết</th></tr></thead><tbody>'+a.map(x=>'<tr><td>'+esc(SEV_LABEL[x.severity]||x.severity)+'</td><td>'+esc(x.title)+'</td><td>'+esc(x.detail||'')+'</td></tr>').join('')+'</tbody></table>':'<p class="muted">Không có cảnh báo.</p>');
}
