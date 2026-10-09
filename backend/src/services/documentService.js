const { expectedVersion, requireUpdated } = require('../utils/editConflict');
const pool = require('../utils/db');
const crypto = require('crypto');
const { lastReviewSql } = require('./reviewService');

// Mã loại hồ sơ → tiền tố mã tự sinh [LOẠI]-[MÃ CÔNG TRÌNH]-[STT] (Quyết định A)
const TYPE_CODES = { HS: 'Hồ sơ pháp lý', BB: 'Biên bản', NK: 'Nhật ký', TK: 'Thiết kế kỹ thuật', BC: 'Báo cáo', TKT: 'Tiêu chuẩn kỹ thuật', KHAC: 'Khác' };

const LIST_SQL = `
  SELECT d.id, d.project_id, d.type, d.auto_code, d.name, d.status, d.version, d.row_version, d.doc_group, d.details,
         d.is_adjustment_of, d.created_by, d.created_at, d.updated_at, d.approved_at, d.locked_at, d.submitted_at,d.personnel_certificate_snapshot,
         ${lastReviewSql('documents', 'd')} AS last_review,
         COALESCE(d.author_name, u.full_name) AS created_by_name, up.full_name AS updated_by_name, a.full_name AS approved_by_name,
         COALESCE((SELECT json_agg(json_build_object('id', f.id, 'category', f.category, 'file_name', f.file_name,
                    'file_type', f.file_type, 'file_size', f.file_size, 'uploaded_at', f.uploaded_at) ORDER BY f.uploaded_at)
                   FROM document_files f WHERE f.document_id = d.id), '[]'::json) AS files
  FROM documents d
  LEFT JOIN users u ON d.created_by = u.id
  LEFT JOIN users up ON d.updated_by = up.id
  LEFT JOIN users a ON d.approved_by = a.id`;

class DocumentService {
  // Sinh mã nguyên tử (khóa dòng bộ đếm) — không trùng khi nhiều người tạo cùng lúc
  async generateDocumentCode(client, projectId, docType) {
    const seq = await client.query(`
      INSERT INTO document_sequences (project_id, type, next_sequence)
      VALUES ($1, $2, 2)
      ON CONFLICT (project_id, type) DO UPDATE SET next_sequence = document_sequences.next_sequence + 1
      RETURNING next_sequence - 1 AS n`, [projectId, docType]);
    const project = await client.query('SELECT COALESCE(project_code, contract_no) AS code FROM projects WHERE id = $1', [projectId]);
    return `${docType}-${project.rows[0].code}-${String(seq.rows[0].n).padStart(3, '0')}`;
  }

