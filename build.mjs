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
                await execPromise(`npx terser ${inputFile} -o ${outputFile} --compress 'drop_console=true' --mangle --toplevel --output ${outputFile}`);
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

async function buildV2() {
    const v2Src = path.join(srcFolder, "v2");
    const v2Dist = path.join(distFolder, "v2");

    try {
        // Check if v2 folder exists
        if (!await fs.pathExists(v2Src)) {
            console.log("⏭️  No src/v2 folder — skipping v2 build");
            return;
        }

        // Copy everything first
        await fs.copy(v2Src, v2Dist);

        // Minify v2/index.html (inline CSS like v1)
        const v2HtmlPath = path.join(v2Dist, "index.html");
        if (await fs.pathExists(v2HtmlPath)) {
            let htmlContent = await fs.readFile(v2HtmlPath, "utf8");

            // v2 references ../css/output.css — inline it
            const cssPath = path.join(srcFolder, "css", "output.css");
            const cssContent = await fs.readFile(cssPath, "utf8");
            const cssLinkPattern = /<link[^>]*href="[^"]*output\.css"[^>]*>/;
            if (cssLinkPattern.test(htmlContent)) {
                htmlContent = htmlContent.replace(cssLinkPattern, `<style>${cssContent}</style>`);
            }

            const minifiedHtml = await minify(htmlContent, {
                collapseWhitespace: true,
                removeComments: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true,
                minifyJS: true,
                minifyCSS: true
            });
            await fs.writeFile(v2HtmlPath, minifiedHtml);
        }

        // Minify v2 JS files
        const v2JsFolder = path.join(v2Dist, "js");
        if (await fs.pathExists(v2JsFolder)) {
            const files = await fs.readdir(v2JsFolder);
            for (const file of files) {
                if (file.endsWith(".js")) {
                    const filePath = path.join(v2JsFolder, file);
                    // v2 uses ES modules — keep module structure, just compress
                    await execPromise(`npx terser ${filePath} -o ${filePath} --compress 'drop_console=true' --mangle --module`);
                    console.log(`✅ Minified v2: ${file}`);
                }
            }
        }

        console.log("✅ Built v2");
    } catch (error) {
        console.error("❌ Error building v2:", error);
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
    await buildV2();        // 3. Copy + minify v2
    console.log("🎉 Build complete!");
}

build();
