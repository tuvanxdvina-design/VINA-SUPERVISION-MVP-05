const assert = require('node:assert/strict');
const { uiTest, loginViaApi, openPage, BASE } = require('../helpers');
const { createUsers, createProjects, record, expect } = require('../../lib/roleFixtures');
let users;
async function prepare() {
  if(!users) users=await createUsers(BASE,'test.ui');
  return createProjects(users);
}
async function login(page,who) {
  await loginViaApi(page,users[who].username,users[who].password);
  await page.evaluate(async()=>{await loadQualityPermissions(true)});
}
const kinds={
  'daily-logs':{collection:'logs',mapper:'mapDailyLogFromApi',input:'#lwork',open:'openLog',save:'saveLog',type:'daily_log',field:'work_summary'},
  documents:{collection:'docs',mapper:'mapDocumentFromApi',input:'#dname',open:'openDoc',save:'saveDoc',type:'document',field:'name'},
  issues:{collection:'issues',mapper:'mapIssueFromApi',input:'#ititle',open:'openIssue',save:'saveQualityDocument',type:'issue',field:'title'}
};
async function putLocal(page,route,r,project) {
  // Đọc chi tiết thực trong phiên đang đăng nhập; không tạo giả can_edit/lịch sử duyệt.
  r=await page.evaluate(path=>apiRequest(path),'/' + route + '/' + r.id);
  await page.evaluate(({kind,r,project})=>{
    if(!db.projects.some(p=>p.id===project.id))db.projects.push(mapProjectFromApi(project));
    const mapped=window[kind.mapper](r);mapped.serverId=r.id;
    const i=db[kind.collection].findIndex(x=>x.id===r.id);
    if(i<0)db[kind.collection].push(mapped);else db[kind.collection][i]=mapped;
    renderAll();
  },{kind:kinds[route],r,project});
}
module.exports=function(){
  for(const who of ['ks','gst','ql','gd','admin']){
    uiTest('GD-PQ vai trò '+who+': nút xem/sửa/duyệt/xóa theo A/B/C và API thực',async page=>{
      const f=await prepare(), rows=[];
      for(const ct of ['A','B','C']){
        const log=await record(users,f,'daily-logs',ct,'admin');
        const sent=expect(await users.admin.api.post('/daily-logs/'+log.id+'/submit',{}),200);
        const doc=await record(users,f,'documents',ct,'admin');
        const issue=await record(users,f,'issues',ct,'admin');
        rows.push({ct,log:sent,doc,issue});
      }
      await login(page,who);
      const global=['admin','gd'].includes(who);
      for(const {ct,log,doc,issue} of rows){
        const view=global||(who==='ks'&&ct!=='C')||who==='gst'||(who==='ql'&&ct==='A');
        const lead=global||(who==='ks'&&ct==='B')||(who==='gst'&&ct==='A');
        for(const [route,r] of [['daily-logs',log],['documents',doc],['issues',issue]]){
          const actual=await users[who].api.get('/'+route+'/'+r.id);
          expect(actual,view?200:403);
          if(view)await putLocal(page,route,actual.body,f.projects[ct]);
        }
        const perms=await page.evaluate(pid=>myPerms(pid),f.projects[ct].id);
        assert.equal(perms.includes('VIEW'),view);assert.equal(perms.includes('APPROVE'),lead);
        if(!view){assert.equal(await page.evaluate(pid=>db.projects.some(p=>p.id===pid),f.projects[ct].id),false);continue;}
        await openPage(page,'daily');
        await page.evaluate(()=>{document.getElementById('logProject').value='';document.getElementById('logAuthor').value='';renderLogs()});
        const lr=page.locator('#logsTable tr',{hasText:log.work_summary});
        await lr.waitFor();
        assert.equal(await lr.locator('button[onclick*="approve"]').count(),lead?1:0);
        assert.equal(await lr.locator('button[onclick*="deleteContent"]').count(),global?1:0);
        await openPage(page,'docs');
        await page.evaluate(()=>{document.getElementById('docProject').value='';document.getElementById('docGroup').value='';renderDocs()});
        const dr=page.locator('#docsTable tr',{hasText:doc.name});await dr.waitFor();
        assert.equal(await dr.locator('button[onclick*="openDoc"]').count(),lead?1:0);
        const canEditIssue=await page.evaluate(id=>qualityCanEdit(db.issues.find(x=>x.id===id)),issue.id);
        assert.equal(canEditIssue,lead);
        if(who==='ks'&&ct==='B'){
          await openPage(page,'daily');
          const response=page.waitForResponse(r=>r.url().endsWith('/daily-logs/'+log.id+'/approve')&&r.request().method()==='POST');
          await page.locator('#logsTable tr',{hasText:log.work_summary}).locator('button[onclick*="approve"]').click();
          // Duyệt dùng modal quyết định chung; phải bấm nút xác nhận thật.
          await page.waitForSelector('#modal.show #rvComment');
          await page.locator('#modal button.primary').first().click();
          assert.equal((await response).status(),200);
          assert.equal(expect(await users.admin.api.get('/daily-logs/'+log.id),200).status,'APPROVED');
        }
      }
    });
  }
  uiTest('GD-PQ nháp riêng và trình công ty: GST không thấy nháp/không tự quyết',async page=>{
    const f=await prepare(), r=await record(users,f,'daily-logs');
    await login(page,'gst');await openPage(page,'daily');
    assert.equal(await page.locator('#logsTable tr',{hasText:r.work_summary}).count(),0);
    expect(await users.gst.api.get('/daily-logs/'+r.id),404);
    await users.ks.api.post('/daily-logs/'+r.id+'/submit',{});
    expect(await users.gst.api.post('/daily-logs/'+r.id+'/escalate',{comment:'Công ty quyết định'}),200);
    const escalated=expect(await users.gst.api.get('/daily-logs/'+r.id),200);
    await putLocal(page,'daily-logs',escalated,f.projects.A);
    const html=await page.evaluate(id=>logActionsHtml(db.logs.find(x=>x.id===id)),r.id);
    assert.ok(!html.includes("'approve'"));assert.ok(!html.includes("'reject'"));
    expect(await users.gst.api.post('/daily-logs/'+r.id+'/approve',{}),409);
  });
  for(const who of ['admin','gd'])uiTest('GD-PQ LOCKED: '+who+' không có nút sửa báo cáo/hồ sơ',async page=>{
    const f=await prepare();await login(page,who);
    for(const route of ['daily-logs','documents']){
      const r=await record(users,f,route),p='/'+route+'/'+r.id;
      expect(await users.ks.api.post(p+'/submit',{}),200);expect(await users.gst.api.post(p+'/approve',{}),200);
      const locked=expect(await users.gst.api.post(p+'/lock',{}),200);await putLocal(page,route,locked,f.projects.A);
      const editable=await page.evaluate(({route,id})=>route==='documents'?canModifyDoc(db.docs.find(x=>x.id===id)):canEditLog(db.logs.find(x=>x.id===id)),{route,id:r.id});
      assert.equal(editable,false);
      if(route==='documents'){
        await openPage(page,'docs');const row=page.locator('#docsTable tr',{hasText:r.name}).filter({hasText:'Đã khóa'});await row.waitFor();
        assert.equal(await row.locator('button[onclick*="openDoc"]').count(),0);
      }else{
        await openPage(page,'daily');const row=page.locator('#logsTable tr',{hasText:r.work_summary});await row.waitFor();
        assert.equal(await row.locator('button[onclick^="openLog("]').count(),0);
      }
    }
  });
  uiTest('GD-PQ tùy chỉnh: Xóa chỉ ở A, bỏ DOWNLOAD ẩn liên kết tệp',async page=>{
    const f=await prepare(), a=await record(users,f,'documents'),b=await record(users,f,'documents','B');
    const file=expect(await users.ks.api.upload('/documents/'+a.id+'/files?name=thu.txt',Buffer.from('Tệp thử')),201);
    expect(await users.gd.api.put('/project-members/'+f.members.A.ks.id,{access_permissions:['VIEW','CREATE','DELETE']}),200);
    await login(page,'ks');await putLocal(page,'documents',expect(await users.ks.api.get('/documents/'+a.id),200),f.projects.A);
    await putLocal(page,'documents',b,f.projects.B);await openPage(page,'docs');
    const ar=page.locator('#docsTable tr',{hasText:a.name}),br=page.locator('#docsTable tr',{hasText:b.name});
    await ar.waitFor();await br.waitFor();
    assert.equal(await ar.locator('button[onclick*="deleteContent"]').count(),1);
    assert.equal(await br.locator('button[onclick*="deleteContent"]').count(),0);
    assert.equal(await ar.locator('a[onclick*="openServerFile"]').count(),0);
    expect(await users.ks.api.get('/documents/'+a.id+'/files/'+file.id),403);
  });
  uiTest('GD-PQ quản trị bỏ APPROVE của GST: giao diện không tự tích lại khi đổi chức danh',async page=>{
    const f=await prepare();await login(page,'admin');
    await page.evaluate(async({pid,uid})=>{
      teamRowsByProject[pid]=await apiRequest('/project-personnel/project/'+pid+'/team');
      const row=teamRowsByProject[pid].find(x=>x.user_id===uid);
      await openTeamMember(encodeURIComponent(row.key),pid);
    },{pid:f.projects.A.id,uid:users.gst.id});
    await page.waitForSelector('#modal.show .tmPerm');
    await page.locator('input[name="tmPermMode"][value="CUSTOM"]').check();
    await page.locator('.tmPerm[value="APPROVE"]').uncheck();
    await page.selectOption('#tmTitle','TVGS trưởng');
    assert.equal(await page.locator('.tmPerm[value="APPROVE"]').isChecked(),false);
    assert.ok(!(await page.evaluate(()=>readPermEditor().access_permissions)).includes('APPROVE'));
    await page.locator('#modal button[onclick*="saveTeamMember"]').click();
    await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show')||/Không lưu được|Nhập |Chọn /.test(document.getElementById('tmMessage')?.textContent||''));
    assert.equal(await page.locator('#modal.show').count(),0,await page.locator('#tmMessage').textContent());
    const map=expect(await users.gst.api.get('/project-members/my-permissions'),200);
    assert.ok(!map[f.projects.A.id].permissions.includes('APPROVE'));
  });
  uiTest('GD-PQ quyền rỗng: quản trị thấy đúng các ô bỏ chọn, không biến thành mặc định',async page=>{
    const f=await prepare();expect(await users.admin.api.put('/project-members/'+f.members.A.ks.id,{access_permissions:[]}),200);
    await login(page,'admin');
    await page.evaluate(async({pid,uid})=>{
      teamRowsByProject[pid]=await apiRequest('/project-personnel/project/'+pid+'/team');
      await openTeamMember(encodeURIComponent(teamRowsByProject[pid].find(x=>x.user_id===uid).key),pid);
    },{pid:f.projects.A.id,uid:users.ks.id});
    await page.waitForSelector('#modal.show .tmPerm');
    assert.equal(await page.locator('.tmPerm:checked').count(),0);
    assert.deepEqual(await page.evaluate(()=>readPermEditor().access_permissions),[]);
    await page.locator('.tmPerm[value="VIEW"]').check();
    await page.locator('.tmPerm[value="VIEW"]').uncheck();
    assert.deepEqual(await page.evaluate(()=>readPermEditor().access_permissions),[]);
    expect(await users.ks.api.get('/projects/'+f.projects.A.id),403);
  });
  uiTest('GD-PQ hết hạn phân công: không hiện công trình, URL/API chi tiết bị chặn',async page=>{
    const f=await prepare(),r=await record(users,f,'documents');
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    expect(await users.admin.api.put('/project-members/'+f.members.A.ks.id,{end_date:yesterday}),200);
    await login(page,'ks');await openPage(page,'projects');
    await page.waitForFunction(pid=>!db.projects.some(p=>p.id===pid),f.projects.A.id);
    assert.equal(await page.locator('#projectsTable tr',{hasText:f.projects.A.name}).count(),0);
    const status=await page.evaluate(async id=>{try{await apiRequest('/documents/'+id);return 200}catch(e){return e.status}},r.id);
    assert.equal(status,403);
  });
  uiTest('GD-PQ thùng rác: Giám đốc không có purge, Admin bấm xóa vĩnh viễn được',async page=>{
    const f=await prepare(),r=await record(users,f,'documents');
    const trash=expect(await users.gd.api.del('/documents/'+r.id,{reason:'Thử xóa vĩnh viễn'}),200);
    await login(page,'gd');await openPage(page,'trash');
    const gdRow=page.locator('#trashBody tr',{hasText:r.name});await gdRow.waitFor();
    assert.equal(await gdRow.locator('button[onclick*="purgeTrash"]').count(),0);
    expect(await users.gd.api.del('/recycle-bin/'+trash.recycle_id),403);
    await login(page,'admin');await openPage(page,'trash');
    const adminRow=page.locator('#trashBody tr',{hasText:r.name});await adminRow.waitFor();
    const response=page.waitForResponse(x=>x.url().endsWith('/recycle-bin/'+trash.recycle_id)&&x.request().method()==='DELETE');
    await adminRow.locator('button[onclick*="purgeTrash"]').click();assert.equal((await response).status(),200);
  });
  for(const route of ['daily-logs','documents','issues'])uiTest('GD-PQ đang nhập '+route+': thu hồi phân công chặn lưu, giữ nội dung',async page=>{
    const f=await prepare(), r=await record(users,f,route),kind=kinds[route];await login(page,'ks');
    await putLocal(page,route,r,f.projects.A);
    await page.evaluate(({kind,id})=>window[kind.open](id),{kind,id:r.id});await page.waitForSelector('#modal.show '+kind.input);
    await page.fill(kind.input,'Bản đang nhập không được mất');
    expect(await users.admin.api.del('/project-members/'+f.members.A.ks.id),200);
    const response=page.waitForResponse(x=>x.url().endsWith('/'+route+'/'+r.id)&&x.request().method()==='PATCH');
    await page.evaluate(({kind,id})=>window[kind.save](id),{kind,id:r.id});assert.equal((await response).status(),403);
    assert.equal(await page.inputValue(kind.input),'Bản đang nhập không được mất');
    assert.ok(await page.locator('#modal.show').isVisible());
    assert.equal(expect(await users.admin.api.get('/'+route+'/'+r.id),200).row_version,r.row_version);
  });
  for(const route of ['daily-logs','documents','issues'])uiTest('GD-PQ ngoại tuyến '+route+': mất quyền vẫn giữ hàng đợi và tệp',async page=>{
    const f=await prepare(), r=await record(users,f,route),kind=kinds[route];await login(page,'ks');await putLocal(page,route,r,f.projects.A);
    await page.context().setOffline(true);
    await page.evaluate(async({kind,r})=>{
      queueSync(kind.type,r.id,'UPDATE',{project_id:r.project_id,projectId:r.project_id,name:'Bản ngoại tuyến',title:'Bản ngoại tuyến',work_summary:'Bản ngoại tuyến',work:'Bản ngoại tuyến',expected_row_version:r.row_version,expectedRowVersion:r.row_version});
      await queueOfflineFiles(kind.type,r.id,[{file:new File(['Nội dung tệp giữ lại'],'cho-dong-bo.txt',{type:'text/plain'}),kind:'DOCUMENT',category:'TEST'}]);
      save();
    },{kind,r});
    expect(await users.admin.api.del('/project-members/'+f.members.A.ks.id),200);
    await page.context().setOffline(false);
    await page.evaluate(async type=>{
      if(type==='document')await syncPendingDocuments();else if(type==='daily_log')await syncPendingDailyLogs();else await syncPendingIssues();
    },kind.type);
    await page.waitForFunction(({type,id})=>(db.sync||[]).some(x=>x.type===type&&x.recordId===id&&!!x.lastError),{type:kind.type,id:r.id});
    const retained=await page.evaluate(async({type,id})=>{
      const q=db.sync.find(x=>x.type===type&&x.recordId===id),files=await queuedFiles(type,id);
      return{status:q.status,error:q.lastError,work:q.payload.work_summary,fileCount:files.length,text:files.length?await files[0].blob.text():''};
    },{type:kind.type,id:r.id});
    assert.equal(retained.status,'PENDING');assert.ok(retained.error);assert.equal(retained.work,'Bản ngoại tuyến');
    assert.equal(retained.fileCount,1);assert.equal(retained.text,'Nội dung tệp giữ lại');
    assert.equal(expect(await users.admin.api.get('/'+route+'/'+r.id),200).row_version,r.row_version);
  });
};