  async createDocument(data) {
    const type = TYPE_CODES[data.type] ? data.type : (data.doc_group === 'REPORT' ? 'BC' : 'HS');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let code, row;
      for (let attempt = 0; attempt < 5; attempt++) {
        code = await this.generateDocumentCode(client, data.project_id, type);
        const r = await client.query(`
          INSERT INTO documents (project_id, type, auto_code, name, status, version, doc_group, details, created_by, updated_by)
          VALUES ($1, $2, $3, $4, 'DRAFT', 1, $5, $6::jsonb, $7, $7)
          ON CONFLICT (project_id, auto_code) DO NOTHING RETURNING id`,
        [data.project_id, type, code, data.name, data.doc_group === 'REPORT' ? 'REPORT' : 'LEGAL', JSON.stringify(data.details || {}), data.created_by]);
        if (r.rows[0]) { row = r.rows[0]; break; }
      }
      if (!row) throw new Error('Không cấp được mã hồ sơ');
      await client.query('COMMIT');
      return this.getDocumentById(row.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getDocumentsByProject(projectId, filters = {}) {
    const params = [projectId];
    let sql = `${LIST_SQL} WHERE d.project_id = $1`;
    if (filters.type) { params.push(filters.type); sql += ` AND d.type = $${params.length}`; }
    if (filters.status) { params.push(filters.status); sql += ` AND d.status = $${params.length}`; }
    sql += ' ORDER BY d.created_at DESC';
    return (await pool.query(sql, params)).rows;
  }

  async getDocumentById(id) {
    return (await pool.query(`${LIST_SQL} WHERE d.id = $1`, [id])).rows[0];
  }

  async updateDocument(id, data, actorId) {
    const cur = await this.getDocumentById(id);
    if (!cur) return null;
    const type = data.type && TYPE_CODES[data.type] ? data.type : cur.type;
    const result = await pool.query(`
      UPDATE documents SET name = COALESCE(NULLIF($1, ''), name), doc_group = $2, details = $3::jsonb,
        updated_by = $4, updated_at = NOW(), type = $6
      WHERE id = $5 AND row_version = $7 AND status <> 'LOCKED' RETURNING id`,
    [data.name || '', data.doc_group === 'REPORT' || data.doc_group === 'LEGAL' ? data.doc_group : cur.doc_group,
      JSON.stringify(data.details !== undefined ? data.details : cur.details || {}), actorId, id, type, expectedVersion(data)]);
    requireUpdated(result.rows[0]);
    return this.getDocumentById(id);
  }

  async addFile(documentId, { category, name, type, buffer }, actorId) {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const r = await pool.query(`
      INSERT INTO document_files (document_id, category, file_name, file_type, file_size, sha256, content, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (document_id, sha256) DO UPDATE SET category = EXCLUDED.category, file_name = EXCLUDED.file_name
      RETURNING id, category, file_name, file_type, file_size, uploaded_at, (xmax = 0) AS created`,
    [documentId, category || 'Tài liệu', name, type || 'application/octet-stream', buffer.length, sha256, buffer, actorId]);
    await pool.query('UPDATE documents SET updated_by = $1, updated_at = NOW() WHERE id = $2', [actorId, documentId]);
    return r.rows[0];
  }

  async getFile(documentId, fileId) {
    return (await pool.query('SELECT file_name, file_type, content FROM document_files WHERE id = $1 AND document_id = $2', [fileId, documentId])).rows[0];
  }

  async removeFile(documentId, fileId, actorId) {
    const r = await pool.query('DELETE FROM document_files WHERE id = $1 AND document_id = $2 RETURNING id, file_name', [fileId, documentId]);
    if (r.rows[0]) await pool.query('UPDATE documents SET updated_by = $1, updated_at = NOW() WHERE id = $2', [actorId, documentId]);
    return r.rows[0];
  }

  // ---- Quy trình (giữ như trước) ----
  async submitDocument(id, userId) {
    const r = await pool.query(`UPDATE documents SET status = 'SUBMITTED', submitted_by = $1, submitted_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND status = 'DRAFT' RETURNING *`, [userId, id]);
    return r.rows[0];
  }
  async approveDocument(id, userId) {
    const r = await pool.query(`UPDATE documents SET status = 'APPROVED', approved_by = $1, approved_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND status = 'SUBMITTED' RETURNING *`, [userId, id]);
    return r.rows[0];
  }
  async rejectDocument(id) {
    const r = await pool.query(`UPDATE documents SET status = 'DRAFT', submitted_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'SUBMITTED' RETURNING *`, [id]);
    return r.rows[0];
  }
  async lockDocument(id) {
    const r = await pool.query(`UPDATE documents SET status = 'LOCKED', locked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'APPROVED' RETURNING *`, [id]);
    return r.rows[0];
  }
  async reopenDocument(id, userId, reason) {
    const r = await pool.query(`UPDATE documents SET status = 'DRAFT', reopened_by = $1, reopened_at = NOW(), reopened_reason = $2,
      version = version + 1, updated_at = NOW() WHERE id = $3 AND status = 'LOCKED' RETURNING *`, [userId, reason || null, id]);
    return r.rows[0];
  }
  async deleteDocument(id) {
    await pool.query('DELETE FROM documents WHERE id = $1', [id]);
  }
}

const service = new DocumentService();
service.TYPE_CODES = TYPE_CODES;
module.exports = service;
