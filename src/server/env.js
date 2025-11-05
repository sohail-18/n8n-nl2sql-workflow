const fs = require('fs');
const path = require('path');

function parseEnv(content) {
  if (typeof content !== 'string') return {};
  const result = {};

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key) return;

    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  });

  return result;
}

function loadEnv({ cwd = process.cwd(), filename = '.env' } = {}) {
  const envPath = path.resolve(cwd, filename);
  let fileContent;

  try {
    fileContent = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    return {};
  }

  const parsed = parseEnv(fileContent);
  Object.keys(parsed).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = parsed[key];
    }
  });

  return parsed;
}

module.exports = {
  loadEnv,
  parseEnv
};
