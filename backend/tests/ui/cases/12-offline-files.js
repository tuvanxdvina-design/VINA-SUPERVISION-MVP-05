const assert = require('node:assert/strict');
const { uiTest, loginViaApi, apiAs, tokenOf } = require('../helpers');

module.exports = function register() {
  uiTest('GD-V6-double-save hai lần Lưu liên tiếp không nhân đôi ảnh chờ',async page=>{
    await loginViaApi(page,'thanhb');await page.waitForFunction(()=>canEditDailyLog()&&logProjectsForCreate().length>0);
    await page.context().setOffline(true);await page.evaluate(()=>openLog());await page.fill('#ldate','2020-03-11');await page.fill('#lwork','Double save');await page.evaluate(()=>saveLog('',false));
    const id=await page.evaluate(()=>db.logs.find(x=>x.work==='Double save').id);await page.evaluate(id=>openLog(id),id);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=','base64');
    await page.locator('#lphotos').setInputFiles(['one.png','two.png'].map(name=>({name,mimeType:'image/png',buffer:png})));
    await page.evaluate(id=>Promise.all([saveLog(id,false),saveLog(id,false)]),id);
    assert.equal(await page.evaluate(id=>queuedFileCount('daily_log',id),id),2);
    assert.equal(await page.evaluate(()=>db.logs.filter(x=>x.work==='Double save').length),1);
  },{viewport:{width:390,height:844}});
  uiTest('GD-V6-double-save thử Lưu lại sau lỗi mạng không xếp lại ảnh đã giữ',async page=>{
    await loginViaApi(page,'thanhb');await page.waitForFunction(()=>canEditDailyLog()&&logProjectsForCreate().length>0);
    await page.context().setOffline(true);await page.evaluate(()=>openLog());await page.fill('#ldate','2020-03-12');await page.fill('#lwork','Retry save');await page.evaluate(()=>saveLog('',false));
    const id=await page.evaluate(()=>db.logs.find(x=>x.work==='Retry save').id);await page.evaluate(id=>openLog(id),id);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=','base64');
    await page.locator('#lphotos').setInputFiles(['one.png','two.png'].map(name=>({name,mimeType:'image/png',buffer:png})));
    await page.evaluate(()=>{window.syncPendingDailyLogs=async()=>{for(const x of db.sync)x.lastError='Failed to fetch'};window.apiOnline=()=>true});
    await page.evaluate(id=>saveLog(id,false),id);await page.waitForFunction(()=>document.querySelectorAll('#lSavedPhotos img').length===2);
    assert.equal(await page.evaluate(()=>logPhotoPicks.length),0);await page.fill('#lwork','Retry save edited');await page.evaluate(id=>saveLog(id,false),id);
    assert.equal(await page.evaluate(id=>queuedFileCount('daily_log',id),id),2);
    assert.equal(await page.evaluate(()=>db.logs.find(x=>x.work==='Retry save edited')?.work),'Retry save edited');
  },{viewport:{width:390,height:844}});
  uiTest('GD-V6-server-photos sửa báo cáo thấy ảnh máy chủ, phản hồi muộn không mất nội dung đang sửa',async page=>{
    await loginViaApi(page,'thanhb');await page.waitForFunction(()=>canEditDailyLog()&&logProjectsForCreate().length>0);
    const id=await page.evaluate(()=>{const id=crypto.randomUUID(),me=getAuthUser();db.logs.push({id,serverId:id,projectId:logProjectsForCreate()[0].id,date:'2020-03-10',shift:'CA3',work:'Server photos',createdById:me.id,status:'DRAFT',rowVersion:1,photoCount:2,photos:[]});return id});
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=';
    await page.route('**/api/daily-logs/'+id+'/attachments',async route=>{await new Promise(r=>setTimeout(r,250));await route.fulfill({json:[{id:'p1',file_name:'server-one.png'},{id:'p2',file_name:'server-two.png'}]})});
    await page.route('**/api/daily-logs/'+id+'/attachments/*',route=>route.fulfill({json:{data_url:png}}));
    await page.evaluate(id=>openLog(id),id);await page.fill('#lwork','Keep unsaved edits');
    await page.waitForFunction(()=>document.querySelectorAll('#lServerPhotos img').length===2);
    assert.equal(await page.locator('#lwork').inputValue(),'Keep unsaved edits');
    await page.locator('#lServerPhotos button').first().click();await page.waitForFunction(()=>document.querySelector('#logPhotoViewer img')?.naturalWidth>0);
    await page.evaluate(()=>document.getElementById('logPhotoViewer').close());
    assert.equal(await page.evaluate(id=>queuedFileCount('daily_log',id),id),0);
    await page.unroute('**/api/daily-logs/'+id+'/attachments');await page.route('**/api/daily-logs/'+id+'/attachments',route=>route.abort());
    await page.evaluate(id=>openLog(id),id);await page.waitForFunction(()=>document.getElementById('lServerPhotos')?.textContent.includes('Chưa tải được'));
    assert.equal(await page.locator('#lwork').inputValue(),'Server photos');
  },{viewport:{width:390,height:844}});
  uiTest('GD-V6-saved-photos sửa nháp offline vẫn xem đủ ảnh đã lưu, lưu lại không nhân đôi',async page=>{
    await loginViaApi(page,'thanhb');await page.waitForFunction(()=>canEditDailyLog()&&logProjectsForCreate().length>0);
    await page.context().setOffline(true);await page.evaluate(()=>openLog());
    await page.fill('#ldate','2020-03-09');await page.fill('#lwork','Offline saved photos');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=','base64');
    await page.locator('#lphotos').setInputFiles(['one.png','two.png'].map(name=>({name,mimeType:'image/png',buffer:png})));
    await page.evaluate(()=>saveLog('',false));const id=await page.evaluate(()=>db.logs.find(x=>x.work==='Offline saved photos').id);
    await page.evaluate(id=>openLog(id),id);await page.waitForFunction(()=>document.querySelectorAll('#lSavedPhotos img').length===2);
    assert.equal(await page.evaluate(()=>logPhotoPicks.length),0);
    await page.locator('#lSavedPhotos button').first().click();await page.waitForFunction(()=>document.querySelector('#logPhotoViewer img')?.naturalWidth>0);
    await page.evaluate(()=>document.getElementById('logPhotoViewer').close());
    await page.fill('#lwork','Offline saved photos edited');await page.evaluate(id=>saveLog(id,false),id);
    assert.equal(await page.evaluate(id=>queuedFileCount('daily_log',id),id),2);
    await page.route('**/api/daily-logs',route=>route.abort());await page.context().setOffline(false);await page.reload();await page.context().setOffline(true);
    await page.waitForFunction(()=>canEditDailyLog());await page.evaluate(id=>openLog(id),id);
    await page.waitForFunction(()=>document.querySelectorAll('#lSavedPhotos img').length===2);
    assert.equal(await page.evaluate(id=>queuedFileCount('daily_log',id),id),2);
  },{viewport:{width:390,height:844}});
  uiTest('GD-V6-camera nút chụp ảnh dùng camera sau, ảnh chụp liên tiếp và ảnh có sẵn được cộng dồn',async page=>{
    await loginViaApi(page,'thanhb');await page.waitForFunction(()=>canEditDailyLog()&&logProjectsForCreate().length>0);await page.evaluate(()=>openLog());
    assert.equal(await page.locator('#lcamera').getAttribute('capture'),'environment');
    assert.equal(await page.locator('#lcamera').getAttribute('multiple'),null);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=','base64');
    for(const name of ['camera-1.png','camera-2.png']){const chooser=page.waitForEvent('filechooser');await page.locator('#logCameraButton').click();const c=await chooser;assert.equal(c.isMultiple(),false);await c.setFiles({name,mimeType:'image/png',buffer:png})}
    const chooser=page.waitForEvent('filechooser');await page.locator('#logPhotoLibraryButton').click();const c=await chooser;assert.equal(c.isMultiple(),true);await c.setFiles({name:'album.png',mimeType:'image/png',buffer:png});
    assert.deepEqual(await page.evaluate(()=>logPhotoPicks.map(x=>x.name)),['camera-1.png','camera-2.png','album.png']);
    assert.equal(await page.locator('#lcamera').inputValue(),'');
  },{viewport:{width:390,height:844}});

  uiTest('GD-V6-order đọc hàng đợi cũ theo thời gian và giữ thứ tự các lần chọn tiếp',async page=>{
    await page.evaluate(async()=>{
      const d=await offlineFileDb();await new Promise((ok,no)=>{const t=d.transaction('files','readwrite'),s=t.objectStore('files');s.put({id:'z-legacy',owner:'test:ordered',name:'old-first',createdAt:'2020-01-01T00:00:00Z'});s.put({id:'a-legacy',owner:'test:ordered',name:'old-second',createdAt:'2020-01-01T00:00:01Z'});t.oncomplete=ok;t.onerror=()=>no(t.error)});d.close();
      await queueOfflineFiles('test','ordered',[{file:new File(['1'],'new-first'),kind:'DOCUMENT'},{file:new File(['2'],'new-second'),kind:'DOCUMENT'}]);
      await queueOfflineFiles('test','ordered',[{file:new File(['3'],'new-third'),kind:'DOCUMENT'}]);
    });
    const names=await page.evaluate(async()=>{const rows=await queuedFiles('test','ordered');for(const r of rows)await removeQueuedFile(r.id);return rows.map(x=>x.name)});
    assert.deepEqual(names,['old-first','old-second','new-first','new-second','new-third']);
  });

  uiTest('GD-V6-retry sau lỗi kết nối tự gửi 25 ảnh ở phút kế tiếp, giữ bản xung đột', async page => {
    await page.clock.install();await loginViaApi(page,'admin');
    await page.evaluate(()=>syncDailyLogsFromApi());
    let posts=0,available=false,successfulPosts=0;
    await page.route('**/api/daily-logs',async route=>{if(route.request().method()==='POST'){posts++;if(!available)return route.abort('failed');successfulPosts++}await route.continue()});
    const id=await page.evaluate(async()=>{
      const pid=db.projects[0].id,recordId=crypto.randomUUID();
      const payload={projectId:pid,date:'2020-03-06',shift:'CA3',work:'V6 retry 25',status:'DRAFT',photos:[],documents:[]};
      db.logs.push({id:recordId,...payload});queueSync('daily_log',recordId,'CREATE',payload);
      db.sync.push({id:'keep-conflict',recordId:'keep-conflict',type:'daily_log',status:'CONFLICT',operation:'UPDATE',payload:{work:'Do not overwrite'}});
      const entries=[];
      for(let i=0;i<25;i++){const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='rgb('+i*9+',40,70)';x.fillRect(0,0,64,64);const blob=await new Promise(r=>c.toBlob(r,'image/png'));entries.push({kind:'PHOTO',file:new File([blob],'retry-'+i+'.png',{type:'image/png'})})}
      await queueOfflineFiles('daily_log',recordId,entries);persistLocal();await syncPendingDailyLogs();return recordId;
    });
    await page.waitForFunction(id=>!!db.sync.find(x=>x.recordId===id)?.lastAttemptAt&&!dailyLogSyncRunning&&!automaticSyncRunning,id);
    assert.ok(posts>=1);
    assert.equal(await page.evaluate(id=>db.sync.find(x=>x.recordId===id).status,id),'PENDING');
    assert.equal(await page.evaluate(()=>totalQueuedFileCount()),25);
    available=true;await page.clock.fastForward(60000);
    await page.waitForFunction(id=>db.logs.find(x=>x.id===id)?.serverId===id&&!db.sync.some(x=>x.recordId===id),id);
    assert.equal(successfulPosts,1);
    assert.equal(await page.evaluate(()=>totalQueuedFileCount()),0);
    assert.equal(await page.evaluate(()=>db.sync.find(x=>x.id==='keep-conflict').payload.work),'Do not overwrite');
    assert.equal(await page.evaluate(()=>db.sync.find(x=>x.id==='keep-conflict').status),'CONFLICT');
    const api=apiAs(await tokenOf('admin'));const files=await api.get('/daily-logs/'+id+'/attachments');assert.equal(files.status,200);assert.equal(files.body.length,25);assert.equal(new Set(files.body.map(x=>x.file_name)).size,25);assert.deepEqual(files.body.map(x=>x.file_name),Array.from({length:25},(_,i)=>'retry-'+i+'.png'));
  });

  uiTest('GD-V6-retry quay về ứng dụng tự thử lại; yêu cầu treo có hạn chờ',async page=>{
    await loginViaApi(page,'admin');await page.evaluate(()=>syncDailyLogsFromApi());
    let posts=0,available=false,successfulPosts=0;
    await page.route('**/api/daily-logs',async route=>{if(route.request().method()==='POST'){posts++;if(!available)return route.abort('failed');successfulPosts++}await route.continue()});
    const id=await page.evaluate(async()=>{const id=crypto.randomUUID(),payload={projectId:db.projects[0].id,date:'2020-03-07',shift:'CA3',work:'V6 focus retry',status:'DRAFT',photos:[],documents:[]};db.logs.push({id,...payload});queueSync('daily_log',id,'CREATE',payload);persistLocal();await syncPendingDailyLogs();return id});
    await page.waitForFunction(id=>!!db.sync.find(x=>x.recordId===id)?.lastAttemptAt&&!dailyLogSyncRunning&&!automaticSyncRunning,id);assert.ok(posts>=1);
    available=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(id=>db.logs.find(x=>x.id===id)?.serverId===id&&!db.sync.some(x=>x.recordId===id),id);assert.equal(successfulPosts,1);
    await page.route('**/api/v6-hang',async route=>{await new Promise(r=>setTimeout(r,1000));try{await route.abort()}catch(_){}});
    const error=await page.evaluate(async()=>{try{await fetchWithDeadline('/api/v6-hang',{},100);return ''}catch(e){return e.code}});assert.equal(error,'NETWORK_TIMEOUT');
  });

  uiTest('GD-V6-photo màn hình điện thoại mở ảnh lớn, thu về và đóng giữ thư viện', async page => {
    await page.setViewportSize({width:390,height:844});
    await loginViaApi(page,'thanhb');
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=';
    await page.evaluate(image=>showLogPhotos('local',{id:'',photos:[{name:'Ảnh thử.png',data:image}]}),image);
    await page.locator('#photoGallery button').click();
    const viewer=page.locator('#logPhotoViewer');await viewer.waitFor({state:'visible'});
    const box=await viewer.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);
    await viewer.locator('img').evaluate(img=>img.decode());
    await viewer.getByRole('button',{name:'Phóng to',exact:true}).click();
    await viewer.getByRole('button',{name:'Thu về',exact:true}).click();
    assert.equal(await viewer.locator('img').evaluate(img=>img.style.maxWidth),'100%');
    await viewer.getByRole('button',{name:'Đóng ảnh',exact:true}).click();
    await viewer.waitFor({state:'detached'});assert.equal(await page.locator('#photoGallery img').getAttribute('src'),image);
  });

  uiTest('GD-V6-fast mở báo cáo offline không gọi mạng, giữ gói thầu đã lưu sau tải lại', async page => {
    await loginViaApi(page, 'thanhb');
    await page.waitForFunction(() => canEditDailyLog()&&logProjectsForCreate().length>0);
    await page.evaluate(() => {
      const pid=logProjectsForCreate()[0].id;
      db.biddingPackagesCache={[pid]:[{id:'cached-package',name:'Gói đã lưu',contractors:[{name:'Nhà thầu đã lưu',items:[{name:'Hạng mục đã lưu'}]}]}]};
      db.teamCache={[pid]:{rows:[{is_me:true,bidding_package_id:'cached-package'}]}};
      persistLocal();
    });
    await page.reload();
    await page.waitForFunction(() => canEditDailyLog()&&logProjectsForCreate().length>0);
    await page.context().setOffline(true);
    let networkCalls=0;
    await page.route('**/api/bidding-packages?**', async route => {networkCalls++;await route.abort()});
    await page.route('**/api/project-personnel/**/team', async route => {networkCalls++;await route.abort()});
    const elapsed=await page.evaluate(async()=>{const start=performance.now();await openLog();return performance.now()-start});
    assert.ok(elapsed<1000,'Mở offline quá chậm: '+elapsed+'ms');
    assert.equal(networkCalls,0);
    assert.equal(await page.locator('#lcontractorunit').inputValue(),'Nhà thầu đã lưu');
    assert.equal(await page.locator('#litemcategory').inputValue(),'Hạng mục đã lưu');
  });

  for(const stalled of ['packages','team'])uiTest('GD-V6-fast mạng treo tại '+stalled+' vẫn mở được báo cáo', async page => {
    await loginViaApi(page,'thanhb');
    await page.waitForFunction(() => canEditDailyLog()&&logProjectsForCreate().length>0);
    await page.evaluate(stalled=>{
      biddingPackagesByProject={};db.biddingPackagesCache={};
      if(stalled==='team')loadBiddingPackages=async()=>[{id:'test-package',contractors:[]}];
    },stalled);
    const pattern=stalled==='packages'?'**/api/bidding-packages?**':'**/api/project-personnel/**/team';
    let requested=false;
    await page.route(pattern,async route=>{requested=true;await new Promise(resolve=>setTimeout(resolve,3000));try{await route.abort()}catch(_){}});
    const elapsed=await page.evaluate(async()=>{const start=performance.now();await openLog();return performance.now()-start});
    assert.equal(requested,true,'Phải thực sự đi qua yêu cầu mạng bị treo');
    assert.ok(elapsed<2300,'Màn hình chờ quá lâu: '+elapsed+'ms');
    await page.locator('#lwork').fill('Bản nhập giữ nguyên');
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#lwork').inputValue(),'Bản nhập giữ nguyên');
  });

  uiTest('GD-15 ngoại tuyến: tệp chờ nằm trong IndexedDB, không làm đầy localStorage', async page => {
    const result = await page.evaluate(async () => {
      const marker = 'VINA_OFFLINE_FILE_' + crypto.randomUUID();
      const file = new File([marker], 'bien-ban.txt', { type: 'text/plain' });
      const [id] = await queueOfflineFiles('test', 'owner-1', [{ file, kind: 'DOCUMENT', category: 'TEST' }]);
      const rows = await queuedFiles('test', 'owner-1');
      let localContainsFile = false;
      for (let i = 0; i < localStorage.length; i++) if ((localStorage.getItem(localStorage.key(i)) || '').includes(marker)) localContainsFile = true;
      const text = await rows[0].blob.text();
      await removeQueuedFile(id);
      return { count: rows.length, textMatches: text === marker, localContainsFile, afterRemove: await queuedFileCount('test', 'owner-1') };
    });
    assert.deepEqual(result, { count: 1, textMatches: true, localContainsFile: false, afterRemove: 0 });
    assert.deepEqual(page.__console, []);
  });
};
