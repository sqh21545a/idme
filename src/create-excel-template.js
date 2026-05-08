#!/usr/bin/env node

const path = require('node:path');
const XLSX = require('xlsx');

function parseArgs(argv) {
  const args = { output: 'idme-accounts.xlsx' };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === '--output' && next) {
      args.output = next;
      index += 1;
    } else if (item.startsWith('--output=')) {
      args.output = item.slice('--output='.length);
    }
  }

  return args;
}

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolveProjectPath(args.output);
  const rows = [
    ['邮箱', '密码', 'HTTP Proxy', '登录状态', '记录时间', 'User Agent', 'MFA 验证方式'],
    ['sherra.lackey@skillcreations.com', 'Higgins33!', 'http://wXYSygNq:rIj4WNT75PF12hPb@us.proxy302.com:2222', '', '', '', ''],
  ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 34 },
    { wch: 24 },
    { wch: 58 },
    { wch: 36 },
    { wch: 24 },
    { wch: 128 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'accounts');
  XLSX.writeFile(workbook, outputPath);
  console.log(`[Template] created: ${outputPath}`);
}

main();
