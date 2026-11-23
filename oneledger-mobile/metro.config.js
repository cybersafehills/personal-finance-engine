const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// This repository has separate lockfiles rather than npm workspaces. Expose
// only the framework-free financial contract, not the web dependency tree.
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../web/shared')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
module.exports = config;
