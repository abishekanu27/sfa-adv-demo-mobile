/**
 * patch-printer-driver.js
 * Automatically patches react-native-thermal-printer-driver during npm install / EAS Build:
 * 1. Enhances ImageProcessor.kt with alpha-blending for transparent PNGs (prevents solid black boxes)
 * 2. Centers images (align = 1) instead of hardcoding left alignment (align = 0)
 * 3. Adds align property to TypeScript definitions
 */

const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'node_modules', 'react-native-thermal-printer-driver');

if (!fs.existsSync(targetDir)) {
  console.log('[patch-printer-driver] react-native-thermal-printer-driver not found in node_modules, skipping.');
  process.exit(0);
}

// 1. Patch ImageProcessor.kt (Alpha blending over white paper background)
const imageProcessorPath = path.join(targetDir, 'android', 'src', 'main', 'java', 'com', 'thermalprinterdriver', 'image', 'ImageProcessor.kt');
if (fs.existsSync(imageProcessorPath)) {
  let content = fs.readFileSync(imageProcessorPath, 'utf8');
  if (!content.includes('alphaRatio')) {
    const oldCode = `                val px = bitmap.getPixel(x, y)
                val r = (px shr 16) and 0xFF
                val g = (px shr 8)  and 0xFF
                val b = px          and 0xFF
                // Luminance-weighted grayscale (ITU-R BT.601)
                gray[y * width + x] = (0.299f * r + 0.587f * g + 0.114f * b) / 255f`;

    const newCode = `                val px = bitmap.getPixel(x, y)
                val a = (px shr 24) and 0xFF
                val r = (px shr 16) and 0xFF
                val g = (px shr 8)  and 0xFF
                val b = px          and 0xFF
                // Transparent or semi-transparent pixels blended over white paper
                if (a < 64) {
                    gray[y * width + x] = 1.0f
                } else {
                    val alphaRatio = a / 255f
                    val compR = r * alphaRatio + 255f * (1f - alphaRatio)
                    val compG = g * alphaRatio + 255f * (1f - alphaRatio)
                    val compB = b * alphaRatio + 255f * (1f - alphaRatio)
                    gray[y * width + x] = (0.299f * compR + 0.587f * compG + 0.114f * compB) / 255f
                }`;

    if (content.includes(oldCode)) {
      content = content.replace(oldCode, newCode);
      fs.writeFileSync(imageProcessorPath, content, 'utf8');
      console.log('[patch-printer-driver] Successfully patched ImageProcessor.kt with alpha-blending.');
    }
  } else {
    console.log('[patch-printer-driver] ImageProcessor.kt is already patched with alpha-blending.');
  }
}

// 2. Patch src/index.ts (Support center alignment)
const srcIndexPath = path.join(targetDir, 'src', 'index.ts');
if (fs.existsSync(srcIndexPath)) {
  let content = fs.readFileSync(srcIndexPath, 'utf8');
  if (content.includes('width,\n              0,\n              true')) {
    content = content.replace(
      'width,\n              0,\n              true',
      "width,\n              ('align' in src && src.align === 'left') ? 0 : ('align' in src && src.align === 'right') ? 2 : 1,\n              true"
    );
    fs.writeFileSync(srcIndexPath, content, 'utf8');
    console.log('[patch-printer-driver] Successfully patched src/index.ts with image alignment.');
  }
}

// 3. Patch lib/module/index.js
const libIndexPath = path.join(targetDir, 'lib', 'module', 'index.js');
if (fs.existsSync(libIndexPath)) {
  let content = fs.readFileSync(libIndexPath, 'utf8');
  if (content.includes('width, 0, true')) {
    content = content.replace(
      'width, 0, true',
      "width, ('align' in src && src.align === 'left') ? 0 : ('align' in src && src.align === 'right') ? 2 : 1, true"
    );
    fs.writeFileSync(libIndexPath, content, 'utf8');
    console.log('[patch-printer-driver] Successfully patched lib/module/index.js with image alignment.');
  }
}

// 4. Patch types.ts
const typesPath = path.join(targetDir, 'src', 'document', 'types.ts');
if (fs.existsSync(typesPath)) {
  let content = fs.readFileSync(typesPath, 'utf8');
  if (!content.includes("align?: 'left' | 'center' | 'right'")) {
    content = content.replace(
      "export type ImageSource =\n  | { uri: string; width?: number }\n  | { base64: string; width?: number }\n  | { url: string; width?: number };",
      "export type ImageSource =\n  | { uri: string; width?: number; align?: 'left' | 'center' | 'right' }\n  | { base64: string; width?: number; align?: 'left' | 'center' | 'right' }\n  | { url: string; width?: number; align?: 'left' | 'center' | 'right' };"
    );
    fs.writeFileSync(typesPath, content, 'utf8');
    console.log('[patch-printer-driver] Successfully patched types.ts with align option.');
  }
}
