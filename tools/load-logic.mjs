import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export function loadLogic() {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const start = '// ===== LOGIC START =====', end = '// ===== LOGIC END =====';
  assert.equal(html.split(start).length, 2, 'LOGIC STARTは1か所');
  assert.equal(html.split(end).length, 2, 'LOGIC ENDは1か所');
  const source = html.split(start)[1].split(end)[0];
  assert(!/\b(state|view|document|window|Sound|canvas|localStorage)\b/.test(source), 'LOGICは画面・保存・全体状態に触れない');
  const config = html.slice(html.indexOf('const CONFIG ='), html.indexOf('// ===== DATA ====='));
  const data = html.slice(html.indexOf('// ===== DATA ====='), html.indexOf('// ===== UTIL ====='));
  const context = vm.createContext({});
  vm.runInContext(config + data + source, context, { timeout: 5000, filename: 'index.html:LOGIC' });
  return vm.runInContext('({ logic: LOGIC, config: CONFIG, chars: CHARS, dungeons: DUNGEONS })', context);
}
export const plain = (value) => JSON.parse(JSON.stringify(value));

export function loadSaveAdapter(storage) {
  const html=readFileSync(fileURLToPath(new URL('../index.html',import.meta.url)),'utf8');
  const config=html.slice(html.indexOf('const CONFIG ='),html.indexOf('// ===== DATA ====='));
  const data=html.slice(html.indexOf('// ===== DATA ====='),html.indexOf('// ===== UTIL ====='));
  const logic=html.split('// ===== LOGIC START =====')[1].split('// ===== LOGIC END =====')[0];
  const save=html.slice(html.indexOf('// ===== SAVE ====='),html.indexOf('// ===== BATTLE =====',html.indexOf('// ===== SAVE =====')));
  const context=vm.createContext({localStorage:storage});
  vm.runInContext(config+data+logic+'\nconst reducedMotion=()=>false;\n'+save,context,{timeout:5000});
  return vm.runInContext('({saveData,writeSave,importSaveText})',context);
}

export function loadQualityPolicy() {
 const html=readFileSync(fileURLToPath(new URL('../index.html',import.meta.url)),'utf8');
 const config=html.slice(html.indexOf('const CONFIG ='),html.indexOf('// ===== DATA ====='));
 const source=html.split('// ===== QUALITY START =====')[1].split('// ===== QUALITY END =====')[0];
 const context=vm.createContext({});
 vm.runInContext(config+source,context);
 return vm.runInContext('({sampleQuality,config:CONFIG})',context);
}
