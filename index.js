#!/usr/bin/env node
'use strict';

// dupscan — 零依赖单文件重复代码块检测 CLI（family 第八轴：重复代码）
// 扫 JS/TS 生态，用逐字符 tokenizer 剥离注释/字符串后做行级 n-gram 滑动窗口重复块检测。

const fs = require('fs');
const path = require('path');

const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.vue', '.svelte']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'vendor']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const NUM_FLAGS = new Set(['--min-lines', '--max-issues', '--max-lines']);
const STR_FLAGS = new Set(['--root']);
const BOOL_FLAGS = new Set(['--fail-on-high', '--json', '-h', '--help', '-V', '--version']);

// 逐字符 tokenizer：把注释与字符串字面量位置变空格，但保留换行（行号对齐）。
// 含正则上下文感知，避免 /regex/ 内的引号误触发字符串态（secscan 方法沉淀）。
function stripNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prev = '';
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && next === '*') {
      out += ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += (src[i] === '\n') ? '\n' : ' ';
        i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '/' && isRegexStart(prev)) {
      out += '/'; i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += ch; i++; if (i < n) { out += src[i]; i++; } continue; }
        if (ch === '[') { inClass = true; out += ch; i++; continue; }
        if (ch === ']') { inClass = false; out += ch; i++; continue; }
        if (ch === '\n') { out += '\n'; i++; continue; }
        if (ch === '/' && !inClass) { out += ch; i++; break; }
        out += ch; i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) { out += src[i]; i++; }
      prev = '/';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += '_'; i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '\n' && quote !== '`') break;
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function isRegexStart(prev) {
  if (prev === '') return true;
  return '=([{,`:!&|?;'.includes(prev) || '()}+*~^%'.includes(prev);
}

function normalizeLine(s) {
  const t = s.trim();
  if (!t) return '';
  return t.replace(/\s+/g, ' ');
}

function collectFiles(root) {
  const result = [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return EXT.has(path.extname(root)) ? [root] : [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile() && EXT.has(path.extname(e.name))) {
        result.push(path.join(dir, e.name));
      }
    }
  };
  walk(root);
  return result;
}

// 把文件内容转成（归一化行, 原始行号）列表，空行跳过用于比较但保留行号锚点。
function buildLines(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length > MAX_FILE_BYTES) return null;
  const stripped = stripNoise(buf.toString('utf8'));
  const rawLines = stripped.split('\n');
  const norm = [];
  const rawNo = [];
  for (let i = 0; i < rawLines.length; i++) {
    const nl = normalizeLine(rawLines[i]);
    if (!nl) continue;
    norm.push(nl);
    rawNo.push(i + 1);
  }
  return { norm, rawNo };
}

function detectDuplicates(files, minLines) {
  const winMap = new Map();
  const perFile = [];
  for (const f of files) {
    const built = buildLines(f);
    if (!built) { perFile.push({ file: f, norm: [], rawNo: [], skip: true }); continue; }
    perFile.push({ file: f, norm: built.norm, rawNo: built.rawNo, skip: false });
    const { norm } = built;
    const L = norm.length;
    if (L < minLines) continue;
    for (let i = 0; i + minLines <= L; i++) {
      const key = norm.slice(i, i + minLines).join('\n');
      let arr = winMap.get(key);
      if (!arr) { arr = []; winMap.set(key, arr); }
      arr.push({ file: f, startIdx: i });
    }
  }
  // 标记重复行：某行属于一个出现≥2次的窗口即标记
  const fileIdx = new Map();
  perFile.forEach((p, i) => fileIdx.set(p.file, i));
  const mark = perFile.map((p) => new Array(p.norm.length).fill(false));
  let dupWindows = 0;
  for (const [, group] of winMap) {
    if (group.length < 2) continue;
    dupWindows++;
    for (const g of group) {
      const idx = fileIdx.get(g.file);
      for (let j = g.startIdx; j < g.startIdx + minLines; j++) mark[idx][j] = true;
    }
  }
  // 合并连续标记区间 → 块，并按块 key 跨文件聚合
  const blocks = [];
  for (let fi = 0; fi < perFile.length; fi++) {
    const p = perFile[fi];
    if (p.skip) continue;
    let j = 0;
    while (j < p.norm.length) {
      if (mark[fi][j]) {
        const s = j;
        while (j < p.norm.length && mark[fi][j]) j++;
        const e = j - 1;
        const key = p.norm.slice(s, e + 1).join('\n');
        blocks.push({ file: p.file, start: p.rawNo[s], end: p.rawNo[e], key, lines: e - s + 1 });
      } else j++;
    }
  }
  const keyGroups = new Map();
  for (const b of blocks) {
    let arr = keyGroups.get(b.key);
    if (!arr) { arr = []; keyGroups.set(b.key, arr); }
    arr.push(b);
  }
  const groups = [];
  for (const [key, occ] of keyGroups) {
    if (occ.length < 2) continue;
    const files = new Set(occ.map((o) => o.file));
    const crossFile = files.size >= 2;
    const copies = occ.length;
    const lines = occ[0].lines;
    let sev;
    if (lines >= 15 || crossFile || copies >= 4) sev = 'high';
    else if (lines >= 8 || copies >= 2) sev = 'medium';
    else sev = 'low';
    groups.push({ key, occurrences: occ, copies, lines, crossFile, severity: sev });
  }
  groups.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return b.lines * b.copies - a.lines * a.copies;
  });
  return { groups, dupWindows };
}

function computeHealth(groups, totalLines) {
  if (totalLines === 0) return 100;
  let extra = 0;
  for (const g of groups) extra += g.lines * (g.copies - 1);
  const ratio = extra / totalLines;
  return Math.max(0, Math.min(100, Math.round(100 - ratio * 200)));
}

