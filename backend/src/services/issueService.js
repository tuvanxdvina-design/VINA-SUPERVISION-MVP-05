const { expectedVersion, requireUpdated } = require('../utils/editConflict');
﻿const pool = require('../utils/db');
const { randomUUID } = require('crypto');
const fileStore = require('./fileStore');

class IssueService {
  async getAllIssues(projectId, filters = {}) {
    let query = `
      SELECT i.*, TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date_text, COALESCE(i.author_name, u.full_name) as created_by_name, a.full_name as assigned_to_name, r.full_name as resolved_by_name
      FROM issues i
      LEFT JOIN users u ON i.created_by = u.id
      LEFT JOIN users a ON i.assigned_to = a.id
      LEFT JOIN users r ON i.resolved_by = r.id
      WHERE i.project_id = $1
    `;
    const params = [projectId];

    if (filters.status) {
      query += ` AND i.status = $${params.length + 1}`;
      params.push(filters.status);
    }

    query += ` ORDER BY i.created_at DESC`;
    const result = await pool.query(query, params);
    return result.rows;
  }

  async getIssueById(id) {
    const result = await pool.query(`
      SELECT i.*, TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date_text, COALESCE(i.author_name, u.full_name) as created_by_name
      FROM issues i
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.id = $1
    `, [id]);
    return result.rows[0];
  }

  async createIssue(data) {
    const { project_id, title, description, severity, created_by, issue_code, due_date, source_type } = data;
    const id = data.id || randomUUID();
    const result = await pool.query(`
      INSERT INTO issues (id, project_id, title, description, details, severity, status, created_by, issue_code, due_date, source_type, created_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'OPEN', $7, $8, $9, $10, NOW())
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `, [id, project_id, title, description, JSON.stringify(data.details || {}), severity, created_by, issue_code || null, due_date || null, source_type || null]);
    if (result.rows[0]) return { issue: result.rows[0], created: true };
    return { issue: await this.getIssueById(id), created: false };
  }

  async assignIssue(id, assigned_to) {
    const result = await pool.query(`
      UPDATE issues
      SET assigned_to = $1, assigned_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [assigned_to, id]);
    return result.rows[0];
  }

  async resolveIssue(id, resolved_by, resolution_note, data) {
    const result = await pool.query(`
      UPDATE issues
      SET status = 'RESOLVED', resolved_by = $1, resolved_at = NOW(), resolution_note = $2, updated_at = NOW()
      WHERE id = $3 AND status = 'OPEN' AND row_version = $4
      RETURNING *
    `, [resolved_by, resolution_note, id, expectedVersion(data)]);
    if (result.rows[0]) return { issue: result.rows[0], changed: true };
    const current = await this.getIssueById(id);
    if (current && current.row_version !== data.expected_row_version) requireUpdated(null);
    return { issue: current, changed: false };
  }

  async updateIssue(id, data) {
    const { title, description, severity, issue_code, due_date, source_type } = data;
    const result = await pool.query(`
      UPDATE issues
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          severity = COALESCE($3, severity),
          issue_code = COALESCE($4, issue_code),
          due_date = COALESCE($5, due_date),
          source_type = COALESCE($6, source_type),
          details = COALESCE($7::jsonb, details),
          updated_at = NOW()
      WHERE id = $8 AND row_version = $9
      RETURNING *
    `, [title, description, severity, issue_code, due_date || null, source_type, data.details === undefined ? null : JSON.stringify(data.details || {}), id, expectedVersion(data)]);
    return requireUpdated(result.rows[0]);
  }

  async reopenIssue(id, reopenedBy, data) {
    const result = await pool.query(`
      UPDATE issues
      SET status = 'OPEN', resolved_by = NULL, resolved_at = NULL, resolution_note = NULL, updated_at = NOW()
      WHERE id = $1 AND row_version = $2
      RETURNING *
    `, [id, expectedVersion(data)]);
    return requireUpdated(result.rows[0]);
  }

  async deleteIssue(id) {
    await pool.query(`DELETE FROM issues WHERE id = $1`, [id]);
  }

  // Tệp đính kèm (bản ký/scan) — lưu nhị phân qua fileStore, giống project_personnel_files/document_files.
  async listFiles(issueId) {
    return (await pool.query(`SELECT id, category, file_name, file_type, file_size, uploaded_at
      FROM issue_files WHERE issue_id=$1 ORDER BY uploaded_at, id`, [issueId])).rows;
  }

  async addFile(issue, category, name, type, buffer, userId) {
    const stored = await fileStore.put(buffer);
    return (await pool.query(`INSERT INTO issue_files
      (issue_id, project_id, category, file_name, file_type, file_size, sha256, storage_key, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (issue_id, sha256) DO UPDATE SET file_name=EXCLUDED.file_name, category=EXCLUDED.category
      RETURNING id, category, file_name, file_type, file_size, uploaded_at, (xmax=0) AS created`,
    [issue.id, issue.project_id, category, name, type, buffer.length, stored.sha256, stored.storageKey, userId])).rows[0];
  }

  async getFile(issueId, fileId) {
    const row = (await pool.query('SELECT file_name,file_type,storage_key FROM issue_files WHERE issue_id=$1 AND id=$2', [issueId, fileId])).rows[0];
    if (!row) return null;
    const buffer = await fileStore.get(row.storage_key);
    return buffer ? { name: row.file_name, type: row.file_type, buffer } : null;
  }
}

module.exports = new IssueService();

