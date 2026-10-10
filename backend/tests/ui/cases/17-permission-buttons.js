const assert=require('node:assert/strict');
const {uiTest,loginViaApi,openPage,BASE}=require('../helpers');
const {createUsers,createProjects,record,expect}=require('../../lib/roleFixtures');
let users,fixture;
async function prepare(){if(!users){users=await createUsers(BASE,'test.buttons');fixture=await createProjects(users)}return fixture}
async function login(page,who){await loginViaApi(page,users[who].username,users[who].password);await page.evaluate(()=>loadQualityPermissions(true));}
async function local(page,route,row){await page.evaluate(({route,row})=>{const collection={'daily-logs':'logs',documents:'docs',issues:'issues'}[route],mapper={'daily-logs':mapDailyLogFromApi,documents:mapDocumentFromApi,issues:mapIssueFromApi}[route];const x=mapper(row);x.serverId=row.id;db[collection]=db[collection].filter(v=>v.id!==row.id);db[collection].push(x);renderAll();},{route,row});}
async function visible(page,selector,expected){try{await page.waitForFunction(({selector,expected})=>[...document.querySelectorAll(selector)].some(e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length>0)===expected,{selector,expected});}catch(error){console.error('Nút không đúng',selector,expected,await page.evaluate(()=>({role:getAuthUser()?.role_name,permissions:db.myPermissions,denied:[...deniedUiActions],buttons:[...document.querySelectorAll('#mbody button')].map(b=>({click:b.getAttribute('onclick'),display:b.style.display}))})));throw error}}
module.exports=()=>{
 for(const who of ['admin','gd','gst','ks','ql'])uiTest('GD-NUT '+who+': 5 phân hệ và trạng thái duyệt/khóa',async page=>{
  const f=await prepare(),pid=f.projects.A.id,manager=['admin','gd'].includes(who),lead=manager||who==='gst',create=lead||who==='ks';
  const doc=await record(users,f,'documents'),log=await record(users,f,'daily-logs'),issue=await record(users,f,'issues');
  const sent=expect(await users.ks.api.post('/daily-logs/'+log.id+'/submit',{}),200);
  await login(page,who);for(const [route,r]of[['documents',doc],['daily-logs',sent],['issues',issue]])await local(page,route,r);
  await openPage(page,'projects');await visible(page,'#newProjectButton',manager);
  await page.evaluate(pid=>openProjectDetail(pid),pid);await page.evaluate(()=>loadQualityPermissions(true));
  await visible(page,'#pdEditBtn',lead);
  await openPage(page,'daily');await page.selectOption('#logProject',pid);await page.evaluate(()=>applyPermissionButtons());await visible(page,'#newLogButton',create);
  const row=page.locator('#logsTable tr').filter({hasText:log.work_summary});await row.waitFor();
  assert.equal(await row.locator('button[onclick*="approve"]:visible').count(),lead?1:0);assert.equal(await row.locator('button[onclick*="reject"]:visible').count(),lead?1:0);
  assert.equal(await row.locator('button[onclick*="reopenLog"]:visible').count(),lead?1:0);assert.equal(await row.locator('button[onclick*="deleteContent"]:visible').count(),manager?1:0);
  const logApproved=expect(await users.admin.api.post('/daily-logs/'+log.id+'/approve',{}),200);await local(page,'daily-logs',logApproved);assert.equal(await row.locator('button[onclick*="lock"]:visible').count(),lead?1:0);
  const logLocked=expect(await users.admin.api.post('/daily-logs/'+log.id+'/lock',{}),200);await local(page,'daily-logs',logLocked);assert.equal(await row.locator('button[onclick*="reopenLog"]:visible').count(),lead?1:0);assert.equal(await row.locator('button[onclick^="openLog("]:visible').count(),0);
  await openPage(page,'docs');await page.evaluate(()=>syncDocumentsFromApi());await page.selectOption('#docProject',pid);await page.evaluate(()=>applyPermissionButtons());await visible(page,'#docs .toolbar button.primary',create);
  await page.evaluate(id=>viewDoc(id),doc.id);await visible(page,'#mbody button[onclick*="openDoc"]',create);
  await visible(page,'#mbody button[onclick*="submit"]',create);await visible(page,'#mbody button[onclick*="deleteContent"]',manager);
  const submitted=expect(await users.ks.api.post('/documents/'+doc.id+'/submit',{}),200);await local(page,'documents',submitted);await page.evaluate(id=>viewDoc(id),doc.id);
  await visible(page,'#mbody button[onclick*="approve"]',lead);await visible(page,'#mbody button[onclick*="reject"]',lead);
  if(lead){await page.evaluate(id=>openReviewDecision('documents',id),doc.id);await page.waitForSelector('#rvComment');await visible(page,'#mbody button[onclick*="escalate"]',!manager);}
  const approved=expect(await users.admin.api.post('/documents/'+doc.id+'/approve',{}),200);await local(page,'documents',approved);await page.evaluate(id=>viewDoc(id),doc.id);await visible(page,'#mbody button[onclick*="lock"]',lead);
  const locked=expect(await users.admin.api.post('/documents/'+doc.id+'/lock',{}),200);await local(page,'documents',locked);await page.evaluate(id=>viewDoc(id),doc.id);await visible(page,'#mbody button[onclick*="reopen"]',lead);await visible(page,'#mbody button[onclick*="openDoc"]',false);await page.evaluate(()=>closeModal());
  await openPage(page,'issues');await page.selectOption('#issueProject',pid);await page.evaluate(()=>applyPermissionButtons());await visible(page,'#issues .toolbar button.primary',create);
  const ir=page.locator('#issuesTable tr').filter({hasText:issue.title});assert.equal(await ir.locator('button[onclick*="openIssue"]:visible').count(),create?1:0);
  assert.equal(await ir.locator('button[onclick*="closeIssue"]:visible').count(),create?1:0);
  await page.evaluate(id=>viewIssue(id),issue.id);await visible(page,'#mbody button[onclick*="deleteContent"]',manager);await page.evaluate(()=>closeModal());
  const closed=expect(await users.admin.api.post('/issues/'+issue.id+'/resolve',{expected_row_version:issue.row_version,resolution_note:'Đóng thử'}),200);await local(page,'issues',closed);assert.equal(await ir.locator('button[onclick*="reopenQualityDocument"]:visible').count(),lead?1:0);
  if(manager){
   await openPage(page,'companyPeople');await page.evaluate(()=>loadCompanyPersonnel());await visible(page,'#companyAddProfile',true);await visible(page,'#companyMergeButton',true);
   const profile=expect(await users.admin.api.post('/company-personnel',{full_name:'Hồ sơ nút '+who}),201);await page.evaluate(id=>viewCompanyProfile(id),profile.id);await visible(page,'#mbody button[onclick*="editCompanyProfile"]',true);await visible(page,'#mbody button[onclick*="editCompanyCertificate"]',true);await visible(page,'#mbody button[onclick*="deleteCompanyProfile"]',true);await page.evaluate(()=>closeModal());
  }else await visible(page,'nav button[data-page="companyPeople"]',false); // Hồ sơ công ty chỉ dành cho Admin/Giám đốc
  assert.equal(await page.evaluate(()=>typeof canEdit),'undefined');
 });
 uiTest('GD-NUT lưu công trình: quyền APPROVE tại B, không theo tên tài khoản',async page=>{
  const f=await prepare();await login(page,'ks');await page.evaluate(pid=>openProject(pid),f.projects.B.id);await page.fill('#fname','Sửa đúng công trình B');await page.click('#mbody button[onclick*="saveProject"]');
  await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));assert.equal(expect(await users.admin.api.get('/projects/'+f.projects.B.id),200).name,'Sửa đúng công trình B');
  await page.evaluate(()=>{db.role='Giám đốc ADMIN DIRECTOR';const a=JSON.parse(localStorage.getItem(AUTH_KEY));a.user.full_name='ADMIN DIRECTOR Giám đốc';localStorage.setItem(AUTH_KEY,JSON.stringify(a));renderAll();});
  assert.equal(await page.evaluate(()=>canManageAssignments()),false);await visible(page,'#newProjectButton',false);
 });
 for(const event of ['online','pageshow','visibilitychange','project'])uiTest('GD-NUT tải lại quyền khi '+event+'; giữ nội dung đang nhập',async page=>{
  const f=await prepare(),member=f.members.A.ks.id;expect(await users.admin.api.put('/project-members/'+member,{access_permissions:['VIEW','CREATE','EDIT','APPROVE']}),200);
  await login(page,'ks');const d=await record(users,f,'documents');await local(page,'documents',d);await page.evaluate(id=>openDoc(id),d.id);await page.fill('#dname','BẢN NHẬP PHẢI GIỮ');
  expect(await users.admin.api.put('/project-members/'+member,{access_permissions:['VIEW']}),200);
  await page.evaluate(event=>{if(event==='project')document.getElementById('dproj').dispatchEvent(new Event('change',{bubbles:true}));else if(event==='visibilitychange')document.dispatchEvent(new Event(event));else window.dispatchEvent(new Event(event));},event);
  await visible(page,'#docSaveBtn',false);assert.equal(await page.locator('#dname').inputValue(),'BẢN NHẬP PHẢI GIỮ');assert.equal(await page.locator('#modal.show').count(),1);
  expect(await users.admin.api.put('/project-members/'+member,{access_permissions:['VIEW','CREATE']}),200);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await visible(page,'#docSaveBtn',true);
 });
 uiTest('GD-NUT 403 thực: ẩn nút lưu, báo quyền đổi, giữ chữ/file/hàng đợi',async page=>{
  const f=await prepare(),member=f.members.A.ks.id;expect(await users.admin.api.put('/project-members/'+member,{access_permissions:['VIEW','CREATE']}),200);await login(page,'ks');
  const d=await record(users,f,'documents');await local(page,'documents',d);await page.evaluate(id=>openDoc(id),d.id);await page.fill('#dname','KHÔNG MẤT KHI 403');
  const input=page.locator('#mbody input[type=file]').first();await input.setInputFiles({name:'ban-nhap.txt',mimeType:'text/plain',buffer:Buffer.from('Nội dung thử')});
  const pending=await page.evaluate(()=>JSON.stringify(db.sync));expect(await users.admin.api.put('/project-members/'+member,{access_permissions:['VIEW']}),200);
  await page.click('#docSaveBtn');await visible(page,'#docSaveBtn',false);await page.waitForSelector('#permissionChangedNotice');assert.match(await page.locator('#permissionChangedNotice').innerText(),/Quyền của bạn đã thay đổi/);
  assert.equal(await page.locator('#dname').inputValue(),'KHÔNG MẤT KHI 403');
  const retained=await page.evaluate(async id=>({files:(await queuedFiles('document',id)).map(f=>({name:f.name})),item:db.sync.find(x=>x.type==='document'&&x.recordId===id),other:JSON.stringify(db.sync.filter(x=>x.recordId!==id))}),d.id);
  assert.equal(retained.files[0].name,'ban-nhap.txt');assert.equal(await page.evaluate(async id=>(await queuedFiles('document',id))[0].blob.text(),d.id),'Nội dung thử');
  assert.equal(retained.item.payload.name,'KHÔNG MẤT KHI 403');assert.equal(retained.other,pending);
 });
};
