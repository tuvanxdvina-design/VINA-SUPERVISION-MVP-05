// Ý kiến duyệt (Gửi duyệt / Phê duyệt / Yêu cầu chỉnh sửa, bổ sung / Trình công ty / Khóa / Mở khóa) và hộp việc cần duyệt.
//
// Nguyên tắc: Trưởng TVGS (người có quyền "Duyệt" tại công trình) quyết định mọi việc của đoàn TVGS tại công trình.
// Việc vượt thẩm quyền thì Trưởng TVGS "Trình công ty" → Giám đốc/Admin nhận và quyết định.
// Công trình chưa có ai được quyền Duyệt → việc chờ duyệt chuyển thẳng về công ty để không bị kẹt.
const pool = require('../utils/db');
const permissionService = require('./permissionService');

const ENTITY_TYPES = ['documents', 'daily_logs'];
const MAX_COMMENT = 4000;

function cleanComment(v) {
  const s = String(v ?? '').replace(/\r\n/g, '\n').trim();
  return s ? s.slice(0, MAX_COMMENT) : null;
}

async function addNote({ entityType, entityId, projectId, action, comment, actorId }) {
  if (!ENTITY_TYPES.includes(entityType)) throw new Error('Loại bản ghi không hợp lệ');
  await pool.query(`
    INSERT INTO review_notes (entity_type, entity_id, project_id, action, comment, actor_id)
    VALUES ($1, $2, $3, $4, $5, $6)`, [entityType, entityId, projectId, action, cleanComment(comment), actorId]);
}

async function lastAction(entityType, entityId) {
  return (await pool.query(`SELECT action FROM review_notes WHERE entity_type = $1 AND entity_id = $2
    ORDER BY created_at DESC LIMIT 1`, [entityType, entityId])).rows[0]?.action || null;
}

async function history(entityType, entityId) {
  return (await pool.query(`
    SELECT n.action, n.comment, n.created_at, u.full_name AS actor_name
    FROM review_notes n LEFT JOIN users u ON u.id = n.actor_id
    WHERE n.entity_type = $1 AND n.entity_id = $2
    ORDER BY n.created_at DESC, n.id`, [entityType, entityId])).rows;
}

// SQL con: ý kiến gần nhất của một bản ghi (dùng trong danh sách hồ sơ/nhật ký)
function lastReviewSql(entityType, alias) {
  return `(SELECT json_build_object('action', n.action, 'comment', n.comment, 'by', ru.full_name, 'at', n.created_at)
           FROM review_notes n LEFT JOIN users ru ON ru.id = n.actor_id
           WHERE n.entity_type = '${entityType}' AND n.entity_id = ${alias}.id
           ORDER BY n.created_at DESC LIMIT 1)`;
}

const LAST_NOTE = kind => `LEFT JOIN LATERAL (
    SELECT x.action AS last_action, x.comment AS last_comment, x.created_at AS last_at, xu.full_name AS last_by
    FROM review_notes x LEFT JOIN users xu ON xu.id = x.actor_id
    WHERE x.entity_type = '${kind}' AND x.entity_id = t.id ORDER BY x.created_at DESC LIMIT 1) ln ON true`;

// Bản ghi đang CHỜ DUYỆT; projectIds = null → mọi công trình
async function pendingItems(projectIds) {
  return (await pool.query(`
    SELECT 'documents' AS kind, t.id, t.project_id, COALESCE(p.project_code, p.contract_no) AS project_code, p.name AS project_name,
           t.auto_code AS code, t.name AS title, t.doc_group, t.details->>'reportType' AS report_type,
           NULL AS log_date, NULL AS shift, t.submitted_at, COALESCE(t.author_name, u.full_name) AS created_by_name, ln.*
    FROM documents t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by ${LAST_NOTE('documents')}
    WHERE t.status = 'SUBMITTED' AND ($1::uuid[] IS NULL OR t.project_id = ANY($1::uuid[]))
    UNION ALL
    SELECT 'daily_logs', t.id, t.project_id, COALESCE(p.project_code, p.contract_no), p.name,
           NULL, LEFT(COALESCE(t.work_summary, ''), 160), NULL, NULL,
           TO_CHAR(t.log_date, 'YYYY-MM-DD'), t.shift, t.submitted_at, COALESCE(t.author_name, u.full_name), ln.*
    FROM daily_logs t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by ${LAST_NOTE('daily_logs')}
    WHERE t.status = 'SUBMITTED' AND ($1::uuid[] IS NULL OR t.project_id = ANY($1::uuid[]))
    ORDER BY submitted_at NULLS LAST`, [projectIds])).rows;
}

