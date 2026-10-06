// The mobile HTTPS entry point serves the UI and API from one origin.
// Port 8083 is the isolated local launcher for MVP-05.
const API_BASE = window.location.port === '8083'
  ? `${window.location.protocol}//${window.location.hostname}:3004/api`
  : '/api';
const AUTH_KEY = 'vina_supervision_auth';

function getAuthToken() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return auth?.token || '';
  } catch (_) {
    return '';
  }
}

function getAuthUser() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return auth?.user || null;
  } catch (_) {
    return null;
  }
}

function setAuthSession(data) {
  if (!data?.token) {
    throw new Error('API login không trả về token');
  }

  localStorage.setItem(AUTH_KEY, JSON.stringify({
    token: data.token,
    user: data.user || null,
    loggedAt: new Date().toISOString()
  }));

  return data;
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_KEY);
}

async function apiRequest(path, options = {}) {
  const token = getAuthToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  const response = await fetch(API_BASE + path, {
    ...options,
    headers
  });

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      clearAuthSession();
      window.location.reload();
    }
    let message = 'HTTP ' + response.status;
    let code = '';

    try {
      const data = await response.json();
      message = data.error || data.message || message;
      code = data.code || '';
    } catch (_) {}
    // Tài khoản đang dùng mật khẩu tạm: bắt đổi mật khẩu trước khi dùng tiếp
    if (code === 'MUST_CHANGE_PASSWORD' && typeof window.forcePasswordChange === 'function') window.forcePasswordChange();

    const error = new Error(message);
    error.status = response.status;
    error.code = code;
    throw error;
  }

  return response.json();
}

async function apiLogin(username, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  return setAuthSession(data);
}

function mapProjectFromApi(p) {
  return {
    id: p.id,
    rowVersion: p.row_version == null ? null : Number(p.row_version),
    code: p.project_code || p.contract_no || p.code || '',
    name: p.name || '',
    province: p.province ?? p.location ?? '',
    client: p.owner_name || p.client || '',
    contractorName: p.contractor_name || p.contractorName || '',
    address: p.address ?? p.location ?? '',
    progress: Number(p.progress || 0),
    status: p.status || '',
    contractNo: p.contract_no || '',
    contractDate: p.contract_date ? String(p.contract_date).slice(0, 10) : '',
    startDate: p.start_date ? String(p.start_date).slice(0, 10) : '',
    endDate: p.end_date ? String(p.end_date).slice(0, 10) : '',
    contractValue: p.contract_value ?? null,
    contractContent: p.contract_content || p.description || '',
    contractorContractNo: p.contractor_contract_no || '',
    contractorContractDate: p.contractor_contract_date ? String(p.contractor_contract_date).slice(0, 10) : '',
    contractorContractValue: p.contractor_contract_value ?? null,
    contractorContractContent: p.contractor_contract_content || '',
    consultantContractType: p.consultant_contract_type || '',
    consultantPriceType: p.consultant_price_type || '',
    contractDurationDays: p.contract_duration_days == null ? null : Number(p.contract_duration_days),
    contractorContractType: p.contractor_contract_type || '',
    contractorPriceType: p.contractor_price_type || '',
    contractorStartDate: p.contractor_start_date ? String(p.contractor_start_date).slice(0, 10) : '',
    contractorEndDate: p.contractor_end_date ? String(p.contractor_end_date).slice(0, 10) : '',
    contractorDurationDays: p.contractor_duration_days == null ? null : Number(p.contractor_duration_days),
    createdAt: p.created_at || '',
    updatedAt: p.updated_at || '',
    files: (Array.isArray(p.files)?p.files:[]).map(f=>({id:f.id,category:f.category,name:f.file_name,type:f.file_type,size:Number(f.file_size||0),uploadedAt:f.uploaded_at}))
  };
}

async function apiGetProjects() {
  const data = await apiRequest('/projects');

  return Array.isArray(data)
    ? data.map(mapProjectFromApi)
    : [];
}

