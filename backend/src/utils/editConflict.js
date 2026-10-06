function expectedVersion(data) {
  const version = data?.expected_row_version;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw Object.assign(new Error('Thiếu phiên bản bản ghi. Hãy giữ nội dung đang nhập và tải bản mới để đối chiếu.'), { status: 409, code: 'ROW_VERSION_REQUIRED' });
  }
  return version;
}
function requireUpdated(row) {
  if (!row) throw Object.assign(new Error('Nội dung đã được người khác cập nhật. Bản nhập của bạn vẫn được giữ; hãy sao chép hoặc xuất bản nháp, tải bản mới và đối chiếu trước khi lưu lại.'), { status: 409, code: 'EDIT_CONFLICT' });
  return row;
}
function sendEditError(res, error) {
  if (!['EDIT_CONFLICT', 'ROW_VERSION_REQUIRED'].includes(error.code)) return false;
  res.status(error.status).json({ code: error.code, error: error.message });
  return true;
}
module.exports = { expectedVersion, requireUpdated, sendEditError };
