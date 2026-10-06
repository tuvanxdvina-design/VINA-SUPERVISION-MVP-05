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
    : target.type === 'daily_log' ? { project_id: pid, log_date: '2026-10-06', shift: 'OCC-' + suffix, work_summary: 'Gốc' }
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
  }
};
