const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Support wasm for expo-sqlite web fallback
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}

// Enable Cross-Origin Isolation for expo-sqlite WASM SharedArrayBuffer on Web
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => {
    return (req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      return metroMiddleware(req, res, next);
    };
  },
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