function parseArgs(argv) {
  const opts = {
    root: null,
    minLines: 5,
    maxIssues: null,
    maxLines: null,
    failOnHigh: false,
    json: false,
    help: false,
    version: false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '-V' || a === '--version') { opts.version = true; continue; }
    if (a === '--fail-on-high') { opts.failOnHigh = true; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (NUM_FLAGS.has(a)) {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v)) { throw new Error('flag ' + a + ' needs a valid integer'); }
      if (a === '--min-lines') opts.minLines = v;
      else if (a === '--max-issues') opts.maxIssues = v;
      else if (a === '--max-lines') opts.maxLines = v;
      continue;
    }
    if (STR_FLAGS.has(a)) { opts.root = argv[++i]; continue; }
    if (a.startsWith('-')) { throw new Error('unknown flag: ' + a); }
    positionals.push(a);
  }
  if (opts.root === null && positionals.length > 0) opts.root = positionals[0];
  if (opts.root === null) opts.root = process.cwd();
  return opts;
}

function severityLabel(s) {
  return s === 'high' ? 'HIGH' : s === 'medium' ? 'MED ' : 'low ';
}

function formatReport(groups, health, totalLines, scanned, root) {
  let extra = 0;
  for (const g of groups) extra += g.lines * (g.copies - 1);
  const pct = totalLines ? ((extra / totalLines) * 100).toFixed(1) : '0.0';
  const lines = [];
  lines.push('dupscan · 重复代码扫描');
  lines.push('root: ' + root);
  lines.push('scanned files: ' + scanned + '  total lines: ' + totalLines);
  lines.push('health score: ' + health + '/100');
  lines.push('duplicate lines: ' + extra + ' (' + pct + '%)');
  lines.push('');
  if (groups.length === 0) {
    lines.push('no duplicate blocks found (>= min-lines).');
    return lines.join('\n');
  }
  lines.push('duplicate blocks: ' + groups.length);
  lines.push('');
  for (const g of groups) {
    lines.push('[' + severityLabel(g.severity) + '] ' + g.lines + ' lines x' + g.copies +
      (g.crossFile ? ' (cross-file)' : '') + '  severity weight ' + sevWeight(g));
    for (const o of g.occurrences) {
      lines.push('    ' + o.file + ':' + o.start + '-' + o.end);
    }
  }
  return lines.join('\n');
}

function sevWeight(g) {
  return { high: 3, medium: 2, low: 1 }[g.severity];
}

function toJson(groups, health, totalLines, scanned, root) {
  let extra = 0;
  for (const g of groups) extra += g.lines * (g.copies - 1);
  return JSON.stringify({
    root,
    health,
    totalLines,
    scanned,
    duplicateLines: extra,
    duplicateBlocks: groups.length,
    blocks: groups.map((g) => ({
      severity: g.severity,
      lines: g.lines,
      copies: g.copies,
      crossFile: g.crossFile,
      occurrences: g.occurrences.map((o) => ({ file: o.file, start: o.start, end: o.end })),
    })),
  }, null, 2);
}

function run(argv) {
  let opts;
  try { opts = parseArgs(argv); }
  catch (e) {
    process.stderr.write('error: ' + e.message + '\n');
    process.exit(2);
    return;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (opts.version) {
    process.stdout.write('dupscan 1.0.0\n');
    return;
  }
  let files;
  try { files = collectFiles(opts.root); }
  catch (e) {
    process.stderr.write('error: cannot read root ' + opts.root + ': ' + e.message + '\n');
    process.exit(2);
    return;
  }
  if (!fs.existsSync(opts.root)) {
    process.stderr.write('error: root not found: ' + opts.root + '\n');
    process.exit(2);
    return;
  }
  const { groups, dupWindows } = detectDuplicates(files, opts.minLines);
  let totalLines = 0;
  for (const f of files) {
    const built = buildLines(f);
    if (built) totalLines += built.rawNo.length;
  }
  const health = computeHealth(groups, totalLines);
  if (opts.json) {
    process.stdout.write(toJson(groups, health, totalLines, files.length, opts.root) + '\n');
  } else {
    process.stdout.write(formatReport(groups, health, totalLines, files.length, opts.root) + '\n');
  }
  let failed = false;
  if (opts.maxIssues != null && groups.length > opts.maxIssues) failed = true;
  if (opts.maxLines != null) {
    let extra = 0;
    for (const g of groups) extra += g.lines * (g.copies - 1);
    if (extra > opts.maxLines) failed = true;
  }
  if (opts.failOnHigh && groups.some((g) => g.severity === 'high')) failed = true;
  if (failed) process.exit(1);
}

const USAGE = [
  'dupscan — zero-dependency duplicate code block detector',
  '',
  'usage: dupscan [root] [options]',
  '',
  'options:',
  '  --root <dir>        scan target (default: cwd)',
  '  --min-lines <n>     min consecutive duplicate lines (default 5)',
  '  --max-issues <n>    fail CI if duplicate blocks > n',
  '  --max-lines <n>     fail CI if extra duplicate lines > n',
  '  --fail-on-high      fail CI if any HIGH block exists',
  '  --json              machine-readable output',
  '  -V, --version       print version',
  '  -h, --help          print help',
  '',
  'exit: 0 clean | 1 CI gate failed | 2 usage error',
].join('\n');

module.exports = {
  stripNoise,
  normalizeLine,
  collectFiles,
  buildLines,
  detectDuplicates,
  computeHealth,
  parseArgs,
  formatReport,
  toJson,
  severityLabel,
  sevWeight,
  EXT,
};

if (require.main === module) {
  run(process.argv.slice(2));
}
