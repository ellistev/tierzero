import fs from 'fs';
let b = fs.readFileSync('C:/Users/steve/projects/tierzero/src/workflows/git-ops.ts', 'utf8');
b = b.replace('this.exec(`git checkout -b ${name}`);', 'try { this.exec(`git checkout -b ${name}`); } catch { this.exec(`git checkout ${name}`); }');
fs.writeFileSync('C:/Users/steve/projects/tierzero/src/workflows/git-ops.ts', b);