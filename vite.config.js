import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Inline the built CSS into <style> in index.html — keeps the zero
// render-blocking-request optimization from the old build.mjs.
function inlineCssPlugin() {
  return {
    name: 'inline-css-into-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const cssAssets = Object.values(bundle).filter(
        (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css')
      );
      const htmlAsset = bundle['index.html'];
      if (!htmlAsset || cssAssets.length === 0) {
        throw new Error('inline-css: expected index.html and at least one CSS asset in the bundle');
      }

      let html = htmlAsset.source.toString();
      for (const css of cssAssets) {
        const linkPattern = new RegExp(`<link[^>]*href="[^"]*${css.fileName.split('/').pop()}"[^>]*>`);
        if (!linkPattern.test(html)) {
          throw new Error(`inline-css: could not find <link> tag for ${css.fileName}`);
        }
        html = html.replace(linkPattern, `<style>${css.source.toString()}</style>`);
        delete bundle[css.fileName];
      }
      htmlAsset.source = html;
    },
  };
}

export default defineConfig({
  root: 'src',
  // src/public is copied verbatim to the output root: sw.js, manifest.json,
  // sounds/, images/, downloads/, js/keepAlive.js (worker loaded by URL).
  publicDir: 'public',
  build: {
    // Vercel auto-detects Vite and serves the framework output directory
    // (vercel.json#outputDirectory) — the legacy routes-to-/public model
    // no longer applies once a vite.config exists.
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable, hash-free names: sw.js precaches fixed paths and is
        // hand-written; its network-first strategy makes hashes unnecessary.
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  // Same console stripping the old terser config did.
  esbuild: {
    pure: ['console.log', 'console.info', 'console.debug'],
  },
  plugins: [tailwindcss(), inlineCssPlugin()],
});
