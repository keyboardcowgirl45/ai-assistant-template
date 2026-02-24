const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'memory.json');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function ensureFile() {
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ global: [] }, null, 2));
  }
}

function readMemory() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    return { global: [] };
  }
}

function writeMemory(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

function archiveIfNeeded() {
  ensureFile();
  const stats = fs.statSync(MEMORY_FILE);
  if (stats.size >= MAX_FILE_SIZE) {
    const now = new Date();
    const archiveName = `memory-archive-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.json`;
    const archivePath = path.join(__dirname, archiveName);
    fs.copyFileSync(MEMORY_FILE, archivePath);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ global: [] }, null, 2));
    console.log(`[memory] Archived to ${archiveName}`);
  }
}

function loadRecent(userId, n = 20) {
  const data = readMemory();
  const turns = data.global
    .filter(t => t.discord_id === userId)
    .slice(-n);
  return formatForPrompt(turns);
}

function append(userId, username, message, response) {
  archiveIfNeeded();
  const data = readMemory();
  data.global.push({
    timestamp: new Date().toISOString(),
    user: username,
    discord_id: userId,
    message,
    response
  });
  writeMemory(data);
}

function formatForPrompt(turns) {
  if (!turns.length) return '';
  return turns.map(t =>
    `${t.user}: ${t.message}\nJanet: ${t.response}`
  ).join('\n\n');
}

module.exports = { loadRecent, append, formatForPrompt };
