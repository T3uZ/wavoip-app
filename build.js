import * as esbuild from "esbuild"

await esbuild.build({
    entryPoints: ["renderer/app.js"],
    bundle: true,
    outfile: "renderer/bundle.js",
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: true,
})

console.log("Build concluído → renderer/bundle.js")
