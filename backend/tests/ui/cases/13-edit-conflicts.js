const assert = require('node:assert/strict');
const { uiTest, loginViaApi, apiAs, tokenOf, projectIdByContract } = require('../helpers');

const targets = [
  { route: 'projects', type: 'project', field: 'name', input: '#fname', collection: 'projects', mapper: 'mapProjectFromApi', open: 'openProject', save: 'saveProject' },
  { route: 'daily-logs', type: 'daily_log', field: 'work_summary', input: '#lwork', collection: 'logs', mapper: 'mapDailyLogFromApi', open: 'openLog', save: 'saveLog' },
  { route: 'documents', type: 'document', field: 'name', input: '#dname', collection: 'docs', mapper: 'mapDocumentFromApi', open: 'openDoc', save: 'saveDoc' },
  { route: 'issues', type: 'issue', field: 'title', input: '#ititle', collection: 'issues', mapper: 'mapIssueFromApi', open: 'openIssue', save: 'saveQualityDocument' }
];
async function fixture(api, target, pid, suffix) {
  const payload = target.type === 'project' ? { project_code: 'UI-OCC-' + suffix, contract_no: 'UI-OCC-' + suffix, name: 'Gốc' }
    : target.type === 'daily_log' ? { project_id: pid, log_date: suffix.startsWith('online') ? '2020-01-01' : suffix.startsWith('offline') ? '2020-01-02' : '2020-01-03', shift: 'CA3', work_summary: 'Gốc' }
    : target.type === 'document' ? { project_id: pid, type: 'HS', doc_group: 'LEGAL', name: 'Gốc', details: {} }
    : { project_id: pid, title: 'Gốc', issue_code: 'UI-OCC-' + suffix, details: { documentType: 'MINUTES', status: 'DRAFT', recipients: [{ name: 'Người nhận MVP05', unit: 'VINA' }] } };
  const created = await api.post('/' + target.route, payload);assert.equal(created.status, 201);return created.body;
}
async function openFixture(page, target, record) {
  await page.evaluate(async ({ target, record }) => {
    const mapped = window[target.mapper](record);mapped.serverId=record.id;
    const index=db[target.collection].findIndex(x=>x.id===record.id);
    if(index<0)db[target.collection].push(mapped);else db[target.collection][index]=mapped;
    await window[target.open](record.id);
  }, { target, record });
  await page.waitForSelector('#modal.show ' + target.input);
}
module.exports = function register() {
  for(const otherEdit of [false,true])uiTest('GD-V6-version sửa khi bản tạo mới đang gửi '+(otherEdit?'vẫn chặn thay đổi từ máy khác':'dùng phiên bản CREATE của chính mình'),async page=>{
    await loginViaApi(page,'admin');await page.evaluate(()=>syncDailyLogsFromApi());
    let release,ack,held=false;const gate=new Promise(r=>release=r);
    await page.route('**/api/daily-logs',async route=>{if(route.request().method()==='POST'&&!held){held=true;const response=await route.fetch();ack=await response.json();await page.evaluate(()=>window.__createAckReady=true);await gate;await route.fulfill({response})}else await route.continue()});
    const id=await page.evaluate(otherEdit=>{const id=crypto.randomUUID(),payload={projectId:db.projects[0].id,date:otherEdit?'2020-05-02':'2020-05-01',shift:'CA3',work:'Initial',status:'DRAFT',createdById:getAuthUser().id,photos:[],documents:[]};db.logs.push({id,...payload});queueSync('daily_log',id,'CREATE',payload);save();void syncPendingDailyLogs();return id},otherEdit);
    try{
      await page.waitForFunction(()=>window.__createAckReady);assert.equal(ack.row_version,1);
      await page.evaluate(async id=>{await openLog(id);document.getElementById('lwork').value='Edited before create acknowledgement';void saveLog(id,false)},id);
      await page.waitForFunction(id=>db.sync.some(x=>x.recordId===id&&x.operation==='UPDATE'&&x.payload.expectedRowVersion==null),id);
      const api=apiAs(await tokenOf('admin'));
      if(otherEdit)assert.equal((await api.patch('/daily-logs/'+id,{work_summary:'Other computer',expected_row_version:1})).status,200);
      release();await page.waitForFunction(()=>!dailyLogSyncRunning);await page.evaluate(()=>syncPendingDailyLogs());
      const server=await api.get('/daily-logs/'+id);assert.equal(server.status,200);assert.equal(server.body.work_summary,otherEdit?'Other computer':'Edited before create acknowledgement');
      const local=await page.evaluate(id=>({work:db.logs.find(x=>x.id===id).work,queue:db.sync.find(x=>x.recordId===id)}),id);
      assert.equal(local.work,'Edited before create acknowledgement');
      if(otherEdit){assert.equal(local.queue.status,'CONFLICT');assert.equal(local.queue.lastErrorCode,'EDIT_CONFLICT')}else assert.equal(local.queue,undefined);
    }finally{release()}
  });

  uiTest('GD-V5 daily: mạng vừa bật nhưng lần gửi đầu lỗi vẫn giữ bản nhập chờ', async page => {
    await loginViaApi(page,'admin');
    const b=apiAs(await tokenOf('admin')), a=apiAs(await tokenOf('duong'));
    const pid=await projectIdByContract(await tokenOf('admin'),'001');
    const created=await b.post('/daily-logs',{project_id:pid,log_date:'2020-02-01',shift:'CA3',work_summary:'Gốc'});
    assert.equal(created.status,201);const record=created.body;
    const target=targets.find(t=>t.type==='daily_log');
    await openFixture(page,target,record);await page.fill('#lwork','BẢN ĐIỆN THOẠI');
    await page.context().setOffline(true);await page.evaluate(id=>saveLog(id,false),record.id);
    assert.equal((await a.patch('/daily-logs/'+record.id,{work_summary:'BẢN MÁY TÍNH',expected_row_version:record.row_version})).status,200);
    let failures=0;
    await page.route('**/api/daily-logs/'+record.id,route=>{
      if(route.request().method()==='PATCH'&&failures++===0)return route.abort('failed');
      return route.continue();
    });
    await page.context().setOffline(false);
    await page.waitForFunction(id=>db.sync.find(x=>x.recordId===id)?.lastAttemptAt,record.id);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(()=>navigator.onLine),true);
    const pending=await page.evaluate(id=>db.sync.find(x=>x.recordId===id),record.id);
    assert.equal(pending.status,'PENDING');
    assert.equal(pending.payload.work,'BẢN ĐIỆN THOẠI');
    assert.equal((await b.get('/daily-logs/'+record.id)).body.work_summary,'BẢN MÁY TÍNH');
    // A deliberate retry proves that row_version still detects the competing edit.
    await page.evaluate(()=>showConflictDrafts());
    await page.getByRole('button',{name:'Thử đồng bộ lại',exact:true}).click();
    await page.waitForFunction(id=>db.sync.find(x=>x.recordId===id)?.status==='CONFLICT',record.id);
    assert.equal((await b.get('/daily-logs/'+record.id)).body.work_summary,'BẢN MÁY TÍNH');
    await page.getByRole('button',{name:'Xem hai bản',exact:true}).click();
    await page.waitForSelector('#draftCompare table');
    const text=await page.locator('#draftCompare').innerText();
    assert.match(text,/BẢN ĐIỆN THOẠI/);assert.match(text,/BẢN MÁY TÍNH/);assert.match(text,/Người khác đã sửa/);
    assert.ok(await page.locator('#draftCompare tr[style*="fff3cd"]').count());
    await page.reload();await page.waitForSelector('nav button[data-page="projects"]',{state:'visible'});
    assert.equal(await page.evaluate(id=>db.sync.find(x=>x.recordId===id)?.payload.work,record.id),'BẢN ĐIỆN THOẠI');
  });
  uiTest('GD-V5 bản tạo mới trùng ngày ca: đối chiếu, sửa lại hoặc bỏ không cần GET bản chưa có',async page=>{
    await loginViaApi(page,'admin');const api=apiAs(await tokenOf('admin'));
    const pid=await projectIdByContract(await tokenOf('admin'),'001');
    assert.equal((await api.post('/daily-logs',{project_id:pid,log_date:'2020-02-02',shift:'CA3',work_summary:'Bản có sẵn'})).status,201);
    const id=await page.evaluate(pid=>{
      const id=crypto.randomUUID();const draft={id,projectId:pid,date:'2020-02-02',shift:'CA3',work:'Bản mới bị từ chối',status:'DRAFT',photos:[]};
      db.logs.push(draft);queueSync('daily_log',id,'CREATE',draft);save();return id;
    },pid);
    await page.evaluate(()=>syncPendingDailyLogs());
    assert.equal(await page.evaluate(id=>db.sync.find(x=>x.recordId===id)?.status,id),'CONFLICT');
    await page.evaluate(()=>showConflictDrafts());
    assert.match(await page.locator('#mbody').innerText(),/Dữ liệu bị từ chối/);
    await page.getByRole('button',{name:'Sửa bản nhập',exact:true}).click();
    await page.fill('#ldate','2020-02-03');await page.evaluate(id=>saveLog(id,false),id);
    await page.waitForFunction(id=>!db.sync.some(x=>x.recordId===id),id);
    assert.equal((await api.get('/daily-logs/'+id)).body.work_summary,'Bản mới bị từ chối');
    const fresh=await page.evaluate(pid=>{const id=crypto.randomUUID();const draft={id,projectId:pid,date:'2020-02-02',shift:'CA3',work:'Bỏ chỉ bản mới',status:'DRAFT'};db.logs.push(draft);queueSync('daily_log',id,'CREATE',draft);save();return id;},pid);
    await page.evaluate(()=>syncPendingDailyLogs());let reads=0;
    page.on('request',r=>{if(r.method()==='GET'&&r.url().endsWith('/daily-logs/'+fresh))reads++});
    await page.evaluate(()=>showConflictDrafts());await page.getByRole('button',{name:'Bỏ bản tạo mới trên máy',exact:true}).click();
    await page.waitForFunction(id=>!db.sync.some(x=>x.recordId===id),fresh);assert.equal(reads,0);
    assert.equal(await page.evaluate(id=>db.logs.some(x=>x.id===id),fresh),false);
  });
  for(const competingEdit of [false,true]){
    uiTest('GD-OCC hồ sơ: tải tệp lỗi rồi thử lại '+(competingEdit?'vẫn chặn bản sửa mới của người khác':'không PATCH hoặc tải trùng tệp'),async page=>{
      await loginViaApi(page,'admin');
      const api=apiAs(await tokenOf('admin'));
      const pid=await projectIdByContract(await tokenOf('admin'),'001');
      const target=targets.find(x=>x.type==='document');
      const record=await fixture(api,target,pid,'file-retry-'+competingEdit);
      await openFixture(page,target,record);await page.fill('#dname','B đã lưu thông tin');
      await page.locator('#mbody input[type=file][multiple]').last().setInputFiles([
        {name:'first.txt',mimeType:'text/plain',buffer:Buffer.from('first attachment')},
        {name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry attachment')}
      ]);
      let patches=0;const uploads=[];let failUpload=true;
      page.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/documents/'+record.id))patches++});
      await page.route('**/api/documents/'+record.id+'/files?**',async route=>{
        const name=new URL(route.request().url()).searchParams.get('name');uploads.push(name);
        if(uploads.length===2&&failUpload)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Temporary upload failure"}'});
        return route.continue();
      });
      await page.evaluate(id=>saveDoc(id),record.id);
      assert.equal(patches,1);
      assert.equal(await page.evaluate(id=>queuedFileCount('document',id),record.id),1);
      assert.equal(await page.locator('#modal.show').count(),1);
      const saved=(await api.get('/documents/'+record.id)).body;
      assert.equal(saved.files.length,1);assert.equal(saved.name,'B đã lưu thông tin');
      if(competingEdit){
        const changed=await api.patch('/documents/'+record.id,{name:'A sửa sau B',expected_row_version:saved.row_version});assert.equal(changed.status,200);
        await page.fill('#dname','B sửa tiếp từ bản cũ');
      }
      failUpload=false;
      await page.evaluate(id=>saveDoc(id),record.id);
      const latest=(await api.get('/documents/'+record.id)).body;
      if(competingEdit){
        assert.match(await page.locator('#docMessage').innerText(),/người khác cập nhật/);
        assert.equal(latest.name,'A sửa sau B');assert.equal(latest.files.length,1);
        assert.equal(await page.locator('#dname').inputValue(),'B sửa tiếp từ bản cũ');
        assert.equal(await page.evaluate(id=>queuedFileCount('document',id),record.id),1);
      }else{
        assert.equal(patches,1);assert.equal(uploads.length,3);
        assert.notEqual(uploads[0],uploads[1]);assert.equal(uploads[2],uploads[1]);
        assert.equal(latest.files.length,2);assert.equal(latest.row_version,record.row_version+3);
        assert.equal(await page.evaluate(id=>queuedFileCount('document',id),record.id),0);
        assert.equal(await page.evaluate(id=>db.sync.some(x=>x.recordId===id),record.id),false);
        assert.equal(await page.locator('#modal.show').count(),0);
      }
    });
  }
  uiTest('GD-OCC hồ sơ: GET lỗi sau PATCH giữ checkpoint qua tải lại, không gửi lại thông tin hoặc tệp',async page=>{
    await loginViaApi(page,'admin');
    const api=apiAs(await tokenOf('admin'));
    const pid=await projectIdByContract(await tokenOf('admin'),'001');
    const target=targets.find(x=>x.type==='document');
    const record=await fixture(api,target,pid,'get-retry');
    await openFixture(page,target,record);await page.fill('#dname','Thông tin đã được lưu');
    await page.locator('#mbody input[type=file][multiple]').last().setInputFiles({name:'saved.txt',mimeType:'text/plain',buffer:Buffer.from('saved only once')});
    let patches=0,uploads=0,failGet=true;
    page.on('request',r=>{
      if(r.method()==='PATCH'&&r.url().endsWith('/documents/'+record.id))patches++;
      if(r.method()==='POST'&&r.url().includes('/documents/'+record.id+'/files?'))uploads++;
    });
    await page.route('**/api/documents/'+record.id,route=>route.request().method()==='GET'&&failGet?route.abort('failed'):route.continue());
    await page.evaluate(id=>saveDoc(id),record.id);
    const checkpoint=await page.evaluate(id=>db.sync.find(x=>x.recordId===id),record.id);
    assert.equal(checkpoint.status,'PENDING');assert.equal(checkpoint.savedResult.row_version,record.row_version+2);
    assert.equal(await page.evaluate(id=>queuedFileCount('document',id),record.id),0);
    await page.reload();await page.waitForSelector('nav button[data-page="projects"]',{state:'visible'});
    assert.ok(await page.evaluate(id=>db.sync.find(x=>x.recordId===id)?.savedResult,record.id));
    failGet=false;
    await page.evaluate(()=>syncPendingDocuments());
    await page.waitForFunction(id=>!db.sync.some(x=>x.recordId===id),record.id);
    const latest=(await api.get('/documents/'+record.id)).body;
    assert.equal(latest.name,'Thông tin đã được lưu');assert.equal(latest.files.length,1);
    assert.equal(latest.row_version,record.row_version+2);assert.equal(patches,1);assert.equal(uploads,1);
  });
  for (const target of targets) {
    uiTest(`GD-OCC ${target.type}: giữ biểu mẫu B, giữ bản A, tải lại không xóa nháp`, async page => {
      const user = await loginViaApi(page, 'admin');
      const b=apiAs(await tokenOf('admin')), a=apiAs(await tokenOf('duong'));
      const pid=await projectIdByContract(await tokenOf('admin'),'001');
      const record=await fixture(b,target,pid,'online-'+target.type);
      await openFixture(page,target,record);await page.fill(target.input,'Nội dung B đang nhập');
      const path='/'+target.route+'/'+record.id;
      const saved=await a.patch(path,{...(target.type==='project'?{contract_no:record.contract_no}:{}),[target.field]:'Bản A đã lưu',expected_row_version:record.row_version});assert.equal(saved.status,200);
      // Bộ nhớ đã tải phiên bản mới nhưng biểu mẫu vẫn phải gửi phiên bản lúc mở.
      await page.evaluate(({t,id,v})=>{db[t.collection].find(x=>x.id===id).rowVersion=v;},{t:target,id:record.id,v:saved.body.row_version});
      await page.evaluate(async ({t,id})=>{await window[t.save](id);},{t:target,id:record.id});
      assert.equal(await page.locator(target.input).inputValue(),'Nội dung B đang nhập');
      assert.equal(await page.locator('#modal.show').count(),1);
      if(target.type==='document')assert.match(await page.locator('#docMessage').innerText(),/người khác cập nhật/);
      else assert.ok(page.__dialogs.some(x=>/người khác cập nhật/.test(x)));
      const queued=await page.evaluate(({t,id})=>db.sync.find(x=>x.type===t.type&&x.recordId===id),{t:target,id:record.id});
      assert.equal(queued.status,'CONFLICT');assert.equal(queued.lastErrorCode,'EDIT_CONFLICT');
      assert.equal((await b.get(path)).body[target.field],'Bản A đã lưu');
      if(target.type==='project')await page.evaluate(async()=>mergeProjectsFromServer(await apiGetProjects()));
      if(target.type==='daily_log')await page.evaluate(()=>syncDailyLogsFromApi());
      if(target.type==='document')await page.evaluate(()=>syncDocumentsFromApi());
      if(target.type==='issue')await page.evaluate(()=>syncIssuesFromApi());
      const draft=await page.evaluate(({t,id})=>db[t.collection].find(x=>x.id===id),{t:target,id:record.id});
      assert.equal(draft[target.type==='daily_log'?'work':target.field],'Nội dung B đang nhập');
      await page.evaluate(()=>showConflictDrafts());
      await page.getByRole('button',{name:'Xem hai bản',exact:true}).click();
      await page.waitForSelector('#draftCompare table');
      assert.match(await page.locator('#draftCompare').innerText(),/Nội dung B đang nhập/);
      assert.match(await page.locator('#draftCompare').innerText(),/Bản A đã lưu/);
      await page.reload();await page.waitForSelector('nav button[data-page="projects"]',{state:'visible'});
      assert.equal(await page.evaluate(({t,id})=>db.sync.find(x=>x.type===t.type&&x.recordId===id)?.status,{t:target,id:record.id}),'CONFLICT');
      assert.ok(user.id);
    });
    uiTest(`GD-OCC ${target.type}: ngoại tuyến → mạng lại, xung đột không tự ghi đè`, async page => {
      await loginViaApi(page,'admin');
      const b=apiAs(await tokenOf('admin')), a=apiAs(await tokenOf('duong'));
      const pid=await projectIdByContract(await tokenOf('admin'),'001');
      const record=await fixture(b,target,pid,'offline-'+target.type);
      await openFixture(page,target,record);await page.fill(target.input,'B ngoại tuyến');
      await page.context().setOffline(true);
      await page.evaluate(async({t,id})=>{await window[t.save](id);},{t:target,id:record.id});
      const path='/'+target.route+'/'+record.id;
      assert.equal((await a.patch(path,{...(target.type==='project'?{contract_no:record.contract_no}:{}),[target.field]:'A khi B mất mạng',expected_row_version:record.row_version})).status,200);
      await page.context().setOffline(false);
      const sync={project:'syncPendingProjects',daily_log:'syncPendingDailyLogs',document:'syncPendingDocuments',issue:'syncPendingIssues'}[target.type];
      await page.evaluate(async fn=>{await window[fn]();},sync);
      await page.waitForFunction(({t,id})=>db.sync.find(x=>x.type===t.type&&x.recordId===id)?.status==='CONFLICT',{t:target,id:record.id});
      await page.evaluate(async fn=>{await window[fn]();},sync);
      assert.equal((await b.get(path)).body[target.field],'A khi B mất mạng');
      const draft=await page.evaluate(({t,id})=>db[t.collection].find(x=>x.id===id),{t:target,id:record.id});
      assert.equal(draft[target.type==='daily_log'?'work':target.field],'B ngoại tuyến');
    });
    uiTest(`GD-OCC ${target.type}: ngoại tuyến → mạng lại, bản hợp lệ đồng bộ đúng một lần`, async page => {
      await loginViaApi(page,'admin');
      const b=apiAs(await tokenOf('admin'));
      const pid=await projectIdByContract(await tokenOf('admin'),'001');
      const record=await fixture(b,target,pid,'success-'+target.type);
      await openFixture(page,target,record);await page.fill(target.input,'B lưu khi mất mạng');
      await page.context().setOffline(true);
      await page.evaluate(async({t,id})=>{await window[t.save](id);},{t:target,id:record.id});
      await page.context().setOffline(false);
      const sync={project:'syncPendingProjects',daily_log:'syncPendingDailyLogs',document:'syncPendingDocuments',issue:'syncPendingIssues'}[target.type];
      await page.evaluate(async fn=>{await window[fn]();},sync);
      await page.waitForFunction(({t,id})=>!db.sync.some(x=>x.type===t.type&&x.recordId===id),{t:target,id:record.id});
      const before=(await b.get('/'+target.route+'/'+record.id)).body;
      assert.equal(before[target.field],'B lưu khi mất mạng');assert.equal(before.row_version,record.row_version+1);
      await page.evaluate(async fn=>{await window[fn]();},sync);
      assert.equal((await b.get('/'+target.route+'/'+record.id)).body.row_version,before.row_version);
    });
  }
  uiTest('GD-OCC báo cáo tổng hợp: bản cũ giữ nhận xét, không ghi tiến độ trước khi phát hiện xung đột', async page => {
    await loginViaApi(page,'admin');
    const b=apiAs(await tokenOf('admin')),a=apiAs(await tokenOf('duong'));
    const pid=await projectIdByContract(await tokenOf('admin'),'001');
    const compiled=await b.get('/reports/compile?project_id='+pid+'&type=DAILY&from=2026-10-06');assert.equal(compiled.status,200);
    const created=await b.post('/documents',{project_id:pid,type:'BC',doc_group:'REPORT',name:'Báo cáo OCC',details:{reportType:'DAILY',snapshot:compiled.body,sections:{quality:'Gốc'}}});assert.equal(created.status,201);
    await page.evaluate(raw=>{upsertLocalDoc(mapDocumentFromApi(raw));openReport(raw.id);},created.body);
    await page.fill('#rpEditor textarea[data-sec="quality"]','Nhận xét B đang nhập');
    const path='/documents/'+created.body.id;
    assert.equal((await a.patch(path,{name:'Báo cáo A',expected_row_version:created.body.row_version,details:{...created.body.details,sections:{quality:'Nhận xét A'}}})).status,200);
    let progressWrites=0;page.on('request',request=>{if(request.method()==='POST'&&/progress-plans.*actuals/.test(request.url()))progressWrites++});
    await page.evaluate(()=>saveReport(false));
    assert.equal(await page.locator('#rpEditor textarea[data-sec="quality"]').inputValue(),'Nhận xét B đang nhập');
    assert.match(await page.locator('#rpMessage').innerText(),/người khác cập nhật/);
    assert.equal(progressWrites,0);assert.equal((await b.get(path)).body.details.sections.quality,'Nhận xét A');
  });
  uiTest('GD-OCC chất lượng: response tải lại đến muộn không thay bản vừa xung đột', async page => {
    await loginViaApi(page,'admin');
    const b=apiAs(await tokenOf('admin')),a=apiAs(await tokenOf('duong'));
    const pid=await projectIdByContract(await tokenOf('admin'),'001');
    const target=targets.find(x=>x.type==='issue');
    const record=await fixture(b,target,pid,'delayed-issue');
    await openFixture(page,target,record);await page.fill('#ititle','B giữ khi response muộn');
    assert.equal((await a.patch('/issues/'+record.id,{title:'A giữ trên máy chủ',expected_row_version:record.row_version})).status,200);
    let ready,release;
    const held=new Promise(resolve=>{ready=resolve});
    const gate=new Promise(resolve=>{release=resolve});
    let intercepted=false;
    await page.route('**/api/issues?project_id='+pid,async route=>{
      if(intercepted)return route.continue();
      intercepted=true;const response=await route.fetch();ready();await gate;await route.fulfill({response});
    });
    try{
      await page.evaluate(()=>{window.__heldIssueRefresh=syncIssuesFromApi()});
      await held;
      await page.evaluate(id=>saveQualityDocument(id),record.id);
    }finally{release()}
    await page.evaluate(()=>window.__heldIssueRefresh);
    const local=await page.evaluate(id=>db.issues.find(x=>x.id===id),record.id);
    assert.equal(local.title,'B giữ khi response muộn');
    assert.equal(await page.evaluate(id=>db.sync.find(x=>x.recordId===id)?.status,record.id),'CONFLICT');
    assert.equal((await b.get('/issues/'+record.id)).body.title,'A giữ trên máy chủ');
  });
  uiTest('GD-OCC lưu lần hai khi request đầu đang chạy không làm mất nội dung lần hai', async page => {
    await loginViaApi(page,'admin');
    const api=apiAs(await tokenOf('admin'));
    const pid=await projectIdByContract(await tokenOf('admin'),'001');
    const target=targets.find(x=>x.type==='project');
    const record=await fixture(api,target,pid,'inflight-project');
    await openFixture(page,target,record);await page.fill('#fname','Lần lưu thứ nhất');
    await page.waitForFunction(()=>!projectSyncRunning&&!automaticSyncRunning);
    let ready,release;const held=new Promise(resolve=>{ready=resolve});const gate=new Promise(resolve=>{release=resolve});
    let intercepted=false;
    await page.route('**/api/projects/'+record.id,async route=>{
      if(route.request().method()!=='PATCH'||intercepted)return route.continue();
      intercepted=true;const response=await route.fetch();ready();await gate;await route.fulfill({response});
    });
    try{
      await page.evaluate(id=>{window.__firstSave=saveProject(id)},record.id);
      let timer;try{await Promise.race([held,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Không nhận được PATCH đầu tiên trong 25 giây')),25000)})])}finally{clearTimeout(timer)}
      await page.fill('#fname','Nội dung lần hai cần giữ');
      await page.evaluate(id=>saveProject(id),record.id);
    }finally{release()}
    await page.evaluate(()=>window.__firstSave);
    await page.waitForFunction(id=>db.sync.some(x=>x.recordId===id&&x.status==='CONFLICT'),record.id);
    const local=await page.evaluate(id=>db.projects.find(x=>x.id===id),record.id);
    assert.equal(local.name,'Nội dung lần hai cần giữ');
    assert.equal((await api.get('/projects/'+record.id)).body.name,'Lần lưu thứ nhất');
  });
};