function mapLocalProjectToApiData(data, id) {
  return {
    id,
    project_code: data.code || data.contractNo,
    contract_no: data.contractNo || data.code,
    name: data.name,
    province: data.province || '',
    address: data.address || '',
    owner_name: data.client || '',
    contractor_name: data.contractorName || '',
    contract_date: data.contractDate || null,
    start_date: data.startDate || null,
    end_date: data.endDate || null,
    contract_value: data.contractValue ?? null,
    contract_content: data.contractContent || '',
    contractor_contract_no: data.contractorContractNo || null,
    contractor_contract_date: data.contractorContractDate || null,
    contractor_contract_value: data.contractorContractValue ?? null,
    contractor_contract_content: data.contractorContractContent || null,
    consultant_contract_type: data.consultantContractType || null,
    consultant_price_type: data.consultantPriceType || null,
    contract_duration_days: data.contractDurationDays ?? null,
    contractor_contract_type: data.contractorContractType || null,
    contractor_price_type: data.contractorPriceType || null,
    contractor_start_date: data.contractorStartDate || null,
    contractor_end_date: data.contractorEndDate || null,
    contractor_duration_days: data.contractorDurationDays ?? null,
    progress: Number(data.progress || 0),
    status: data.status || 'ACTIVE',
    expected_row_version: data.expectedRowVersion ?? data.rowVersion ?? null
  };
}

async function apiCreateProject(data) {
  return apiRequest('/projects', { method: 'POST', body: JSON.stringify(data) });
}

async function apiUpdateProject(id, data) {
  return apiRequest('/projects/' + encodeURIComponent(id), {
    method: 'PATCH', body: JSON.stringify(data)
  });
}

function mapDailyLogFromApi(log) {
  return {
    id: log.id,
    rowVersion: log.row_version == null ? null : Number(log.row_version),
    projectId: log.project_id,
    date: log.log_date_text
      ? log.log_date_text
      : log.log_date ? String(log.log_date).slice(0, 10)
      : '',
    shift: log.shift || 'CA1',
    work: log.work_summary || '',
    weather: log.weather || '',
    contractorUnit: log.contractor_unit || '',
    itemCategory: log.item_category || '',
    technicalStaffCount: Number(log.technical_staff_count || 0),
    recommendation: log.recommendation || '',
    workerItems: Array.isArray(log.worker_items) ? log.worker_items : [],
    machineItems: Array.isArray(log.machine_items) ? log.machine_items : [],
    fileCount: Number(log.file_count || 0),
    workers: Number(log.worker_count || 0),
    machines: Number(log.machine_count || 0),
    progress: Number(log.progress || 0),
    note: log.note || '',
    status: log.status || 'DRAFT',
    version: Number(log.version || 1),
    createdBy: log.created_by_name || log.created_by || '',
    createdById: log.created_by || '',
    canEdit: log.can_edit === true,
    createdAt: log.created_at || '',
    updatedAt: log.updated_at || '',
    submittedAt: log.submitted_at || '',
    approvedBy: log.approved_by_name || log.approved_by || '',
    approvedAt: log.approved_at || '',
    lockedAt: log.locked_at || '',
    lastReview: log.last_review || null,
    photoCount: Number(log.photo_count || 0)
  };
}


function mapDocumentFromApi(doc) {
  let details = doc.details || {};
  if (typeof details === 'string') { try { details = JSON.parse(details); } catch (_) { details = {}; } }
  return {
    id: doc.id, serverId: doc.id,
    rowVersion: doc.row_version == null ? null : Number(doc.row_version), projectId: doc.project_id, code: doc.auto_code || '', type: doc.type || '',
    name: doc.name || '', group: doc.doc_group === 'REPORT' ? 'REPORT' : 'LEGAL', details,
    version: Number(doc.version || 1), status: doc.status || 'DRAFT',
    createdBy: doc.created_by_name || '', createdById: doc.created_by || '', updatedBy: doc.updated_by_name || '',
    createdAt: doc.created_at || '', updatedAt: doc.updated_at || '',
    submittedAt: doc.submitted_at || '', lastReview: doc.last_review || null,
    files: (Array.isArray(doc.files) ? doc.files : []).map(f => ({ id: f.id, category: f.category, name: f.file_name, type: f.file_type, size: Number(f.file_size || 0), uploadedAt: f.uploaded_at }))
  };
}
async function apiGetDocuments(projectId) {
  const data = await apiRequest('/documents?project_id=' + encodeURIComponent(projectId));
  return Array.isArray(data) ? data.map(mapDocumentFromApi) : [];
}

