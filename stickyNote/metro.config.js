const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add Node.js core module polyfills
config.resolver.extraNodeModules = {
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
  events: require.resolve('events'),
  process: require.resolve('process/browser'),
};

module.exports = config;
