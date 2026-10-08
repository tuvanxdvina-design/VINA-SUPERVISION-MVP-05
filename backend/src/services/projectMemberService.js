const pool = require('../utils/db');
const permissionService = require('./permissionService');
const personnelService = require('./projectPersonnelService');

function withEffective(row) {
  if (!row) return row;
  const eff = permissionService.effective(row.role_name, row.custom_permissions, row.has_custom, row.assignment_title);
  const { custom_permissions, has_custom, ...rest } = row;
  return { ...rest, access_permissions: eff.permissions, permission_source: eff.source };
}

const SELECT_MEMBER = `
  SELECT pm.*, u.full_name, u.username, u.email, r.name AS role_name,
         COALESCE(pp.assignment_title, pm.assignment_title) AS assignment_title,
         pp.id AS personnel_id,
         pma.access_permissions AS custom_permissions,
         (pma.access_permissions IS NOT NULL) AS has_custom,
         COALESCE(pma.work_scope, '') AS work_scope
  FROM project_members pm
  JOIN users u ON pm.user_id = u.id
  JOIN roles r ON u.role_id = r.id
  LEFT JOIN project_member_access pma ON pma.project_member_id = pm.id
  LEFT JOIN project_personnel pp ON pp.project_id = pm.project_id AND pp.user_id = pm.user_id AND pp.status = 'ACTIVE'
`;

class ProjectMemberService {
  // Giữ để tương thích mã cũ gọi tới; bảng đã được tạo trong migration 20260926.
  async ensureAccessTable() {}

  async getMembersByProject(projectId) {
    const result = await pool.query(`${SELECT_MEMBER}
      WHERE pm.project_id = $1 AND pm.status = 'ACTIVE'
      ORDER BY u.full_name`, [projectId]);
    return result.rows.map(withEffective);
  }

  async getMemberById(id) {
    const result = await pool.query(`${SELECT_MEMBER} WHERE pm.id = $1`, [id]);
    return withEffective(result.rows[0]);
  }

  async addMember(data) {
    const { member } = await personnelService.assignAccount({
      project_id: data.project_id,
      user_id: data.user_id,
      assignment_title: data.assignment_title,
      access_permissions: data.access_permissions,
      work_scope: data.work_scope,
      actorId: data.assigned_by
    });
    return this.getMemberById(member.id);
  }

  async updateMember(id, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const member = (await client.query(`
        UPDATE project_members
        SET assignment_title = COALESCE(NULLIF($1, ''), assignment_title),
            end_date = COALESCE($2::date, end_date),
            updated_at = NOW()
        WHERE id = $3 AND status = 'ACTIVE'
        RETURNING *
      `, [String(data.assignment_title || '').trim(), data.end_date || null, id])).rows[0];
      if (!member) {
        await client.query('ROLLBACK');
        return null;
      }
      if (data.assignment_title) {
        await client.query(`
          UPDATE project_personnel SET assignment_title = $1, updated_at = NOW()
          WHERE project_id = $2 AND user_id = $3 AND status = 'ACTIVE'
        `, [member.assignment_title, member.project_id, member.user_id]);
        await personnelService.ensureSingleLead(client, member.project_id, member.assignment_title, { userId: member.user_id });
      }
      await personnelService.saveAccess(client, id, data.access_permissions, data.work_scope);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getMemberById(id);
  }

  async removeMember(id, end_date) {
    const result = await pool.query(`
      UPDATE project_members
      SET status = 'INACTIVE', end_date = COALESCE($1::date, CURRENT_DATE), updated_at = NOW()
      WHERE id = $2 AND status = 'ACTIVE'
      RETURNING *
    `, [end_date || null, id]);
    return result.rows[0];
  }
}

module.exports = new ProjectMemberService();