let documentSyncRunning=false;
async function syncPendingDocuments(){
  if(!apiOnline()||documentSyncRunning)return;
  documentSyncRunning=true;
  try{
    for(const item of (db.sync||[]).filter(x=>x.type==='document'&&x.status==='PENDING')){
      try{
        const result=item.savedResult||await apiRequest('/documents/'+encodeURIComponent(item.recordId),{method:'PATCH',body:JSON.stringify(item.payload)});
        item.savedResult=result;
        if(typeof queuedFiles==='function')for(const file of await queuedFiles('document',item.recordId)){
          const response=await fetch(API_BASE+'/documents/'+encodeURIComponent(item.recordId)+'/files?category='+encodeURIComponent(file.category||'Tài liệu')+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file.blob});
          if(!response.ok)throw new Error('Chưa tải được tệp '+file.name+' (HTTP '+response.status+')');
          await removeQueuedFile(file.id);
        }
        upsertLocalDoc(mapDocumentFromApi(await apiRequest('/documents/'+encodeURIComponent(item.recordId))));
        item.status='SYNCED';
      }catch(error){
        item.lastError=error.message;item.lastErrorCode=error.code||'';
        if(error.status===409)item.status='CONFLICT';
      }
    }
    db.sync=db.sync.filter(x=>x.status!=='SYNCED');save();
  }finally{documentSyncRunning=false}
}
window.syncPendingDocuments=syncPendingDocuments;
async function apiGetDailyLogs(projectId, filters = {}) {
  if (!projectId) {
    throw new Error('Thiếu projectId khi lấy nhật ký');
  }

  const params = new URLSearchParams({
    project_id: projectId
  });

  if (filters.status) {
    params.set('status', filters.status);
  }

  if (filters.log_date) {
    params.set('log_date', filters.log_date);
  }

  const data = await apiRequest('/daily-logs?' + params.toString());

  return Array.isArray(data)
    ? data.map(mapDailyLogFromApi)
    : [];
}

window.VINA_API = {
  apiRequest,
  apiLogin,
  getAuthToken,
  getAuthUser,
  setAuthSession,
  clearAuthSession,
  apiGetProjects,
  apiCreateProject,
  apiUpdateProject,
  apiGetDailyLogs,
  apiGetDocuments
};

async function apiCreateDailyLog(data) {
  return apiRequest('/daily-logs', {
    method: 'POST',
    body: JSON.stringify({
      id: data.id,
      project_id: data.projectId,
      log_date: data.date,
      shift: data.shift || null,
      work_summary: data.work,
      weather: data.weather || null,
      worker_count: Number(data.workers || 0),
      machine_count: Number(data.machines || 0),
      note: data.note || null,
      contractor_unit: data.contractorUnit || null,
      item_category: data.itemCategory || null,
      technical_staff_count: data.technicalStaffCount || null,
      recommendation: data.recommendation || null,
      worker_items: Array.isArray(data.workerItems) ? data.workerItems : null,
      machine_items: Array.isArray(data.machineItems) ? data.machineItems : null
    })
  });
}

async function apiUpdateDailyLog(id, data) {
  return apiRequest('/daily-logs/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify({
      shift: data.shift || null,
      work_summary: data.work,
      weather: data.weather || null,
      worker_count: Number(data.workers || 0),
      machine_count: Number(data.machines || 0),
      contractor_unit: data.contractorUnit || null,
      item_category: data.itemCategory || null,
      technical_staff_count: data.technicalStaffCount || null,
      recommendation: data.recommendation || null,
      worker_items: Array.isArray(data.workerItems) ? data.workerItems : null,
      machine_items: Array.isArray(data.machineItems) ? data.machineItems : null,
      note: data.note || null,
      expected_row_version: data.expectedRowVersion ?? data.rowVersion ?? null
    })
  });
}

async function apiSubmitDailyLog(id) {
  return apiRequest('/daily-logs/' + encodeURIComponent(id) + '/submit', {
    method: 'POST'
  });
}

async function apiApproveDailyLog(id) {
  return apiRequest('/daily-logs/' + encodeURIComponent(id) + '/approve', {
    method: 'POST'
  });
}

