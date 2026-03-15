import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { minify } from "html-minifier-terser";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srcFolder = path.join(__dirname, "src");
const distFolder = path.join(__dirname, "public");

async function minifyHTML() {
    const htmlPath = path.join(srcFolder, "index.html");
    const distHtmlPath = path.join(distFolder, "index.html");
    const cssPath = path.join(srcFolder, "css", "output.css");

    try {
        let htmlContent = await fs.readFile(htmlPath, "utf8");

        // Inline CSS to eliminate render-blocking request
        const cssContent = await fs.readFile(cssPath, "utf8");
        const cssLinkPattern = /<link[^>]*href="[^"]*output\.css"[^>]*>/;
        if (!cssLinkPattern.test(htmlContent)) {
            throw new Error('Could not find CSS <link> tag to inline — check src/index.html');
        }
        htmlContent = htmlContent.replace(cssLinkPattern, `<style>${cssContent}</style>`);

        const minifiedHtml = await minify(htmlContent, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            minifyJS: true,
            minifyCSS: true
        });

        await fs.mkdir(distFolder, { recursive: true });
        await fs.writeFile(distHtmlPath, minifiedHtml);
        console.log("✅ Minified index.html (with inlined CSS)");
    } catch (error) {
        console.error("❌ Error minifying HTML:", error);
    }
}

async function minifyJS() {
    const jsSrcFolder = path.join(srcFolder, "js");
    const jsDistFolder = path.join(distFolder, "js");

    try {
        await fs.mkdir(jsDistFolder, { recursive: true });

        const files = await fs.readdir(jsSrcFolder);
        for (const file of files) {
            if (file.endsWith(".js")) {
                const inputFile = path.join(jsSrcFolder, file);
                const outputFile = path.join(jsDistFolder, file);
                await execPromise(`npx terser ${inputFile} -o ${outputFile} --compress 'pure_funcs=["console.log","console.info","console.debug"]' --mangle --toplevel --output ${outputFile}`);
                console.log(`✅ Minified & Obfuscated (Strong): ${file}`);
            }
        }
    } catch (error) {
        console.error("❌ Error minifying JS:", error);
    }
}

async function copyAssets() {
    try {
        await fs.copy(path.join(srcFolder, "images"), path.join(distFolder, "images"));
        await fs.copy(path.join(srcFolder, "sounds"), path.join(distFolder, "sounds"));
        await fs.copy(path.join(srcFolder, "manifest.json"), path.join(distFolder, "manifest.json"));
        await fs.copy(path.join(srcFolder, "sw.js"), path.join(distFolder, "sw.js"));
        await fs.copy(path.join(srcFolder, "css"), path.join(distFolder, "css"));
        console.log("✅ Copied images, sounds, sw.js, and manifest.json");
    } catch (error) {
        console.error("❌ Error copying assets:", error);
    }
}

async function buildCSS() {
    try {
        await execPromise(`npx tailwindcss -i ./src/css/input.css -o ./src/css/output.css --minify`);
        console.log("✅ Built CSS");
    } catch (error) {
        console.error("❌ Error building CSS:", error);
    }

}

async function build() {
    console.log("🚀 Starting build process...");
    await buildCSS();       // 1. Generate CSS first
    await minifyHTML();     // 2. Inline CSS into HTML, then minify
    await minifyJS();
    await copyAssets();
    console.log("🎉 Build complete!");
}

build();
