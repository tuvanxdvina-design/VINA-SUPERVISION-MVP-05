const assert=require('node:assert/strict');
const {uiTest,loginViaApi,openPage,BASE}=require('../helpers');
const {createUsers,createProjects,record,expect}=require('../../lib/roleFixtures');
let users;
async function prepare(){if(!users)users=await createUsers(BASE,'test.b3c3');return createProjects(users);}
async function login(page,who){await loginViaApi(page,users[who].username,users[who].password);await page.evaluate(()=>loadQualityPermissions(true));}
async function reviewButton(page,r){await openPage(page,'inbox');await page.evaluate(()=>loadInbox());const row=page.locator('#inboxBody tr',{hasText:r.work_summary||r.name});await row.waitFor();return row.getByRole('button',{name:'Xem xét',exact:true});}
async function noCachedRecords(page){await page.route(/\/api\/(daily-logs|documents)\?/,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));}
module.exports=function(){
 uiTest('GD-B3 báo cáo chưa có trên máy: tải nội dung, tệp và ảnh từ hộp duyệt',async page=>{
  const f=await prepare(),r=await record(users,f,'daily-logs');
  expect(await users.ks.api.upload('/daily-logs/'+r.id+'/files?name=bang-ke-b3.txt',Buffer.from('Tệp B3'),'text/plain'),201);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=','base64');
  expect(await users.ks.api.upload('/daily-logs/'+r.id+'/attachments-binary?name=anh-b3.png',png,'image/png'),201);
  expect(await users.ks.api.post('/daily-logs/'+r.id+'/submit',{}),200);
  await noCachedRecords(page);await login(page,'gst');
  // Keep a local unsynchronized edit for the same record: review must not overwrite it.
  await page.evaluate(r=>{db.logs=[{id:r.id,serverId:r.id,status:'DRAFT',work:'Nháp riêng còn giữ'}];db.sync.push({type:'daily_log',recordId:r.id,status:'CONFLICT',payload:{work_summary:'Nháp riêng còn giữ'}});},r);
  const detail=page.waitForResponse(x=>x.url().endsWith('/daily-logs/'+r.id)&&x.request().method()==='GET');
  await (await reviewButton(page,r)).click();assert.equal((await detail).status(),200);
  await page.locator('#rvComment').waitFor();assert.ok((await page.locator('#mbody').innerText()).includes(r.work_summary));
  assert.equal(await page.evaluate(()=>db.logs[0].work),'Nháp riêng còn giữ');
  await page.getByRole('button',{name:'Xem tệp/ảnh (2)',exact:true}).click();
  await page.getByRole('link',{name:'bang-ke-b3.txt'}).waitFor();
  await page.getByRole('button',{name:'Xem 1 ảnh hiện trường',exact:true}).click();
  await page.locator('#photoGallery img').waitFor();
  assert.equal(await page.locator('#photoGallery img').getAttribute('src'),'data:image/png;base64,'+png.toString('base64'));
  await page.evaluate(()=>closeModal());await (await reviewButton(page,r)).click();await page.locator('#rvComment').waitFor();
  const approved=page.waitForResponse(x=>x.url().endsWith('/daily-logs/'+r.id+'/approve'));
  await page.locator('#modal button.primary').click();assert.equal((await approved).status(),200);
  assert.equal(expect(await users.admin.api.get('/daily-logs/'+r.id),200).status,'APPROVED');
 });
 for(const code of [403,500])uiTest('GD-B3 HTTP '+code+': không tải được nội dung thì không có nút quyết định',async page=>{
  const f=await prepare(),r=await record(users,f,'daily-logs');await users.ks.api.post('/daily-logs/'+r.id+'/submit',{});
  await noCachedRecords(page);await login(page,'gst');
  await page.route('**/api/daily-logs/'+r.id,route=>route.fulfill({status:code,contentType:'application/json',body:JSON.stringify({error:'Lỗi tải nội dung thử'})}));
  await (await reviewButton(page,r)).click();await page.waitForFunction(()=>document.getElementById('rvLoading')?.textContent.includes('chưa thể duyệt'));
  assert.equal(await page.locator('#rvComment').count(),0);assert.equal(await page.locator('#mbody button[onclick*="submitReviewDecision"]').count(),0);
  assert.equal(expect(await users.admin.api.get('/daily-logs/'+r.id),200).status,'SUBMITTED');
 });
 uiTest('GD-B3 đóng cửa sổ lúc đang tải: response muộn không mở lại quyết định',async page=>{
  const f=await prepare(),r=await record(users,f,'daily-logs');await users.ks.api.post('/daily-logs/'+r.id+'/submit',{});
  await noCachedRecords(page);await login(page,'gst');let release;const hold=new Promise(resolve=>release=resolve);
  await page.route('**/api/daily-logs/'+r.id,async route=>{const response=await route.fetch();await hold;await route.fulfill({response});});
  await (await reviewButton(page,r)).click();await page.locator('#rvLoading').waitFor();await page.evaluate(()=>closeModal());release();
  await page.waitForResponse(x=>x.url().endsWith('/daily-logs/'+r.id));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#modal.show').count(),0);assert.equal(expect(await users.admin.api.get('/daily-logs/'+r.id),200).status,'SUBMITTED');
 });
 uiTest('GD-B3 hồ sơ chưa có trên máy: tải chi tiết và toàn văn, giữ nháp cục bộ',async page=>{
  const f=await prepare(),r=await record(users,f,'documents');
  expect(await users.ks.api.upload('/documents/'+r.id+'/files?name=ho-so-b3.txt',Buffer.from('Hồ sơ B3'),'text/plain'),201);
  await users.ks.api.post('/documents/'+r.id+'/submit',{});await noCachedRecords(page);await login(page,'gst');
  await page.evaluate(r=>{db.docs=[{id:r.id,serverId:r.id,name:'Tên nháp cục bộ',status:'DRAFT'}];db.sync.push({type:'document',recordId:r.id,status:'CONFLICT',payload:{name:'Tên nháp cục bộ'}});},r);
  await (await reviewButton(page,r)).click();await page.locator('#rvComment').waitFor();assert.ok((await page.locator('#mbody').innerText()).includes(r.name));
  await page.getByRole('button',{name:'Xem toàn văn',exact:true}).click();await page.getByRole('link',{name:'ho-so-b3.txt'}).waitFor();
  assert.equal(await page.evaluate(()=>db.docs[0].name),'Tên nháp cục bộ');assert.equal(await page.locator('#mbody button[onclick*="openDoc"]').count(),0);
 });
 uiTest('GD-C3 dùng tài khoản Kỹ sư A làm GST B qua giao diện; không gắn trùng trong B',async page=>{
  const f=await prepare(),second=f.projects.C;await login(page,'admin');await openPage(page,'people');
  await page.selectOption('#directoryProject',f.projects.A.id);await page.waitForFunction(pid=>(teamRowsByProject[pid]||[]).some(x=>x.username==='test.b3c3.ks'),f.projects.A.id);
  await page.selectOption('#directoryProject',second.id);await page.waitForFunction(pid=>!!teamRowsByProject[pid],second.id);
  await page.click('#addPersonButton');await page.locator('#tmName').fill(users.ks.full_name);await page.selectOption('#tmTitle','TVGS trưởng');
  await page.selectOption('#tmAccType','ENGINEER');await page.locator('input[name="tmAccMode"][value="EXISTING"]').check();
  assert.equal(await page.locator('#tmAccount option[value="'+users.ks.id+'"]').getAttribute('disabled'),null);
  await page.selectOption('#tmAccount',users.ks.id);
  const linked=page.waitForResponse(x=>/\/link-account$/.test(x.url())&&x.request().method()==='POST');await page.locator('#mbody button.primary').filter({hasText:'Lưu thay đổi'}).click();assert.equal((await linked).status(),200);
  await page.waitForSelector('#modal.show',{state:'hidden'});
  const perms=expect(await users.ks.api.get('/project-members/my-permissions'),200);
  assert.equal(perms[f.projects.A.id].permissions.includes('APPROVE'),false);assert.equal(perms[second.id].permissions.includes('APPROVE'),true);
  const team=expect(await users.admin.api.get('/project-personnel/project/'+second.id+'/team'),200);
  assert.equal(team.filter(x=>x.user_id===users.ks.id&&x.account_status==='LINKED').length,1);
  await page.click('#addPersonButton');await page.locator('#tmName').fill('Người khác thử C3');await page.selectOption('#tmTitle','GS viên');await page.selectOption('#tmAccType','ENGINEER');await page.locator('input[name="tmAccMode"][value="EXISTING"]').check();
  assert.notEqual(await page.locator('#tmAccount option[value="'+users.ks.id+'"]').getAttribute('disabled'),null);await page.evaluate(()=>closeModal());
  const r=await record(users,f,'daily-logs','C','admin');await users.admin.api.post('/daily-logs/'+r.id+'/submit',{});
  await login(page,'ks');await (await reviewButton(page,r)).click();await page.locator('#rvComment').waitFor();const approved=page.waitForResponse(x=>x.url().endsWith('/daily-logs/'+r.id+'/approve'));await page.locator('#modal button.primary').click();assert.equal((await approved).status(),200);
 });
};