async function apiRejectDailyLog(id) {
  return apiRequest('/daily-logs/' + encodeURIComponent(id) + '/reject', {
    method: 'POST'
  });
}

async function apiLockDailyLog(id) {
  return apiRequest('/daily-logs/' + encodeURIComponent(id) + '/lock', {
    method: 'POST'
  });
}

async function apiDeleteDailyLog(id) {
  return apiRequest('/daily-logs/' + encodeURIComponent(id), {
    method: 'DELETE'
  });
}

function mapLocalLogToApiData(data) {
  return {
    projectId: data.projectId,
    date: data.date,
    work: data.work || '',
    workers: Number(data.workers || 0),
    machines: Number(data.machines || 0),
    note: data.note || '',
    shift: data.shift || null,
    weather: data.weather || null,
    contractorUnit: data.contractorUnit || null,
    itemCategory: data.itemCategory || null,
    technicalStaffCount: data.technicalStaffCount || null,
    recommendation: data.recommendation || null,
    workerItems: Array.isArray(data.workerItems) ? data.workerItems : null,
    machineItems: Array.isArray(data.machineItems) ? data.machineItems : null,
    expectedRowVersion: data.expectedRowVersion ?? data.rowVersion ?? null
  };
}

let projectSyncRunning = false;
let projectSyncAgain = false;

async function syncPendingProjects() {
  if (!getAuthToken()) return;
  if (projectSyncRunning) {
    projectSyncAgain = true;
    return;
  }

  projectSyncRunning = true;
  try {
    const pending = (Array.isArray(db?.sync) ? db.sync : []).filter(x =>
      x && x.type === 'project' && x.status === 'PENDING'
    );
    if (!pending.length) return;

    for (const item of pending) {
      try {
        const payload = mapLocalProjectToApiData(item.payload || {}, item.recordId);
        if (item.operation === 'CREATE') {
          const result = await apiCreateProject(payload);
          item.savedRowVersion = result.row_version;
        } else if (item.operation === 'UPDATE') {
          if (!item.savedRowVersion) {
            const result = await apiUpdateProject(item.recordId, payload);
            item.savedRowVersion = result.row_version;
          }
        } else {
          item.lastError = 'Unsupported project operation: ' + item.operation;
          continue;
        }
        const localProject=db.projects.find(x=>x.id===item.recordId);if(localProject)localProject.rowVersion=Number(item.savedRowVersion);
        if(typeof syncQueuedProjectFiles==='function')await syncQueuedProjectFiles(item.recordId);
        item.status = 'SYNCED';
        item.syncedAt = new Date().toISOString();
        delete item.lastError;
      } catch (error) {
        item.lastError = error.message;
        item.lastErrorCode = error.code || '';
        if (error.status === 409) item.status = 'CONFLICT';
        item.lastAttemptAt = new Date().toISOString();
        // 400/409: máy chủ từ chối vĩnh viễn (trùng mã/số hợp đồng, dữ liệu sai) — không thử lại mãi,
        // đánh dấu để người dùng sửa; công trình vẫn được giữ trên thiết bị.
        if (error.status === 409 || error.status === 400) item.status = 'CONFLICT';
        console.warn('VINA-SUPERVISION: Không đồng bộ được công trình', item.recordId, error.message);
      }
    }

    db.sync = db.sync.filter(x => x.status !== 'SYNCED');
    try {
      const remoteProjects = await apiGetProjects();
      if (typeof mergeProjectsFromServer === 'function') mergeProjectsFromServer(remoteProjects);
    } catch (error) {
      console.warn('VINA-SUPERVISION: Không tải lại được công trình', error.message);
    }
    save();
  } finally {
    projectSyncRunning = false;
    if (projectSyncAgain) {
      projectSyncAgain = false;
      void syncPendingProjects();
    }
  }
}

let dailyLogSyncRunning = false;