// Hộp việc của người đăng nhập:
//  can_review : có quyền duyệt ở ít nhất 1 công trình (hoặc Giám đốc/Admin) → hiện mục "Việc cần duyệt"
//  to_review  : việc mình phải quyết định
//     - Trưởng TVGS: bản chờ duyệt ở công trình mình có quyền Duyệt (trừ bản mình đã trình công ty)
//     - Giám đốc/Admin: bản được TRÌNH CÔNG TY + bản ở công trình chưa có ai được quyền Duyệt
//  escalated  : (Trưởng TVGS) bản mình đã trình công ty, đang chờ công ty quyết định
//  monitor    : (Giám đốc/Admin) bản đang chờ Trưởng TVGS các công trình duyệt — chỉ để theo dõi
//  returned   : bản CỦA MÌNH bị yêu cầu chỉnh sửa, bổ sung;  approved: bản của mình được duyệt 7 ngày qua
async function inbox(userId) {
  const role = (await pool.query(`SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.is_active`, [userId])).rows[0]?.name || '';
  const company = ['ADMIN', 'DIRECTOR'].includes(role);
  const perms = await permissionService.allForUser(userId);
  const readable = new Set(Object.entries(perms).filter(([,v]) => v.permissions.includes('VIEW')).map(([id]) => id));
  const approverProjects = Object.entries(perms).filter(([, v]) => v.source !== 'GLOBAL_ROLE' && v.permissions.includes('APPROVE')).map(([k]) => k);
  const canReview = company || approverProjects.length > 0;

  let toReview = [], escalated = [], monitor = [];
  if (company) {
    const pending = await pendingItems(null);
    const withApprover = await permissionService.approverProjectIds();
    for (const it of pending) {
      it.reason = it.last_action === 'ESCALATE' ? 'ESCALATED' : (!withApprover.has(it.project_id) ? 'NO_APPROVER' : null);
      (it.reason ? toReview : monitor).push(it);
    }
  } else if (approverProjects.length) {
    for (const it of await pendingItems(approverProjects)) (it.last_action === 'ESCALATE' ? escalated : toReview).push(it);
  }

  const mine = (kind, table, extra) => `
    SELECT '${kind}' AS kind, t.id, t.project_id, COALESCE(p.project_code, p.contract_no) AS project_code, p.name AS project_name, ${extra},
           n.action, n.comment, n.created_at AS reviewed_at, ru.full_name AS reviewer_name
    FROM ${table} t
    JOIN projects p ON p.id = t.project_id
    JOIN LATERAL (SELECT * FROM review_notes x WHERE x.entity_type = '${kind}' AND x.entity_id = t.id ORDER BY x.created_at DESC LIMIT 1) n ON true
    LEFT JOIN users ru ON ru.id = n.actor_id
    WHERE t.created_by = $1`;
  const docCols = `t.auto_code AS code, t.name AS title, t.doc_group, t.details->>'reportType' AS report_type, NULL AS log_date, NULL AS shift`;
  const logCols = `NULL AS code, LEFT(COALESCE(t.work_summary, ''), 160) AS title, NULL AS doc_group, NULL AS report_type, TO_CHAR(t.log_date, 'YYYY-MM-DD') AS log_date, t.shift`;
  const returned = (await pool.query(`
    ${mine('documents', 'documents', docCols)} AND t.status = 'DRAFT' AND n.action = 'REJECT'
    UNION ALL
    ${mine('daily_logs', 'daily_logs', logCols)} AND t.status = 'DRAFT' AND n.action = 'REJECT'
    ORDER BY reviewed_at DESC`, [userId])).rows;
  const approved = (await pool.query(`
    ${mine('documents', 'documents', docCols)} AND n.action = 'APPROVE' AND n.created_at > NOW() - interval '7 days'
    UNION ALL
    ${mine('daily_logs', 'daily_logs', logCols)} AND n.action = 'APPROVE' AND n.created_at > NOW() - interval '7 days'
    ORDER BY reviewed_at DESC LIMIT 50`, [userId])).rows;
  return {
    can_review: canReview, is_company: company, approver_projects: approverProjects,
    to_review: toReview, escalated, monitor,
    returned: returned.filter(r => readable.has(r.project_id)), approved: approved.filter(r => readable.has(r.project_id)),
    counts: { to_review: toReview.length, returned: returned.filter(r => readable.has(r.project_id)).length }
  };
}

module.exports = { ENTITY_TYPES, cleanComment, addNote, lastAction, history, lastReviewSql, inbox };
