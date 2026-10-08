import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(new URL('../../package.json', import.meta.url));
const root = resolve(new URL('../..', import.meta.url).pathname);
export function loadTs(file, mocks = {}) {
    const filename = resolve(root, file); const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
        if (name in mocks) return mocks[name];
        if (name.startsWith('@/') || name.startsWith('.')) {
            const path = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(filename), name);
            return loadTs(extname(path) ? path : existsSync(path + '.ts') ? path + '.ts' : path + '.tsx', mocks);
        }
        return require(name);
    };
    vm.runInNewContext('(function(require,module,exports){'+output+'})', { console, process, Buffer, crypto, File, Uint8Array, URL, URLSearchParams, setTimeout, clearTimeout })(localRequire, module, module.exports);
    return module.exports;
}
