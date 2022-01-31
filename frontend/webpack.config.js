const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = {
  target: "web",
  entry: "./src/index.tsx",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
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
    filename: "bundle.js",
    path: path.resolve(__dirname, "../docs"),
  },
  plugins: [new HtmlWebpackPlugin({ template: "./src/index.html", favicon: "./src/assets/favicon.ico" })],
};
