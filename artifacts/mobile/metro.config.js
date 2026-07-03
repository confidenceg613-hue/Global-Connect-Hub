const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Block Metro from watching temp directories created by @expo/vector-icons postinstall
// These _tmp_* directories are ephemeral and cause ENOENT crashes when Metro tries to watch them
config.resolver = config.resolver || {};
config.resolver.blockList = [
  /node_modules\/.*_tmp_\d+\/.*/,
  /_tmp_\d+/,
];

module.exports = config;
