// Rebuilds index.html from web/: node web/tests/build.js  (or: npm run build)
const { spawnSync } = require('child_process');
const path = require('path');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const r = spawnSync(PY, [path.join(__dirname, '..', 'build.py')], { stdio: 'inherit' });
process.exit(r.status || 0);
