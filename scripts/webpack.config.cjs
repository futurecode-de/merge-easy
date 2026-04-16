const path = require('path');
module.exports = {
  entry: './media/vendor/hljs-entry.cjs',
  output: { path: path.resolve(__dirname, '..', 'media', 'vendor'), filename: 'highlight.min.js', library: 'hljs', libraryTarget: 'var' },
  mode: 'production',
};
