import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from "electron"
import { fileURLToPath } from "url"
import path from "path"
import jwt from "jsonwebtoken"
import updaterPkg from "electron-updater"
const { autoUpdater } = updaterPkg

import {
    getPool, autenticar, alterarSenha,
    listarUsuarios, criarUsuario, atualizarUsuario, resetarSenha, deletarUsuario,
    listarTokens, criarToken, atualizarToken, deletarToken,
    tokensPorUsuario, vincularToken, desvincularToken, vinculosDoUsuario,
    notificarAtendida, verificarAtendida,
    listarContatos, criarContato, atualizarContato, deletarContato,
    listarRegistros, inserirRegistro, finalizarRegistro, estatisticas,
} from "./db.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JWT_SECRET = "w4v01p-jwt-s3cr3t-1c0r3-2024"

let win  = null
let tray = null

// ── Session store (só na memória do processo principal) ───────────────────────
const sessions = new Map()

function criarSessao(user) {
    const token = jwt.sign({ id: user.id, tipo: user.tipo }, JWT_SECRET, { expiresIn: "12h" })
    sessions.set(token, user)
    return token
}

function validarSessao(token) {
    if (!token || !sessions.has(token)) return null
    try {
        jwt.verify(token, JWT_SECRET)
        return sessions.get(token)
    } catch {
        sessions.delete(token)
        return null
    }
}

function exigirAdmin(token) {
    const user = validarSessao(token)
    if (!user || user.tipo !== "admin") throw new Error("Acesso negado")
    return user
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupUpdater() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on("update-available", (info) => {
        dialog.showMessageBox(win, {
            type: "info", title: "Atualização disponível",
            message: `Nova versão ${info.version} disponível.`,
            detail: "Deseja baixar e instalar agora?",
            buttons: ["Baixar agora", "Depois"], defaultId: 0,
        }).then(({ response }) => { if (response === 0) autoUpdater.downloadUpdate() })
    })

    autoUpdater.on("download-progress", (p) => {
        win?.setProgressBar(p.percent / 100)
        tray?.setToolTip(`IVoIP — Baixando ${Math.round(p.percent)}%`)
    })

    autoUpdater.on("update-downloaded", () => {
        win?.setProgressBar(-1)
        dialog.showMessageBox(win, {
            type: "info", title: "Pronto para instalar",
            message: "Atualização baixada.",
            detail: "O app será reiniciado para instalar.",
            buttons: ["Instalar agora", "Na próxima vez"], defaultId: 0,
        }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall() })
    })

    autoUpdater.on("error", (err) => console.error("Updater:", err.message))

    if (app.isPackaged) {
        autoUpdater.checkForUpdates()
        setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
    }
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.ico"))
    tray = new Tray(icon)
    tray.setToolTip("IVoIP")
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Abrir IVoIP", click: () => showWindow() },
        { type: "separator" },
        { label: "Verificar atualização", click: () => {
            if (app.isPackaged) autoUpdater.checkForUpdates()
        }},
        { type: "separator" },
        { label: "Sair", click: () => { app.isQuiting = true; app.quit() } },
    ]))
    tray.on("double-click", showWindow)
}

