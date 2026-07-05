const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname);
const report = [];
function inspect(p) {
  try {
    const stat = fs.lstatSync(p);
    report.push(`${p} exists; dir=${stat.isDirectory()}; file=${stat.isFile()}; size=${stat.size}`);
  } catch (err) {
    report.push(`${p} missing; ${err.code}`);
  }
}
inspect(path.join(root, 'server', 'routes'));
inspect(path.join(root, 'server', 'data'));
inspect(path.join(root, 'public'));
try {
  const routesPath = path.join(root, 'server', 'routes');
  if (fs.existsSync(routesPath) && !fs.lstatSync(routesPath).isDirectory()) {
    fs.unlinkSync(routesPath);
    report.push('deleted malformed routes file');
  }
} catch (err) {
  report.push('delete routes error: ' + err.message);
}
try {
  const dataPath = path.join(root, 'server', 'data');
  if (fs.existsSync(dataPath) && !fs.lstatSync(dataPath).isDirectory()) {
    fs.unlinkSync(dataPath);
    report.push('deleted malformed data file');
  }
} catch (err) {
  report.push('delete data error: ' + err.message);
}
try {
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  report.push('created public dir');
  fs.mkdirSync(path.join(root, 'server', 'routes'), { recursive: true });
  report.push('created server/routes dir');
  fs.mkdirSync(path.join(root, 'server', 'data'), { recursive: true });
  report.push('created server/data dir');
} catch (err) {
  report.push('mkdir error: ' + err.message);
}
fs.writeFileSync(path.join(root, 'fix_routes_dir_report.txt'), report.join('\n'), 'utf8');
console.log(report.join('\n'));
