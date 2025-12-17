module.exports = function(api) {
  api.cache(true);
  return {
    presets: [require.resolve('babel-preset-expo')],
    plugins: [
      [
        require.resolve('babel-plugin-module-resolver'),
        {
          alias: {
            crypto: 'crypto-browserify',
            stream: 'readable-stream',
            buffer: 'buffer',
            events: 'events',
            process: 'process/browser',
          },
        },
      ],
    ],
  };
};