// Tải ảnh (API cũ, ≤5 MB) và tài liệu kèm theo (≤15 MB) của nhật ký lên máy chủ; đánh dấu đã tải để không tải lại,
// rồi bỏ dữ liệu base64 khỏi bộ nhớ trình duyệt.
async function uploadLogAttachments(local, serverId) {
  if (!local || !serverId) return;
  for (const photo of local.photos || []) {
    if (photo.uploaded || !photo.data) continue;
    await apiRequest('/daily-logs/' + encodeURIComponent(serverId) + '/attachments', { method: 'POST', body: JSON.stringify({ file_name: photo.name, data_url: photo.data }) });
    photo.uploaded = true; delete photo.data;
  }
  for (const doc of local.documents || []) {
    if (doc.uploaded || !doc.data) continue;
    const blob = await (await fetch(doc.data)).blob();
    const res = await fetch(API_BASE + '/daily-logs/' + encodeURIComponent(serverId) + '/files?name=' + encodeURIComponent(doc.name || 'tai-lieu'), { method: 'POST', headers: { Authorization: 'Bearer ' + getAuthToken(), 'Content-Type': doc.type || blob.type || 'application/octet-stream' }, body: blob });
    if (!res.ok) { let m = 'HTTP ' + res.status; try { m = (await res.json()).error || m; } catch (_) {} throw new Error('Tài liệu "' + doc.name + '": ' + m); }
    doc.uploaded = true; delete doc.data;
  }
  if(typeof queuedFiles==='function'){
    const pending=await queuedFiles('daily_log',local.id);
    for(const file of pending){
      const route=file.kind==='PHOTO'?'/attachments-binary':'/files';
      const res=await fetch(API_BASE+'/daily-logs/'+encodeURIComponent(serverId)+route+'?name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file.blob});
      if(!res.ok){let m='HTTP '+res.status;try{m=(await res.json()).error||m}catch(_){}throw new Error('Tệp "'+file.name+'": '+m)}
      await removeQueuedFile(file.id);
    }
  }
}

async function syncQueuedProjectFiles(projectId){
 if(typeof queuedFiles!=='function')return;const pending=await queuedFiles('project',projectId);
 for(const file of pending.filter(f=>f.kind!=='PROGRESS_BASELINE')){
  const res=await fetch(API_BASE+'/projects/'+encodeURIComponent(projectId)+'/files?category='+encodeURIComponent(file.category)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file.blob});
  if(!res.ok){let m='HTTP '+res.status;try{m=(await res.json()).error||m}catch(_){}throw new Error('Tệp "'+file.name+'": '+m)}
  await removeQueuedFile(file.id);
 }
}
// Bản ký/tài liệu đính kèm văn bản chất lượng đã hàng đợi (IndexedDB, chờ có serverId) — tải lên issue_files.
async function syncQueuedIssueFiles(issueId){
 if(typeof queuedFiles!=='function')return;const pending=await queuedFiles('issue',issueId);
 for(const file of pending){
  const res=await fetch(API_BASE+'/issues/'+encodeURIComponent(issueId)+'/files?name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:'Bearer '+getAuthToken(),'Content-Type':file.type||'application/octet-stream'},body:file.blob});
  if(!res.ok){let m='HTTP '+res.status;try{m=(await res.json()).error||m}catch(_){}throw new Error('Tệp "'+file.name+'": '+m)}
  await removeQueuedFile(file.id);
 }
}

async function syncPendingDailyLogs() {
  if (!getAuthToken()) return;
  await syncPendingProjects();
  if (dailyLogSyncRunning) {
    console.log('VINA-SUPERVISION: Bo qua dong bo trung lap dang chay');
    return;
  }

  dailyLogSyncRunning = true;

  try {
    const queue = Array.isArray(db?.sync) ? db.sync : [];
    const pending = queue.filter(x =>
      x &&
      x.status === 'PENDING' &&
      x.type === 'daily_log'
    );

    if (!pending.length) return;

    console.log(
      'VINA-SUPERVISION: Bat dau dong bo nhat ky:',
      pending.length
    );

    for (const item of pending) {
      try {
        const projectId = item.payload?.projectId;
        if (db.sync.some(x => x.type === 'project' && x.status === 'PENDING' && x.recordId === projectId)) {
          item.lastError = 'Công trình chưa đồng bộ';
          continue;
        }
        let result;

        if (item.operation === 'CREATE') {
          result = await apiCreateDailyLog(
            { ...mapLocalLogToApiData(item.payload || {}), id: item.recordId }
          );

          const local = db.logs.find(x => x.id === item.recordId);

          if (local && result?.id) {
            local.serverId = result.id;
            local.rowVersion = Number(result.row_version);
            local.status = result.status || local.status;
            local.version = Number(
              result.version || local.version || 1
            );
            local.createdAt =
              result.created_at || local.createdAt;
            local.updatedAt =
              result.updated_at || local.updatedAt;
          }
          await uploadLogAttachments(local, result.id);
          if (local) local.photoCount = (local.photos || []).length;
        }

        else if (item.operation === 'UPDATE') {
          const local = db.logs.find(x => x.id === item.recordId);

          if (local?.serverId) {
            result = item.savedResult || await apiUpdateDailyLog(
              local.serverId,
              mapLocalLogToApiData(item.payload || local)
            );
            item.savedResult = result;

            if (result) {
              local.rowVersion = Number(result.row_version);
              await uploadLogAttachments(local, local.serverId);
              local.status = result.status || local.status;
              local.version = Number(
                result.version || local.version || 1
              );
              local.updatedAt =
                result.updated_at || local.updatedAt;
            }
          } else {
            console.warn(
              'VINA-SUPERVISION: Bo qua UPDATE chua co serverId:',
              item.recordId
            );
            continue;
          }
        }

        else {
          console.warn(
            'VINA-SUPERVISION: Chua ho tro operation:',
            item.operation
          );
          continue;
        }

        item.status = 'SYNCED';
        item.syncedAt = new Date().toISOString();
        item.serverResult = result || null;

        console.log(
          'VINA-SUPERVISION: Da dong bo nhat ky:',
          item.recordId,
          item.operation
        );

      } catch (error) {
        // 409 = trùng ngày + ca trên máy chủ: không thử lại mãi, đánh dấu để người dùng đổi ca.
        item.status = error.status === 409 ? 'CONFLICT' : 'PENDING';
        item.lastError = error.message;
        item.lastErrorCode = error.code || '';
        if (error.status === 409) item.status = 'CONFLICT';
        item.lastAttemptAt = new Date().toISOString();

        console.warn(
          'VINA-SUPERVISION: Dong bo nhat ky that bai:',
          item.recordId,
          error.message
        );
      }
    }

    db.sync = db.sync.filter(x => x.status !== 'SYNCED');
    save();

    console.log(
      'VINA-SUPERVISION: Con lai hang doi:',
      db.sync.filter(x => x.status === 'PENDING').length
    );

  } finally {
    dailyLogSyncRunning = false;
  }
}

function mapIssueFromApi(issue) {
  let details = issue.details || {};
  if (typeof details === 'string') { try { details = JSON.parse(details); } catch (_) { details = {}; } }
  const status = issue.status === 'RESOLVED' ? 'CLOSED' : (details.status || 'OPEN');
  return {
    id: issue.id,
    serverId: issue.id,
    ...details,
    rowVersion: issue.row_version == null ? null : Number(issue.row_version),
    code: issue.issue_code || ('VĐ-' + issue.id.slice(0, 8)),
    projectId: issue.project_id,
    title: issue.title || details.title || '',
    detail: issue.description || details.detail || '',
    priority: issue.severity || details.priority || '',
    due: issue.due_date_text || details.due || (issue.due_date ? String(issue.due_date).slice(0, 10) : ''),
    status,
    createdAt: issue.created_at || details.createdAt || '',
    closedAt: issue.resolved_at || details.closedAt || '',
    createdBy: issue.created_by_name || details.createdBy || issue.created_by || '',
    createdById: issue.created_by || details.createdById || '',
    sourceType: issue.source_type || details.sourceType || issue.sourceType || ''
  };
}

async function apiGetIssues(projectId) {
  return apiRequest('/issues?project_id=' + encodeURIComponent(projectId));
}

let issueSyncRunning = false;
function issueDetailsPayload(x = {}) {
  const details = { ...x };
  if (details.signedFile?.data) details.signedFile = { ...details.signedFile, data: undefined, storedOnDeviceOnly: true };
  delete details.serverId;
  delete details.createdById;
  return details;
}
async function syncPendingIssues() {
  if (!apiOnline()) return;
  if (issueSyncRunning) return;
  issueSyncRunning = true;
  try {
    await syncPendingProjects();
    const pending = (db.sync || []).filter(x => x.type === 'issue' && x.status === 'PENDING');
    for (const item of pending) {
      try {
        if (db.sync.some(x => x.type === 'project' && x.status === 'PENDING' && x.recordId === item.payload?.projectId)) continue;
        let result;
        const x = item.payload || {};
        if (item.operation === 'CREATE') {
          result = await apiRequest('/issues', { method: 'POST', body: JSON.stringify({
            id: item.recordId, project_id: x.projectId, issue_code: x.code,
            title: x.title, description: x.detail, severity: x.priority, due_date: x.due || null, source_type: x.sourceType || null,
            details: issueDetailsPayload({ ...x, id: item.recordId })
          }) });
        } else if (item.operation === 'UPDATE' && x.reopenedAt) {
          result = item.savedResult || await apiRequest('/issues/' + encodeURIComponent(item.recordId) + '/reopen', { method: 'POST', body: JSON.stringify({expected_row_version:x.expectedRowVersion??x.rowVersion??null}) });
        } else if (item.operation === 'UPDATE') {
          result = item.savedResult || await apiRequest('/issues/' + encodeURIComponent(item.recordId), {
            method: 'PATCH', body: JSON.stringify({
              issue_code: x.code, title: x.title, description: x.detail, severity: x.priority,
              due_date: x.due || null, source_type: x.sourceType || null, details: issueDetailsPayload(x),
              expected_row_version: x.expectedRowVersion ?? x.rowVersion ?? null
            })
          });
        } else {
          item.lastError = 'Thao tác văn bản chất lượng chưa được hỗ trợ';
          continue;
        }
        const local = db.issues.find(v => v.id === item.recordId);
        item.savedResult = result;
        if (String(x.status || '').toUpperCase() === 'CLOSED' && !x.reopenedAt) {
          result = await apiRequest('/issues/' + encodeURIComponent(item.recordId) + '/resolve', {method:'POST',body:JSON.stringify({resolution_note:'Đã đóng trên thiết bị',expected_row_version:result.row_version})});
          item.savedResult = result;
        }
        if (local && result?.id) { local.serverId = result.id; local.rowVersion = Number(result.row_version); delete local.reopenedAt; }
        if (result?.id) await syncQueuedIssueFiles(result.id);
        item.status = 'SYNCED';
        delete item.lastError;
      } catch (error) {
        item.lastError = error.message;
        item.lastErrorCode = error.code || '';
        if (error.status === 409) item.status = 'CONFLICT';
        item.lastAttemptAt = new Date().toISOString();
      }
    }
    db.sync = db.sync.filter(x => x.status !== 'SYNCED');
    save();
  } finally {
    issueSyncRunning = false;
  }
}

async function syncIssuesFromApi() {
  if (!apiOnline()) return;
  const pending = new Set((db.sync || []).filter(x => x.type === 'issue' && ['PENDING','CONFLICT'].includes(x.status)).map(x => x.recordId));
  for (const project of db.projects || []) {
    try {
      const issues = await apiGetIssues(project.id);
      for (const issue of issues) {
        const mapped = mapIssueFromApi(issue);
        const index = db.issues.findIndex(x => x.id === issue.id || x.serverId === issue.id);
        if (index < 0) db.issues.push(mapped);
        else if (!pending.has(db.issues[index].id)) db.issues[index] = { ...db.issues[index], ...mapped };
      }
    } catch (error) {
      console.warn('Không tải được vấn đề công trình:', project.id, error.message);
    }
  }
  save();
}
Object.assign(window.VINA_API, {
  syncPendingProjects,
  apiCreateDailyLog,
  apiUpdateDailyLog,
  apiSubmitDailyLog,
  apiApproveDailyLog,
  apiRejectDailyLog,
  apiLockDailyLog,
  apiDeleteDailyLog,
  syncPendingDailyLogs,
  apiGetIssues,
  syncPendingIssues,
  syncIssuesFromApi
});

window.syncPendingDailyLogs = syncPendingDailyLogs;
window.syncPendingProjects = syncPendingProjects;
window.apiGetDocuments = apiGetDocuments;
window.mapDocumentFromApi = mapDocumentFromApi;
window.syncPendingIssues = syncPendingIssues;
window.syncIssuesFromApi = syncIssuesFromApi;
