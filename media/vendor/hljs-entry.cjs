const hljs = require('highlight.js/lib/core');
const langs = {
  php: require('highlight.js/lib/languages/php'),
  javascript: require('highlight.js/lib/languages/javascript'),
  typescript: require('highlight.js/lib/languages/typescript'),
  python: require('highlight.js/lib/languages/python'),
  java: require('highlight.js/lib/languages/java'),
  css: require('highlight.js/lib/languages/css'),
  xml: require('highlight.js/lib/languages/xml'),
  json: require('highlight.js/lib/languages/json'),
  bash: require('highlight.js/lib/languages/bash'),
  sql: require('highlight.js/lib/languages/sql'),
  go: require('highlight.js/lib/languages/go'),
  yaml: require('highlight.js/lib/languages/yaml'),
};
Object.entries(langs).forEach(([name, lang]) => hljs.registerLanguage(name, lang));
hljs.registerLanguage('ts', langs.typescript);
hljs.registerLanguage('js', langs.javascript);
hljs.registerLanguage('html', langs.xml);
hljs.registerLanguage('sh', langs.bash);
hljs.registerLanguage('yml', langs.yaml);
module.exports = hljs;
