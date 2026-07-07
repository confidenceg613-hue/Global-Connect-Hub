const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};

// Block Metro from watching temp directories created by @expo/vector-icons postinstall
config.resolver.blockList = [
  /node_modules\/.*_tmp_\d+\/.*/,
  /_tmp_\d+/,
];

// Allow Metro to resolve .gguf model files if bundled as assets (optional)
// Models downloaded at runtime don't need this — only compile-time bundled ones.
config.resolver.assetExts = [
  ...(config.resolver.assetExts || []),
  'gguf',
  'bin',
];

// llama.rn ships pre-built native binaries — ensure Metro resolves its package correctly
config.resolver.sourceExts = [
  ...(config.resolver.sourceExts || []),
  'mjs',
];

module.exports = config;