function showWindow() {
    if (!win) return
    win.show(); win.focus()
    if (win.isMinimized()) win.restore()
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
    win = new BrowserWindow({
        width: 960, height: 700,
        minWidth: 800, minHeight: 600,
        title: "IVoIP",
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
        },
    })

    win.loadFile(path.join(__dirname, "renderer", "index.html"))
    win.once("ready-to-show", () => { if (!app.isPackaged) win.show() })

    win.on("close", (e) => {
        if (!app.isQuiting) {
            e.preventDefault(); win.hide()
            tray?.displayBalloon({
                title: "IVoIP em segundo plano",
                content: "Clique duas vezes no ícone para reabrir.",
                iconType: "info",
            })
        }
    })

    // ── IPC: Janela ───────────────────────────────────────────────────────────
    ipcMain.on("incoming-call", () => {
        showWindow(); win.center(); win.setAlwaysOnTop(true)
        setTimeout(() => win.setAlwaysOnTop(false), 4000)
        tray?.displayBalloon({ title: "📞 Chamada recebida", content: "Clique para atender.", iconType: "info" })
    })
    ipcMain.on("call-ended", () => win.setAlwaysOnTop(false))

    // ── IPC: Auth ─────────────────────────────────────────────────────────────
    ipcMain.handle("auth:login", async (_, email, senha) => {
        const user = await autenticar(email, senha)
        if (!user) return { ok: false, msg: "E-mail ou senha incorretos" }
        const token = criarSessao(user)
        return { ok: true, token, user: { nome: user.nome, tipo: user.tipo } }
    })

    ipcMain.handle("auth:logout", (_, token) => {
        sessions.delete(token)
        return { ok: true }
    })

    ipcMain.handle("auth:check", (_, token) => {
        const user = validarSessao(token)
        return user ? { ok: true, user: { nome: user.nome, tipo: user.tipo } } : { ok: false }
    })

    ipcMain.handle("auth:alterar-senha", async (_, token, senhaAtual, novaSenha) => {
        const user = validarSessao(token)
        if (!user) return { ok: false, msg: "Sessão inválida" }
        return alterarSenha(user.id, senhaAtual, novaSenha)
    })

    // ── IPC: Tokens do usuário logado ─────────────────────────────────────────
    ipcMain.handle("auth:meus-tokens", async (_, token) => {
        const user = validarSessao(token)
        if (!user) return []
        return tokensPorUsuario(user.id)
    })

    // ── IPC: Admin — Usuários ─────────────────────────────────────────────────
    ipcMain.handle("admin:usuarios:listar", (_, token) => { exigirAdmin(token); return listarUsuarios() })
    ipcMain.handle("admin:usuarios:criar",  (_, token, nome, email, senha, tipo) => { exigirAdmin(token); return criarUsuario(nome, email, senha, tipo) })
    ipcMain.handle("admin:usuarios:atualizar", (_, token, id, nome, email, tipo, ativo) => { exigirAdmin(token); return atualizarUsuario(id, nome, email, tipo, ativo) })
    ipcMain.handle("admin:usuarios:resetar-senha", (_, token, id, senha) => { exigirAdmin(token); return resetarSenha(id, senha) })
    ipcMain.handle("admin:usuarios:deletar", (_, token, id) => { exigirAdmin(token); return deletarUsuario(id) })

    // ── IPC: Admin — Tokens ───────────────────────────────────────────────────
    ipcMain.handle("admin:tokens:listar",    (_, token) => { exigirAdmin(token); return listarTokens() })
    ipcMain.handle("admin:tokens:criar",     (_, token, nome, tk) => { exigirAdmin(token); return criarToken(nome, tk) })
    ipcMain.handle("admin:tokens:atualizar", (_, token, id, nome, tk, ativo) => { exigirAdmin(token); return atualizarToken(id, nome, tk, ativo) })
    ipcMain.handle("admin:tokens:deletar",   (_, token, id) => { exigirAdmin(token); return deletarToken(id) })

    // ── IPC: Admin — Vínculos ─────────────────────────────────────────────────
    ipcMain.handle("admin:vinculos:do-usuario",  (_, token, uid) => { exigirAdmin(token); return vinculosDoUsuario(uid) })
    ipcMain.handle("admin:vinculos:vincular",    (_, token, uid, tid) => { exigirAdmin(token); return vincularToken(uid, tid) })
    ipcMain.handle("admin:vinculos:desvincular", (_, token, uid, tid) => { exigirAdmin(token); return desvincularToken(uid, tid) })

    // ── IPC: Sync multi-device ────────────────────────────────────────────────
    ipcMain.handle("chamada:notificar", (_, token, phone) => { validarSessao(token); return notificarAtendida(phone) })
    ipcMain.handle("chamada:verificar", (_, token, phone) => { validarSessao(token); return verificarAtendida(phone) })

    // ── IPC: Contatos ─────────────────────────────────────────────────────────
    ipcMain.handle("contatos:listar",    (_, token) => { validarSessao(token); return listarContatos() })
    ipcMain.handle("contatos:criar",     (_, token, nome, numero) => { validarSessao(token); return criarContato(nome, numero) })
    ipcMain.handle("contatos:atualizar", (_, token, id, nome, numero) => { validarSessao(token); return atualizarContato(id, nome, numero) })
    ipcMain.handle("contatos:deletar",   (_, token, id) => { validarSessao(token); return deletarContato(id) })

    // ── IPC: Registros ────────────────────────────────────────────────────────
    ipcMain.handle("registros:inserir",   (_, token, tipo, numero, nome) => {
        const user = validarSessao(token)
        return inserirRegistro(tipo, numero, nome, user?.id ?? null)
    })
    ipcMain.handle("registros:finalizar", (_, token, id, dur, atendida) => { validarSessao(token); return finalizarRegistro(id, dur, atendida) })
    ipcMain.handle("registros:listar",    (_, token, limite) => { validarSessao(token); return listarRegistros(limite) })
    ipcMain.handle("registros:stats",     (_, token) => { validarSessao(token); return estatisticas() })
}

// ── Boot ──────────────────────────────────────────────────────────────────────
if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, name: "IVoIP" })
}

app.on("before-quit", () => { app.isQuiting = true })
app.on("window-all-closed", () => {})
app.on("activate", showWindow)

getPool()
    .then(() => { createWindow(); createTray(); setupUpdater() })
    .catch(err => { console.error("Banco indisponível:", err.message); createWindow(); createTray(); setupUpdater() })
