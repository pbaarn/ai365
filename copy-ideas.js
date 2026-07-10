import fs from 'fs';

try {
  fs.copyFileSync('idee.md', 'dist/idee.md');
  console.log('Successfully copied idee.md to dist/idee.md');
} catch (err) {
  console.error('Error copying idee.md:', err);
  process.exit(1);
}
