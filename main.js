import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from "electron"
import { fileURLToPath } from "url"
import path from "path"
import updaterPkg from "electron-updater"
const { autoUpdater } = updaterPkg
import {
    listarContatos, criarContato, atualizarContato, deletarContato,
    listarRegistros, inserirRegistro, finalizarRegistro, estatisticas,
    getPool,
} from "./db.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win  = null
let tray = null

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupUpdater() {
    autoUpdater.autoDownload    = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on("update-available", (info) => {
        dialog.showMessageBox(win, {
            type:    "info",
            title:   "Atualização disponível",
            message: `Nova versão ${info.version} disponível.`,
            detail:  "Deseja baixar e instalar agora?",
            buttons: ["Baixar agora", "Depois"],
            defaultId: 0,
        }).then(({ response }) => {
            if (response === 0) autoUpdater.downloadUpdate()
        })
    })

    autoUpdater.on("update-not-available", () => {
        // silencioso — só notifica quando chamado pelo menu
        if (tray) tray.setToolTip("WaVoIP — Atualizado ✓")
    })

    autoUpdater.on("download-progress", (p) => {
        const pct = Math.round(p.percent)
        win?.setProgressBar(pct / 100)
        tray?.setToolTip(`WaVoIP — Baixando atualização ${pct}%`)
    })

    autoUpdater.on("update-downloaded", () => {
        win?.setProgressBar(-1)
        dialog.showMessageBox(win, {
            type:    "info",
            title:   "Pronto para instalar",
            message: "Atualização baixada.",
            detail:  "O app será reiniciado para instalar.",
            buttons: ["Instalar agora", "Na próxima vez"],
            defaultId: 0,
        }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall()
        })
    })

    autoUpdater.on("error", (err) => {
        console.error("Updater error:", err.message)
    })

    // Verifica a cada 4 horas em produção
    if (app.isPackaged) {
        autoUpdater.checkForUpdates()
        setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
    }
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
    const iconPath = path.join(__dirname, "assets", "tray.png")
    const icon     = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip("WaVoIP")

    const menu = Menu.buildFromTemplate([
        { label: "Abrir WaVoIP",        click: () => showWindow() },
        { type:  "separator" },
        { label: "Verificar atualização", click: () => {
            if (app.isPackaged) autoUpdater.checkForUpdates()
            else dialog.showMessageBox(win, { message: "Atualizações disponíveis apenas na versão instalada." })
        }},
        { type:  "separator" },
        { label: "Sair",                click: () => { app.isQuiting = true; app.quit() } },
    ])

    tray.setContextMenu(menu)
    tray.on("double-click", () => showWindow())
}

function showWindow() {
    if (!win) return
    win.show()
    win.focus()
    if (win.isMinimized()) win.restore()
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
    win = new BrowserWindow({
        width:  960,
        height: 700,
        minWidth:  800,
        minHeight: 600,
        title: "WaVoIP",
        show:  false, // inicia oculto — aparece via tray ou ao receber chamada
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
        },
    })

    win.loadFile(path.join(__dirname, "renderer", "index.html"))

    // Pronto: mostra a janela (na primeira abertura)
    win.once("ready-to-show", () => {
        // Em dev mostra direto; em produção fica na bandeja
        if (!app.isPackaged) win.show()
    })

    // X fecha para bandeja, não encerra o app
    win.on("close", (e) => {
        if (!app.isQuiting) {
            e.preventDefault()
            win.hide()
            tray?.displayBalloon({
                title:   "WaVoIP em segundo plano",
                content: "O app continua rodando. Clique duas vezes no ícone para reabrir.",
                iconType: "info",
            })
        }
    })

    // ── IPC: janela ───────────────────────────────────────────────────────────
    ipcMain.on("incoming-call", () => {
        showWindow()
        win.center()
        win.setAlwaysOnTop(true)
        setTimeout(() => win.setAlwaysOnTop(false), 4000)
        tray?.displayBalloon({
            title:   "📞 Chamada recebida",
            content: "Clique para atender no WaVoIP.",
            iconType: "info",
        })
    })

    ipcMain.on("call-ended", () => win.setAlwaysOnTop(false))

    // ── IPC: contatos ─────────────────────────────────────────────────────────
    ipcMain.handle("contatos:listar",    () => listarContatos())
    ipcMain.handle("contatos:criar",     (_, nome, numero) => criarContato(nome, numero))
    ipcMain.handle("contatos:atualizar", (_, id, nome, numero) => atualizarContato(id, nome, numero))
    ipcMain.handle("contatos:deletar",   (_, id) => deletarContato(id))

    // ── IPC: registros ────────────────────────────────────────────────────────
    ipcMain.handle("registros:inserir",   (_, tipo, numero, nome) => inserirRegistro(tipo, numero, nome))
    ipcMain.handle("registros:finalizar", (_, id, dur, atendida) => finalizarRegistro(id, dur, atendida))
    ipcMain.handle("registros:listar",    (_, limite) => listarRegistros(limite))
    ipcMain.handle("registros:stats",     () => estatisticas())
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Auto-start no Windows (só em produção)
if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, name: "WaVoIP" })
}

app.on("before-quit", () => { app.isQuiting = true })

app.on("window-all-closed", () => {
    // Não fecha no Windows — fica na bandeja
})

app.on("activate", () => showWindow())

getPool()
    .then(() => {
        createWindow()
        createTray()
        setupUpdater()
    })
    .catch(err => {
        console.error("Banco indisponível:", err.message)
        createWindow()
        createTray()
        setupUpdater()
    })
