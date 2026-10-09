db.progressPlans=db.progressPlans||{};
db.pendingInitialProgressPlans=db.pendingInitialProgressPlans||{};
window.addEventListener('load',()=>{void loadQualityPermissions(true)});
let automaticSyncRunning=false;
async function retryPendingWhenConnected(){
 if(automaticSyncRunning||navigator.onLine===false||document.visibilityState==='hidden'||!getAuthToken()||getAuthUser()?.must_change_password)return;
 if(!(db.sync||[]).some(x=>x.status==='PENDING'))return;
 automaticSyncRunning=true;
 try{
  for(const name of ['syncPendingProjects','syncPendingDailyLogs','syncPendingIssues','syncPendingDocuments']){
   if(typeof window[name]==='function')try{await window[name]()}catch(error){console.warn('Chưa đồng bộ được; bản nhập vẫn được giữ:',error.message)}
  }
 }finally{automaticSyncRunning=false;save();void refreshQueuedFileCount()}
}
window.addEventListener('online',()=>{updateNet();if(db.sync.length){audit('SYNC','system','',db.sync.length+' mục chờ đồng bộ');save()}void retryPendingWhenConnected()});window.addEventListener('offline',updateNet);
window.addEventListener('focus',()=>void retryPendingWhenConnected());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void retryPendingWhenConnected()});
window.addEventListener('load',()=>{void retryPendingWhenConnected();setInterval(()=>void retryPendingWhenConnected(),60000)});
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.page==='settings'&&!canManageAssignments())return;currentProjectId=null;document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById(b.dataset.page).classList.add('active');renderAll();if(b.dataset.page==='people'){void loadProjectTeamDirectory()}if(b.dataset.page==='settings'){void loadSettingsProjects()}if(b.dataset.page==='docs'||b.dataset.page==='reports'){void syncDocumentsFromApi().then(()=>{if(typeof renderReports==='function')renderReports()})}});
renderAll();
qualitySelfCheck();
