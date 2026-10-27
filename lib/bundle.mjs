// 把「引擎 + 排序层」拼成浏览器能用的 IIFE 源码。
// 构建脚本用它产出离线 HTML，自检用它验证浏览器那条路径没被改坏——
// 同一个函数，才不会出现「构建能过、自检测的是另一份」。
import fs from 'node:fs';
import path from 'node:path';

// 浏览器端要拿到的名字。新增给页面用的函数，记得加进来。
export const DH_NAMES = [
  'normalize', 'splitSentences', 'matchLexicon', 'matchRules', 'cluster', 'waterIndex',
  'candidates', 'detectRegister', 'missingFields', 'scanText', 'segments', 'CHECKLISTS',
  'bearingOfSentence', 'relationTo', 'PARTY_NAMES',
  'RANK', 'rankOf', 'CONSEQUENCE_NAMES', 'consequenceOf', 'consequenceKey', 'bigrams', 'jaccard',
  'dedupeCandidates', 'titleOf', 'plainOf', 'preparePool', 'sortPool', 'pickTop', 'buildOfflineReport',
];

const strip = (s) => s.replace(/^export\s+/gm, '');

export function buildEngineBundle(root) {
  const engineSrc = fs.readFileSync(path.join(root, 'lib/engine.mjs'), 'utf8');
  const rankSrc = fs.readFileSync(path.join(root, 'lib/rank.mjs'), 'utf8');
  return '(function(){\n' + strip(engineSrc) + '\n' + strip(rankSrc)
    + '\nwindow.DH={' + DH_NAMES.join(',') + '};\n})();';
}

// 在 Node 里造一个假 window，拿到和浏览器一模一样的 DH 对象
export function loadDH(root) {
  const win = {};
  new Function('window', buildEngineBundle(root))(win);
  return win.DH;
}
