// Gera um ícone 32x32 verde para a bandeja do sistema
import { createCanvas } from "canvas"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

try {
    const { createCanvas: cc } = await import("canvas")
    const canvas = cc(32, 32)
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#25d366"
    ctx.beginPath()
    ctx.arc(16, 16, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#fff"
    ctx.font = "bold 18px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("W", 16, 17)
    fs.writeFileSync(path.join(__dirname, "assets", "tray.png"), canvas.toBuffer("image/png"))
    console.log("Ícone criado")
} catch {
    console.log("canvas não disponível, usando ícone embutido")
}
