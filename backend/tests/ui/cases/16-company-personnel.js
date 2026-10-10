const assert=require('node:assert/strict');
const {uiTest,loginViaApi,openPage,BASE}=require('../helpers');
const {createUsers,createProjects,expect}=require('../../lib/roleFixtures');
let users,fixture;
async function prepare(){if(!users){users=await createUsers(BASE,'test.hoso');fixture=await createProjects(users)}return fixture}
async function login(page,who){await loginViaApi(page,users[who].username,users[who].password);await page.evaluate(async()=>loadQualityPermissions(true));await openPage(page,'companyPeople');await page.waitForFunction(()=>!!document.querySelector('#companyPersonnelTable table'))}
module.exports=()=>{
 for(const who of ['gst','ks'])uiTest('GD-HS '+who+': không thấy hồ sơ nhân sự công ty và thống kê chứng chỉ; API chặn; nhân sự công trình vẫn xem',async page=>{
  const f=await prepare();const p=expect(await users.admin.api.post('/company-personnel',{full_name:'Hồ sơ ẩn '+who}),201);
  await loginViaApi(page,users[who].username,users[who].password);await page.evaluate(async()=>loadQualityPermissions(true));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('nav button[data-page="companyPeople"]')).display==='none');
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('companyCertificateSummary')).display==='none');
  const status=await page.evaluate(async id=>{const out=[];for(const path of ['/company-personnel','/company-personnel/'+id]){try{await apiRequest(path);out.push(200)}catch(e){out.push(e.status)}}return out},p.id);assert.deepEqual(status,[403,403]);
  assert.ok(expect(await users[who].api.get('/project-personnel/project/'+f.projects.A.id+'/team'),200).length>0);
 });
 uiTest('GD-HS Giám đốc: nhập hồ sơ/chứng chỉ/scan, cảnh báo bắt tích Tôi đã biết rồi phân công',async page=>{
  const f=await prepare();await login(page,'gd');await page.click('#companyAddProfile');await page.fill('#cpName','Hồ sơ giao diện GD');await page.click('#cpSave');await page.waitForFunction(()=>document.querySelector('#mtitle')?.textContent==='Hồ sơ: Hồ sơ giao diện GD');await page.getByRole('button',{name:'+ Chứng chỉ',exact:true}).click();
  await page.fill('#cc_certificate_type','Giám sát xây dựng');await page.fill('#cc_certificate_number','GD-HS-1');await page.fill('#cc_grade','I');await page.fill('#cc_field','Dân dụng');await page.fill('#cc_issued_on','2020-01-01');await page.fill('#cc_expires_on','2021-01-01');await page.fill('#cc_issuer','Sở thử');await page.setInputFiles('#ccFiles',{name:'chung-chi-gd.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 UI-scan')});await page.click('#ccSave');await page.getByRole('button',{name:'Xem scan: chung-chi-gd.pdf',exact:true}).waitFor();assert.match(await page.locator('#mbody').innerText(),/Đã hết hạn/);
  await page.getByRole('button',{name:'Phân công công trình',exact:true}).click();await page.selectOption('#cpProject',f.projects.C.id);await page.click('#cpAssign');await page.waitForSelector('dialog[open]');assert.equal(await page.locator('#confirmExpiredAssignment').isEnabled(),false);await page.check('#expiredCertificateAck');assert.equal(await page.locator('#confirmExpiredAssignment').isEnabled(),true);await page.click('#confirmExpiredAssignment');await page.waitForSelector('#modal.show',{state:'hidden'});
  const team=expect(await users.admin.api.get('/project-personnel/project/'+f.projects.C.id+'/team'),200);const row=team.find(x=>x.full_name==='Hồ sơ giao diện GD');assert.ok(row);assert.equal(row.certificates[0].certificate_number,'GD-HS-1');
 });
 uiTest('GD-HS Gợi ý gộp: đọc lý do, xác nhận và Tách lại trên giao diện',async page=>{
  await prepare();const a=expect(await users.admin.api.post('/company-personnel',{full_name:'Gộp giao diện'}),201),b=expect(await users.admin.api.post('/company-personnel',{full_name:'Gộp giao diện'}),201);
  for(const p of [a,b])expect(await users.admin.api.post('/company-personnel/'+p.id+'/certificates',{certificate_type:'GS',certificate_number:'UI-GOP'}),201);
  await login(page,'gd');await page.click('#companyMergeButton');const pair=page.locator('#mbody .card').filter({hasText:'Gộp giao diện'});await pair.waitFor();assert.match(await pair.innerText(),/Trùng tên \+ trùng số chứng chỉ/);await pair.getByRole('button',{name:'Xác nhận gộp',exact:true}).click();await page.getByRole('button',{name:'Tách lại',exact:true}).waitFor();assert.equal(expect(await users.admin.api.get('/company-personnel'),200).filter(x=>x.full_name==='Gộp giao diện').length,1);await page.getByRole('button',{name:'Tách lại',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mbody')?.textContent.includes('Đã tách lại'));assert.equal(expect(await users.admin.api.get('/company-personnel'),200).filter(x=>x.full_name==='Gộp giao diện').length,2);
 });
};
