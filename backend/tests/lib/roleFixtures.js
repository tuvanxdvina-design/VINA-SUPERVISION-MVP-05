// Dữ liệu giả lập được tạo qua API trên DB thử riêng, không dùng tài khoản thật.
const assert = require('node:assert/strict');
let sequence = 0;
const PASSWORD = 'Role-test-2026!';
function client(base, token) {
  async function call(method, path, body, binaryType) {
    const binary = Buffer.isBuffer(body);
    const res = await fetch(base + '/api' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': binary ? binaryType || 'text/plain' : 'application/json' } : {}) },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body)
    });
    const json = (res.headers.get('content-type') || '').includes('json');
    return { status: res.status, body: json ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }
  return { call, get: p => call('GET', p), post: (p,b) => call('POST',p,b),
    put: (p,b) => call('PUT',p,b), patch: (p,b) => call('PATCH',p,b), del: (p,b) => call('DELETE',p,b),
    upload: (p,b,type) => call('POST',p,b,type) };
}
function expect(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
async function createUsers(base, prefix) {
  const seed = expect(await client(base).post('/auth/login', { username: 'admin', password: 'demo' }), 200);
  const admin = client(base, seed.token), users = {};
  for (const [who, role] of Object.entries({ admin:'ADMIN', gd:'DIRECTOR', ql:'MANAGER', gst:'TVGS_LEAD', ks:'ENGINEER' })) {
    const username = prefix + '.' + who;
    const user = expect(await admin.post('/users', { username, password: PASSWORD, full_name: 'Thử quyền ' + who, role_name: role }), 201);
    const login = expect(await client(base).post('/auth/login', { username, password: PASSWORD }), 200);
    const temporary = client(base, login.token);
    expect(await temporary.post('/auth/change-password', { old_password: PASSWORD, new_password: PASSWORD + 'new' }), 200);
    const final = expect(await client(base).post('/auth/login', { username, password: PASSWORD + 'new' }), 200);
    users[who] = { ...user, username, password: PASSWORD + 'new', token: final.token, api: client(base, final.token) };
  }
  return users;
}
async function createProjects(users) {
  const suffix = ++sequence, projects = {}, members = {};
  for (const name of ['A','B','C']) {
    projects[name] = expect(await users.admin.api.post('/projects', { name:'CT-' + name + ' thử quyền ' + suffix,
      contract_no:'PQ-' + suffix + '-' + name, project_code:'PQ-' + suffix + '-' + name }), 201);
    members[name] = {};
  }
  for (const [who, assignments] of Object.entries({ ks:{ A:'Kỹ sư', B:'Giám sát trưởng' },
    gst:{ A:'Giám sát trưởng', B:'Kỹ sư', C:'Phó giám sát trưởng' }, ql:{ A:'Quản lý' } })) {
    for (const [ct,title] of Object.entries(assignments)) {
      members[ct][who] = expect(await users.admin.api.post('/project-members', {
        project_id:projects[ct].id, user_id:users[who].id, assignment_title:title
      }), 201);
    }
  }
  return { projects, members };
}
async function record(users, fixture, route, ct='A', who='ks') {
  const suffix = ++sequence, pid = fixture.projects[ct].id;
  const payload = route === 'daily-logs' ? { project_id:pid, log_date:'2026-10-07', shift:'PQ' + suffix, work_summary:'Báo cáo thử [' + suffix + ']' }
    : route === 'documents' ? { project_id:pid, type:'HS', name:'Hồ sơ thử [' + suffix + ']' }
    : { project_id:pid, issue_code:'PQ' + suffix, title:'Văn bản thử [' + suffix + ']', details:{ documentType:'MINUTES', status:'DRAFT' } };
  return expect(await users[who].api.post('/' + route, payload), 201);
}
module.exports = { client, expect, createUsers, createProjects, record };
