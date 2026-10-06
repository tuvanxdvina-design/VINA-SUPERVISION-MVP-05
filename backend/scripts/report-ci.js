// Đưa kết quả thực của node:test vào annotations để Codex đọc qua GitHub API.
// Script này không thay exit code của runner; workflow vẫn exit bằng mã gốc.
const fs = require('node:fs');
const [file, suite, exitCode] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const escape = value => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const counts = text.split('\n').filter(line => /^ℹ (tests|pass|fail|cancelled|skipped|todo) \d+/.test(line.trim()));
console.log(`::notice title=${suite}::${escape(counts.join('\n') || 'Runner không có thống kê; xem log đầy đủ.')}`);
if (Number(exitCode)) {
  const lines = text.split('\n');
  const starts = lines.flatMap((line, index) => /^✖ /.test(line.trim()) ? [index] : []);
  if (!starts.length) console.log(`::error title=${suite}::${escape(text.slice(-7000))}`);
  for (const start of starts.slice(0, 15)) {
    console.log(`::error title=${suite}::${escape(lines.slice(start, start + 24).join('\n').slice(0, 7000))}`);
  }
}
