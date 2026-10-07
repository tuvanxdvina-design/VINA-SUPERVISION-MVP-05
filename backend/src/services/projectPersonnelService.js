const pool = require('../utils/db');
const fileStore = require('./fileStore');
const permissionService = require('./permissionService');

// Chuẩn hóa họ tên: NFC + bỏ khoảng trắng thừa. Dùng thống nhất ở mọi đường ghi.
function cleanName(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

class ProjectPersonnelService {
  // ---------------------------------------------------------------------------
  // Danh sách hợp nhất: mỗi người MỘT dòng.
  //  - Dòng nhân sự (project_personnel), nếu có user_id thì gắn phân công tài khoản.
  //  - Dòng tài khoản được phân công nhưng chưa có hồ sơ nhân sự.
  // ---------------------------------------------------------------------------
  async team(projectId) {
    const result = await pool.query(`
      SELECT pp.id AS personnel_id, pp.full_name, pp.assignment_title, pp.certificate,
             pp.user_id, pm.id AS member_id, u.username, u.full_name AS account_name,
             r.name AS role_name, pm.assignment_title AS member_title,
             pma.access_permissions, (pma.access_permissions IS NOT NULL) AS has_custom,
             COALESCE(pma.work_scope, '') AS work_scope, pp.updated_at,
             pp.bidding_package_id, pm.bidding_package_id AS member_package_id
      FROM project_personnel pp
      LEFT JOIN project_members pm ON pm.project_id = pp.project_id AND pm.user_id = pp.user_id AND pm.status = 'ACTIVE'
      LEFT JOIN users u ON u.id = pp.user_id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN project_member_access pma ON pma.project_member_id = pm.id
      WHERE pp.project_id = $1 AND pp.status = 'ACTIVE'
      UNION ALL
      SELECT NULL, u.full_name, pm.assignment_title, NULL,
             pm.user_id, pm.id, u.username, u.full_name,
             r.name, pm.assignment_title,
             pma.access_permissions, (pma.access_permissions IS NOT NULL),
             COALESCE(pma.work_scope, ''), pm.updated_at,
             NULL, pm.bidding_package_id
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN project_member_access pma ON pma.project_member_id = pm.id
      WHERE pm.project_id = $1 AND pm.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM project_personnel pp
                        WHERE pp.project_id = pm.project_id AND pp.user_id = pm.user_id AND pp.status = 'ACTIVE')
    `, [projectId]);

    return result.rows.map(row => {
      const linked = !!row.member_id;
      const eff = linked ? permissionService.effective(row.role_name, row.access_permissions, row.has_custom, row.assignment_title || row.member_title) : null;
      return {
        key: row.personnel_id ? 'p:' + row.personnel_id : 'm:' + row.member_id,
        personnel_id: row.personnel_id,
        member_id: row.member_id,
        user_id: row.user_id,
        full_name: row.full_name,
        // Chức danh = công việc được giao tại công trình. Ưu tiên hồ sơ nhân sự.
        assignment_title: row.assignment_title || row.member_title || '',
        certificate: row.certificate || '',
        username: row.username || '',
        account_name: row.account_name || '',
        role_name: row.role_name || '',
        account_status: linked ? 'LINKED' : (row.user_id ? 'LINKED_NO_ACCESS' : 'NO_ACCOUNT'),
        access_permissions: eff ? eff.permissions : [],
        permission_source: eff ? eff.source : 'NONE',
        work_scope: row.work_scope || '',
        bidding_package_id: row.bidding_package_id || row.member_package_id || null
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi'));
  }

  // Tài khoản đã lập nhật ký/văn bản tại công trình nhưng hiện KHÔNG còn được phân công
  // (gợi ý cho Admin/Giám đốc phân công lại, không tự cấp quyền).
  async unassignedAuthors(projectId) {
    const result = await pool.query(`
      SELECT u.id AS user_id, u.username, u.full_name, r.name AS role_name,
             COUNT(*)::int AS record_count, TO_CHAR(MAX(x.at), 'YYYY-MM-DD') AS last_at
      FROM (
        SELECT created_by AS uid, created_at AS at FROM daily_logs WHERE project_id = $1
        UNION ALL SELECT created_by, created_at FROM issues WHERE project_id = $1
      ) x
      JOIN users u ON u.id = x.uid AND u.is_active = true
      JOIN roles r ON r.id = u.role_id
      WHERE r.name NOT IN ('ADMIN', 'DIRECTOR')
        AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id AND pm.status = 'ACTIVE')
      GROUP BY u.id, u.username, u.full_name, r.name
      ORDER BY u.full_name
    `, [projectId]);
    return result.rows;
  }

  // Tra cứu nhân sự đã có ở BẤT KỲ công trình nào (không giới hạn 1 công trình) — dùng khi thêm nhân sự
  // mới ở công trình khác để chọn lại thay vì gõ tên mới mỗi lần (nhập liệu một chỗ, dùng nhiều nơi).
  // Mỗi tên chỉ trả về 1 dòng (bản ghi cập nhật gần nhất), kèm chứng chỉ gần nhất để gợi ý điền sẵn.
  async searchNames(q, limit = 20) {
    const query = String(q || '').trim();
    const result = await pool.query(`
      SELECT DISTINCT ON (lower(full_name)) full_name, certificate, updated_at
      FROM project_personnel
      WHERE status = 'ACTIVE' AND ($1 = '' OR full_name ILIKE '%' || $1 || '%')
      ORDER BY lower(full_name), updated_at DESC
      LIMIT $2
    `, [query, Math.min(Math.max(Number(limit) || 20, 1), 50)]);
    return result.rows;
  }

  async list(projectId) {
    const result = await pool.query(`
      SELECT id, project_id, full_name, assignment_title, certificate, user_id,
             status, created_by, created_at, updated_at
      FROM project_personnel
      WHERE project_id = $1 AND status = 'ACTIVE'
      ORDER BY full_name ASC
    `, [projectId]);
    return result.rows;
  }

  async getById(id) {
    const result = await pool.query('SELECT * FROM project_personnel WHERE id = $1', [id]);
    return result.rows[0];
  }

  async listFiles(personnelId) {
    return (await pool.query(`SELECT id, category, file_name, file_type, file_size, uploaded_at
      FROM project_personnel_files WHERE personnel_id=$1 ORDER BY uploaded_at, id`, [personnelId])).rows;
  }

  async addFile(personnel, category, name, type, buffer, userId) {
    const stored = await fileStore.put(buffer);
    return (await pool.query(`INSERT INTO project_personnel_files
      (personnel_id, project_id, category, file_name, file_type, file_size, sha256, storage_key, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (personnel_id, sha256) DO UPDATE SET file_name=EXCLUDED.file_name, category=EXCLUDED.category
      RETURNING id, category, file_name, file_type, file_size, uploaded_at, (xmax=0) AS created`,
    [personnel.id, personnel.project_id, category, name, type, buffer.length, stored.sha256, stored.storageKey, userId])).rows[0];
  }

  async getFile(personnelId, fileId) {
    const row = (await pool.query('SELECT file_name,file_type,storage_key FROM project_personnel_files WHERE personnel_id=$1 AND id=$2', [personnelId, fileId])).rows[0];
    if (!row) return null;
    const buffer = await fileStore.get(row.storage_key);
    return buffer ? { name: row.file_name, type: row.file_type, buffer } : null;
  }

  async removeFile(personnelId, fileId) {
    const row = (await pool.query('DELETE FROM project_personnel_files WHERE personnel_id=$1 AND id=$2 RETURNING id, file_name', [personnelId, fileId])).rows[0];
    if (!row) throw httpError(404, 'Không tìm thấy tệp chứng chỉ');
    return row;
  }

  // Thêm/cập nhật theo ID; nếu ID mới nhưng trùng tên (đã chuẩn hóa) thì cập nhật dòng cũ
  // thay vì tạo dòng thứ hai.
  async upsert(data) {
    const fullName = cleanName(data.full_name);
    const title = String(data.assignment_title || '').trim();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let existing = null;
      let matchedById = false;
      if (data.id) {
        existing = (await client.query(
          'SELECT * FROM project_personnel WHERE id = $1 AND project_id = $2 FOR UPDATE', [data.id, data.project_id]
        )).rows[0];
        matchedById = !!existing;
      }
      if (!existing) {
        existing = (await client.query(
          `SELECT * FROM project_personnel WHERE project_id = $1 AND status = 'ACTIVE' AND lower(full_name) = lower($2) FOR UPDATE`,
          [data.project_id, fullName]
        )).rows[0];
      }
      let row;
      if (existing) {
        // Khớp theo ID = sửa có chủ đích → ghi đè. Khớp theo tên = người đã có → chỉ bổ sung ô còn trống,
        // không ghi đè dữ liệu mới hơn trên máy chủ bằng bản cũ từ thiết bị.
        row = (await client.query(matchedById ? `
          UPDATE project_personnel
          SET full_name = $1, assignment_title = $2, certificate = NULLIF($3, ''), status = 'ACTIVE',
              bidding_package_id = $6::uuid, updated_at = NOW()
          WHERE id = $4 RETURNING *
        ` : `
          UPDATE project_personnel
          SET assignment_title = COALESCE(NULLIF(assignment_title, ''), $2),
              certificate = COALESCE(NULLIF(certificate, ''), NULLIF($3, '')),
              user_id = COALESCE(user_id, $5::uuid),
              bidding_package_id = COALESCE(bidding_package_id, $6::uuid),
              status = 'ACTIVE', updated_at = NOW()
          WHERE id = $4 AND ($1::text IS NOT NULL) RETURNING *
        `, [fullName, title, data.certificate || '', existing.id, data.user_id || null, data.bidding_package_id || null])).rows[0];
      } else {
        // Phân công tài khoản vào công trình (Thiết lập → Phân công) tạo project_members trực tiếp,
        // không qua đây — nên khi tạo hồ sơ nhân sự cho người ĐÃ có tài khoản trong công trình
        // (mở từ dòng "chỉ có tài khoản" ở trang Nhân sự), phải gắn luôn user_id để hợp nhất một dòng,
        // không tạo dòng nhân sự trùng tách biệt với phân công tài khoản đã có.
        row = (await client.query(`
          INSERT INTO project_personnel (id, project_id, full_name, assignment_title, certificate, status, created_by, user_id, bidding_package_id)
          VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, NULLIF($5, ''), 'ACTIVE', $6, $7::uuid, $8::uuid)
          RETURNING *
        `, [data.id || null, data.project_id, fullName, title, data.certificate || '', data.created_by, data.user_id || null, data.bidding_package_id || null])).rows[0];
      }
      await this.syncMemberTitle(client, row);
      await client.query('COMMIT');
      return { row, created: !existing };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw httpError(409, 'Đã có nhân sự cùng họ tên trong công trình này');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`
        UPDATE project_personnel
        SET full_name = COALESCE(NULLIF($1, ''), full_name),
            assignment_title = COALESCE(NULLIF($2, ''), assignment_title),
            certificate = CASE WHEN $3::text IS NULL THEN certificate ELSE NULLIF($3, '') END,
            bidding_package_id = CASE WHEN $5::boolean THEN $6::uuid ELSE bidding_package_id END,
            updated_at = NOW()
        WHERE id = $4 AND status = 'ACTIVE'
        RETURNING *
      `, [cleanName(data.full_name), String(data.assignment_title || '').trim(),
          data.certificate === undefined ? null : String(data.certificate), id,
          data.bidding_package_id !== undefined, data.bidding_package_id || null])).rows[0];
      if (row) await this.syncMemberTitle(client, row);
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw httpError(409, 'Đã có nhân sự cùng họ tên trong công trình này');
      throw error;
    } finally {
      client.release();
    }
  }

  // Giữ chức danh + gói thầu ở phân công tài khoản khớp với hồ sơ nhân sự (một nguồn sự thật).
  async syncMemberTitle(client, personnel) {
    if (!personnel?.user_id) return;
    await client.query(`
      UPDATE project_members SET assignment_title = $1, bidding_package_id = $4, updated_at = NOW()
      WHERE project_id = $2 AND user_id = $3 AND status = 'ACTIVE'
    `, [personnel.assignment_title, personnel.project_id, personnel.user_id, personnel.bidding_package_id || null]);
  }

  async upsertMember(client, projectId, user, title, actorId, packageId) {
    return (await client.query(`
      INSERT INTO project_members (project_id, user_id, role_id, assignment_title, bidding_package_id, start_date, status, assigned_by)
      VALUES ($1, $2, $3, NULLIF($4, ''), $6::uuid, CURRENT_DATE, 'ACTIVE', $5)
      ON CONFLICT (project_id, user_id) DO UPDATE SET
        role_id = EXCLUDED.role_id,
        assignment_title = COALESCE(EXCLUDED.assignment_title, project_members.assignment_title),
        bidding_package_id = COALESCE(EXCLUDED.bidding_package_id, project_members.bidding_package_id),
        start_date = CASE WHEN project_members.status = 'ACTIVE' THEN project_members.start_date ELSE CURRENT_DATE END,
        end_date = NULL, status = 'ACTIVE', assigned_by = EXCLUDED.assigned_by, updated_at = NOW()
      RETURNING *
    `, [projectId, user.id, user.role_id, title || '', actorId, packageId || null])).rows[0];
  }

  // permissions: undefined = giữ nguyên; null = về mặc định theo vai trò; mảng = tùy chỉnh.
  // workScope:   undefined = giữ nguyên.
  async saveAccess(client, memberId, permissions, workScope) {
    if (permissions === undefined && workScope === undefined) return;
    const current = (await client.query(
      'SELECT access_permissions, work_scope FROM project_member_access WHERE project_member_id = $1', [memberId]
    )).rows[0];
    let list = permissions === undefined ? (current ? current.access_permissions : null) : permissions;
    if (list !== null) {
      list = permissionService.normalizeList(list);
    }
    const scope = workScope === undefined ? (current?.work_scope || '') : String(workScope || '').trim();
    await client.query(`
      INSERT INTO project_member_access (project_member_id, access_permissions, work_scope, updated_at)
      VALUES ($1, $2::jsonb, NULLIF($3, ''), NOW())
      ON CONFLICT (project_member_id) DO UPDATE SET
        access_permissions = EXCLUDED.access_permissions,
        work_scope = EXCLUDED.work_scope,
        updated_at = NOW()
    `, [memberId, list === null ? null : JSON.stringify(list), scope]);
  }

  async activeUser(client, userId) {
    const user = (await client.query(
      'SELECT id, full_name, role_id FROM users WHERE id = $1 AND is_active = true', [userId]
    )).rows[0];
    if (!user) throw httpError(400, 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa');
    return user;
  }

  // Phân công tài khoản vào công trình (luồng "Phân công mới").
  // Không tạo dòng nhân sự thứ hai nếu đã có người cùng tên chưa liên kết → liên kết luôn.
  async assignAccount({ project_id, user_id, assignment_title, access_permissions, work_scope, bidding_package_id, actorId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const project = (await client.query('SELECT id FROM projects WHERE id = $1', [project_id])).rows[0];
      if (!project) throw httpError(404, 'Công trình chưa có trên máy chủ (có thể chưa đồng bộ)');
      const user = await this.activeUser(client, user_id);
      const title = String(assignment_title || '').trim();
      const roleName = (await client.query('SELECT name FROM roles WHERE id = $1', [user.role_id])).rows[0]?.name;
      if (['MANAGER', 'ADMIN', 'DIRECTOR'].includes(roleName)) {
        // Cấp quản lý: chỉ cấp quyền truy cập công trình, không đưa vào danh sách nhân sự tổ TVGS
        const member = await this.upsertMember(client, project_id, user, title, actorId);
        await this.saveAccess(client, member.id, access_permissions, work_scope);
        await client.query('COMMIT');
        return { personnel: null, member };
      }

      let personnel = (await client.query(
        `SELECT * FROM project_personnel WHERE project_id = $1 AND user_id = $2 AND status = 'ACTIVE' FOR UPDATE`,
        [project_id, user_id]
      )).rows[0];
      if (!personnel) {
        personnel = (await client.query(
          `SELECT * FROM project_personnel WHERE project_id = $1 AND status = 'ACTIVE' AND user_id IS NULL
             AND lower(full_name) = lower($2) FOR UPDATE`,
          [project_id, cleanName(user.full_name)]
        )).rows[0];
      }
      if (personnel) {
        personnel = (await client.query(`
          UPDATE project_personnel SET user_id = $1,
            assignment_title = COALESCE(NULLIF($2, ''), assignment_title),
            bidding_package_id = COALESCE($4::uuid, bidding_package_id), updated_at = NOW()
          WHERE id = $3 RETURNING *
        `, [user_id, title, personnel.id, bidding_package_id || null])).rows[0];
      } else {
        if (!title) throw httpError(400, 'Hãy nhập chức danh tại công trình');
        personnel = (await client.query(`
          INSERT INTO project_personnel (project_id, full_name, assignment_title, user_id, status, created_by, bidding_package_id)
          VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6::uuid) RETURNING *
        `, [project_id, cleanName(user.full_name), title, user_id, actorId, bidding_package_id || null])).rows[0];
      }
      const member = await this.upsertMember(client, project_id, user, personnel.assignment_title, actorId, personnel.bidding_package_id);
      await this.saveAccess(client, member.id, access_permissions, work_scope);
      await client.query('COMMIT');
      return { personnel, member };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw httpError(409, 'Tài khoản này đã được liên kết với nhân sự khác trong công trình');
      throw error;
    } finally {
      client.release();
    }
  }

  // Liên kết một nhân sự có sẵn với tài khoản (từ danh sách nhân sự).
  async linkAccount(personnelId, { user_id, access_permissions, work_scope, actorId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const personnel = (await client.query(
        `SELECT * FROM project_personnel WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`, [personnelId]
      )).rows[0];
      if (!personnel) throw httpError(404, 'Không tìm thấy nhân sự công trình');
      const user = await this.activeUser(client, user_id);
      const other = (await client.query(
        `SELECT id FROM project_personnel WHERE project_id = $1 AND user_id = $2 AND status = 'ACTIVE' AND id <> $3`,
        [personnel.project_id, user_id, personnelId]
      )).rows[0];
      if (other) throw httpError(409, 'Tài khoản này đã gắn với một nhân sự khác của công trình. Hủy liên kết ở nhân sự kia trước.');
      if (personnel.user_id && personnel.user_id !== user_id) {
        await client.query(`UPDATE project_members SET status = 'INACTIVE', end_date = CURRENT_DATE, updated_at = NOW()
                            WHERE project_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [personnel.project_id, personnel.user_id]);
      }
      const row = (await client.query(
        'UPDATE project_personnel SET user_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [user_id, personnelId]
      )).rows[0];
      const member = await this.upsertMember(client, row.project_id, user, row.assignment_title, actorId, row.bidding_package_id);
      await this.saveAccess(client, member.id, access_permissions, work_scope);
      await client.query('COMMIT');
      return { personnel: row, member };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw httpError(409, 'Tài khoản này đã được liên kết với nhân sự khác trong công trình');
      throw error;
    } finally {
      client.release();
    }
  }

  // Hủy liên kết: thu hồi quyền truy cập công trình, vẫn giữ tên trong danh sách nhân sự.
  async unlinkAccount(personnelId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const personnel = (await client.query(
        `SELECT * FROM project_personnel WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`, [personnelId]
      )).rows[0];
      if (!personnel) throw httpError(404, 'Không tìm thấy nhân sự công trình');
      if (personnel.user_id) {
        await client.query(`UPDATE project_members SET status = 'INACTIVE', end_date = CURRENT_DATE, updated_at = NOW()
                            WHERE project_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [personnel.project_id, personnel.user_id]);
      }
      const row = (await client.query(
        'UPDATE project_personnel SET user_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *', [personnelId]
      )).rows[0];
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Rút nhân sự khỏi công trình: ẩn khỏi danh sách và kết thúc phân công tài khoản (nếu có).
  async remove(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`
        UPDATE project_personnel SET status = 'INACTIVE', updated_at = NOW()
        WHERE id = $1 AND status = 'ACTIVE' RETURNING *
      `, [id])).rows[0];
      if (row?.user_id) {
        await client.query(`UPDATE project_members SET status = 'INACTIVE', end_date = CURRENT_DATE, updated_at = NOW()
                            WHERE project_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [row.project_id, row.user_id]);
      }
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const service = new ProjectPersonnelService();
service.cleanName = cleanName;
module.exports = service;
