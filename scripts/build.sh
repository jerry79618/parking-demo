#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"
rm -rf "$dist_root"
mkdir -p "$dist_root/server"
PROJECT_ROOT="$project_root" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.PROJECT_ROOT;
const template = fs.readFileSync(path.join(root, 'worker/index.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const marker = 'const PAGE = __PAGE__;';
if (!template.includes(marker)) throw new Error('Worker HTML marker is missing');
const output = template.replace(marker, `const PAGE = ${JSON.stringify(page)};`);
fs.writeFileSync(path.join(root, 'dist/server/index.js'), output);
const manifest = path.join(root, '.openai/hosting.json');
if (fs.existsSync(manifest)) {
  fs.mkdirSync(path.join(root, 'dist/.openai'), { recursive: true });
  fs.copyFileSync(manifest, path.join(root, 'dist/.openai/hosting.json'));
}
NODE

echo "Built $dist_root/server/index.js"
