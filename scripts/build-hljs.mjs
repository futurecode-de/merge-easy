import { build } from 'esbuild';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const code = `
import hljs from 'highlight.js/lib/core';
import php from 'highlight.js/lib/languages/php';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';
['php','javascript','typescript','python','java','css','xml','json','bash','sql','go','yaml']
  .forEach((l, i) => hljs.registerLanguage(l, [php,javascript,typescript,python,java,css,xml,json,bash,sql,go,yaml][i]));
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('yml', yaml);
export default hljs;
`;

await build({
  stdin: { contents: code, resolveDir: process.cwd() },
  bundle: true,
  format: 'iife',
  globalName: 'hljs',
  minify: true,
  outfile: 'media/vendor/highlight.min.js',
});
