const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {uiTest,loginViaApi,openPage,BASE}=require('../helpers');
const {createUsers,createProjects,expect}=require('../../lib/roleFixtures');
const ART=path.resolve(__dirname,'../../../../runtime-logs/mobile-nav-screenshots');
const LONG_NAME='Nguyễn Văn Kỹ Sư Giám Sát Công Trình Có Họ Tên Rất Dài — Giám đốc công ty';
let users,fixture;async function prepare(){if(!users){users=await createUsers(BASE,'test.mobile.nav');fixture=await createProjects(users)}return fixture}
async function ready(page){await page.waitForFunction(()=>{const buttons=[...document.querySelectorAll('nav button.mobile-primary')];return buttons.length===4&&buttons.every(b=>b.querySelector('svg use'))&&document.querySelector('nav button[data-page="issues"] .mobile-nav-label');});}
module.exports=()=>{
 for(const width of[390,1440])for(const who of['admin','gd','gst','ks','ql'])uiTest('GD-MNAV nhân sự hợp nhất '+who+' '+width,async page=>{
  const f=await prepare(),manager=['admin','gd'].includes(who);await loginViaApi(page,users[who].username,users[who].password);await page.evaluate(()=>loadQualityPermissions(true));
  assert.equal(await page.locator('nav button[data-page="people"]').evaluate(e=>e.style.display!=='none'),!manager);
  await page.evaluate(async manager=>{goPage(manager?'companyPeople':'people');if(manager)await loadCompanyPersonnel('__company__');else await loadProjectTeamDirectory();},manager);
  const ids=await page.locator('#directoryProject option').evaluateAll(options=>options.map(o=>o.value));assert.equal(ids.includes('__company__'),manager);
  if(manager){assert.equal(await page.locator('#companyAddProfile').isVisible(),true);assert.equal(await page.locator('#companyMergeButton').isVisible(),true);assert.equal(await page.locator('#companyPeople #personnelDirectoryControls').count(),1);}
  else{const allowed=expect(await users[who].api.get('/projects'),200);assert.ok(ids.filter(Boolean).every(id=>allowed.some(p=>p.id===id)));assert.equal((await users[who].api.get('/company-personnel')).status,403);assert.equal(await page.locator('#people #personnelDirectoryControls').count(),1);if(who!=='gst'){const denied=f.projects[who==='ks'?'C':'B'].id;assert.ok(!ids.includes(denied));assert.equal((await users[who].api.get('/project-personnel/project/'+denied+'/team')).status,403);}}
  await page.selectOption('#directoryProject',f.projects.A.id);await page.waitForFunction(()=>!!document.querySelector('#projectTeamDirectory table'));assert.equal(await page.locator('#addPersonButton').isVisible(),manager);
  if(manager){assert.equal(await page.locator('#companyPersonnelTable').isVisible(),false);await page.selectOption('#directoryProject','__company__');await page.waitForSelector('#companyAddProfile',{state:'visible'});await page.evaluate(pid=>{currentProjectId=pid;openProjectSection('people');},f.projects.A.id);await page.waitForFunction(()=>document.getElementById('companyPeople').classList.contains('active')&&document.getElementById('directoryProject').value!=='__company__');}
 },{viewport:{width,height:900}});
 for(const width of[360,390,768])uiTest('GD-MNAV '+width+': 5 mục SVG, chữ rõ, tên dài và menu Thêm',async page=>{
  await loginViaApi(page,'admin');await openPage(page,'projects');await ready(page);
  await page.fill('#projectSearch','001');
  await page.evaluate(async name=>{await loadQualityPermissions(true);const auth=JSON.parse(localStorage.getItem(AUTH_KEY));auth.user.full_name=name;localStorage.setItem(AUTH_KEY,JSON.stringify(auth));renderHeaderUser();},LONG_NAME);
  await ready(page);
  const metrics=await page.evaluate(()=>{
   const visible=e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length;
   const buttons=[...document.querySelectorAll('aside>nav>button,#mobileMoreButton')].filter(visible).sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
   const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:r.width}};
   return{labels:buttons.map(b=>b.id==='mobileMoreButton'?'Thêm':b.dataset.page==='issues'?'Vấn đề':b.querySelector('span').textContent),buttons:buttons.map(b=>{const label=[...b.querySelectorAll('span')].find(visible);return{svg:!!b.querySelector('svg use'),rect:rect(b),label:rect(label),font:parseFloat(getComputedStyle(label).fontSize),line:parseFloat(getComputedStyle(label).lineHeight)}}),header:rect(document.querySelector('header')),user:rect(document.getElementById('hdrUser')),main:rect(document.querySelector('main')),aside:rect(document.querySelector('aside')),docWidth:document.documentElement.scrollWidth,activeColor:getComputedStyle(document.querySelector('nav button[data-page="projects"]')).color,underline:getComputedStyle(document.querySelector('nav button[data-page="projects"]'),'::after').height};
  });
  assert.deepEqual(metrics.labels,['Tổng quan','Công trình','Báo cáo','Vấn đề','Thêm']);assert.ok(metrics.docWidth<=width+1);
  for(const b of metrics.buttons){assert.ok(b.svg&&b.font>=12&&b.rect.height>=44);assert.ok(b.label.height<=b.line*2+1);assert.ok(b.label.left>=b.rect.left&&b.label.right<=b.rect.right+1);}
  assert.ok(metrics.user.bottom<=metrics.header.bottom+1);assert.ok(metrics.main.top>=metrics.header.bottom-1);assert.equal(metrics.underline,'3px');assert.equal(metrics.activeColor,'rgb(21, 94, 239)');
  fs.mkdirSync(ART,{recursive:true});await page.screenshot({path:path.join(ART,'after-'+width+'.png'),fullPage:true});fs.writeFileSync(path.join(ART,'after-'+width+'.json'),JSON.stringify(metrics,null,2));
  await page.click('#mobileMoreButton');await page.waitForSelector('#mobileMoreMenu:not([hidden])');await page.screenshot({path:path.join(ART,'after-'+width+'-more.png'),fullPage:true});
  const choices=await page.locator('#mobileMoreItems button').evaluateAll(bs=>bs.map(b=>b.dataset.mobileTarget));
  assert.ok(choices.includes('docs')&&choices.includes('companyPeople')&&choices.includes('settings')&&choices.includes('trash'));assert.ok(!choices.includes('audit'));assert.ok(!choices.some(p=>['dashboard','projects','reports','issues'].includes(p)));
  await page.click('#mobileMoreItems button[data-mobile-target="docs"]');await page.waitForSelector('#docs.active');await page.waitForFunction(()=>document.getElementById('mobileMoreButton').classList.contains('active'));assert.equal(await page.locator('#mobileMoreButton').getAttribute('aria-expanded'),'false');
  await page.click('#mobileMoreButton');await page.keyboard.press('Escape');assert.equal(await page.locator('#mobileMoreButton').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'mobileMoreButton');
  await page.click('nav button[data-page="reports"]');await page.waitForSelector('#reports.active');await page.waitForFunction(()=>!document.getElementById('mobileMoreButton').classList.contains('active'));assert.deepEqual(page.__console,[]);
 },{viewport:{width,height:width===768?1024:844}});
 for(const who of['admin','gd','gst','ks','ql'])uiTest('GD-MNAV quyền '+who+': mục thêm theo máy chủ, không có API Audit',async page=>{
  await prepare();await loginViaApi(page,users[who].username,users[who].password);await page.evaluate(()=>loadQualityPermissions(true));await ready(page);await page.click('#mobileMoreButton');
  const choices=await page.locator('#mobileMoreItems button').evaluateAll(bs=>bs.map(b=>b.dataset.mobileTarget));
  const manager=['admin','gd'].includes(who);assert.equal(choices.includes('settings'),manager);assert.equal(choices.includes('companyPeople'),manager);assert.equal(choices.includes('trash'),manager);assert.equal(choices.includes('inbox'),manager||['gst','ks'].includes(who));assert.equal(choices.includes('audit'),false);
  assert.equal((await users[who].api.get('/recycle-bin')).status,manager?200:403);
  for(const route of['/audit','/audit-logs'])assert.equal((await users[who].api.get(route)).status,404,'Chưa có API đọc Audit; không tự suy quyền');
 },{viewport:{width:390,height:844}});
 uiTest('GD-MNAV quyền Xóa: menu đang mở cập nhật khi cấp/thu hồi quyền công trình',async page=>{
  const f=await prepare(),member=f.members.A.ks;await loginViaApi(page,users.ks.username,users.ks.password);await page.evaluate(()=>loadQualityPermissions(true));await ready(page);await page.click('#mobileMoreButton');
  assert.equal(await page.locator('#mobileMoreItems button[data-mobile-target="trash"]').count(),0);
  expect(await users.admin.api.put('/project-members/'+member.id,{access_permissions:['VIEW','CREATE','DELETE']}),200);await page.evaluate(()=>loadQualityPermissions(true));await page.waitForSelector('#mobileMoreItems button[data-mobile-target="trash"]');assert.equal((await users.ks.api.get('/recycle-bin')).status,200);
  expect(await users.admin.api.put('/project-members/'+member.id,{access_permissions:['VIEW','CREATE']}),200);await page.evaluate(()=>loadQualityPermissions(true));await page.waitForFunction(()=>!document.querySelector('#mobileMoreItems button[data-mobile-target="trash"]'));assert.equal((await users.ks.api.get('/recycle-bin')).status,403);
 },{viewport:{width:390,height:844}});
 uiTest('GD-MNAV PC và ngưỡng 900: thanh bên/đầu trang giữ bố cục cũ',async page=>{
  await loginViaApi(page,'admin');await openPage(page,'projects');await ready(page);await page.evaluate(async name=>{await loadQualityPermissions(true);const auth=JSON.parse(localStorage.getItem(AUTH_KEY));auth.user.full_name=name;localStorage.setItem(AUTH_KEY,JSON.stringify(auth));renderHeaderUser();},LONG_NAME);
  await page.fill('#projectSearch','001');
  const baseline=path.join(ART,'before-1440.json'),before=fs.existsSync(baseline)?JSON.parse(fs.readFileSync(baseline)):{width:1440,bodyWidth:1440,headerHeight:60,asideWidth:240},metrics=await page.evaluate(()=>({width:innerWidth,bodyWidth:document.documentElement.scrollWidth,headerHeight:document.querySelector('header').getBoundingClientRect().height,asideWidth:document.querySelector('aside').getBoundingClientRect().width}));
  assert.deepEqual(metrics,before);assert.equal(await page.locator('#mobileMoreButton').isVisible(),false);assert.equal(await page.locator('nav button[data-page="docs"]').isVisible(),true);assert.equal(await page.locator('nav button[data-page="audit"]').innerText(),'📋 Nhật ký hệ thống');
  await page.screenshot({path:path.join(ART,'after-1440.png'),fullPage:true});
  await page.setViewportSize({width:900,height:900});assert.equal(await page.locator('#mobileMoreButton').isVisible(),false);assert.equal(await page.locator('aside').evaluate(e=>e.getBoundingClientRect().width),240);
  await page.setViewportSize({width:899,height:900});await page.waitForSelector('#mobileMoreButton',{state:'visible'});await page.click('#mobileMoreButton');await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>document.getElementById('mobileMoreMenu').hidden);assert.equal(await page.locator('#mobileMoreBackdrop').isVisible(),false);
 });
};
