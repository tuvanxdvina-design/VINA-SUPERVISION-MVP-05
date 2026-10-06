db.progressPlans=db.progressPlans||{};
db.pendingInitialProgressPlans=db.pendingInitialProgressPlans||{};
window.addEventListener('load',()=>{void loadQualityPermissions(true)});
window.addEventListener('online',async()=>{updateNet();if(db.sync.length){audit('SYNC','system','',db.sync.length+' mục chờ đồng bộ');save();if(window.syncPendingProjects)await window.syncPendingProjects();if(window.syncPendingDailyLogs)await window.syncPendingDailyLogs();if(window.syncPendingIssues)await window.syncPendingIssues();if(window.syncPendingDocuments)await window.syncPendingDocuments();}});window.addEventListener('offline',updateNet);
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.page==='settings'&&!canManageAssignments())return;currentProjectId=null;document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById(b.dataset.page).classList.add('active');renderAll();if(b.dataset.page==='people'){void loadProjectTeamDirectory()}if(b.dataset.page==='settings'){void loadSettingsProjects()}if(b.dataset.page==='docs'||b.dataset.page==='reports'){void syncDocumentsFromApi().then(()=>{if(typeof renderReports==='function')renderReports()})}});
renderAll();
qualitySelfCheck();
