const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = {
  mode: "production", // Enable production optimizations
  target: "web",
  entry: "./src/index.tsx",
  cache: {
    type: "filesystem", // Enable persistent caching
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "thread-loader",
            options: {
              workers: 2, // Adjust based on CPU cores
            },
          },
          {
            loader: "ts-loader",
            options: {
              happyPackMode: true, // Enable for thread-loader compatibility
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "bundle.[contenthash].js", // Cache-busting
    path: path.resolve(__dirname, "./dist"),
    clean: true, // Clean output dir before emit
  },
  optimization: {
    splitChunks: {
      chunks: "all", // Code splitting for all chunks
    },
    runtimeChunk: "single", // Separate runtime chunk
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      favicon: "./src/assets/favicon.ico",
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
    }),
  ],
};
