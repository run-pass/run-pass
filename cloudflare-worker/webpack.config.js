const path = require('path')

module.exports = {
  entry: './src/index.ts',
  devtool: 'cheap-module-source-map',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.(png|pem)$/i,
        use: [
          {
            loader: 'raw-loader',
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.pem', '.png'],
  },
  output: {
    filename: 'worker.js',
    path: path.resolve(__dirname, 'dist'),
  },
  node: {
    fs: 'empty',
  },
}
