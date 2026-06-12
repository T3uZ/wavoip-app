import { Wavoip } from "../node_modules/@wavoip/wavoip-api/dist/index.es.js"

const api = window.electronAPI

// ── Session ───────────────────────────────────────────────────────────────────
let SESSION_TOKEN = null
let SESSION_USER  = null

function saveSession(token, user) {
    SESSION_TOKEN = token
    SESSION_USER  = user
    sessionStorage.setItem("wv_token", token)
    sessionStorage.setItem("wv_user",  JSON.stringify(user))
}

function loadSession() {
    SESSION_TOKEN = sessionStorage.getItem("wv_token")
    const u = sessionStorage.getItem("wv_user")
    SESSION_USER  = u ? JSON.parse(u) : null
    return SESSION_TOKEN && SESSION_USER
}

function clearSession() {
    if (SESSION_TOKEN) api.auth.logout(SESSION_TOKEN)
    SESSION_TOKEN = null; SESSION_USER = null
    sessionStorage.clear()
}

// ── Screens ───────────────────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"))
    document.getElementById(id).classList.add("active")
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
const loginEmail = document.getElementById("login-email")
const loginSenha = document.getElementById("login-senha")
const loginError = document.getElementById("login-error")
const btnLogin   = document.getElementById("btn-login")

async function doLogin() {
    const email = loginEmail.value.trim()
    const senha = loginSenha.value
    if (!email || !senha) { loginError.textContent = "Preencha todos os campos"; return }

    btnLogin.disabled = true
    btnLogin.textContent = "Entrando..."
    loginError.textContent = ""

    const res = await api.auth.login(email, senha)
    btnLogin.disabled = false
    btnLogin.textContent = "Entrar"

    if (!res.ok) { loginError.textContent = res.msg; return }

    saveSession(res.token, res.user)
    initApp()
}

btnLogin.addEventListener("click", doLogin)
loginSenha.addEventListener("keydown", e => { if (e.key === "Enter") doLogin() })

// ══════════════════════════════════════════════════════════════════════════════
// APP INIT
// ══════════════════════════════════════════════════════════════════════════════
async function initApp() {
    showScreen("screen-app")
    document.getElementById("user-name").textContent = SESSION_USER.nome

    if (SESSION_USER.tipo === "admin") {
        document.getElementById("btn-admin-panel").style.display = "inline-block"
    }

    // Carrega tokens do usuário logado
    const tokens = await api.auth.meusTokens(SESSION_TOKEN)
    if (tokens.length === 0) {
        log("Nenhum token vinculado à sua conta. Contate o administrador.", "err")
        setStatus("Sem tokens vinculados", "error")
    } else {
        iniciarWaVoIP(tokens.map(t => t.token))
    }
}

// ── Header buttons ────────────────────────────────────────────────────────────
document.getElementById("btn-logout").addEventListener("click", () => {
    clearSession(); stopWaVoIP(); showScreen("screen-login")
    loginEmail.value = ""; loginSenha.value = ""; loginError.textContent = ""
})

document.getElementById("btn-admin-panel").addEventListener("click", () => {
    showScreen("screen-admin"); loadAdminUsuarios()
})

document.getElementById("btn-back-app").addEventListener("click", async () => {
    showScreen("screen-app")
    const tokens = await api.auth.meusTokens(SESSION_TOKEN)
    const novosTokens = tokens.map(t => t.token)
    const atuais = wavoipInstance ? _currentTokens : []
    const mudou  = novosTokens.length !== atuais.length || novosTokens.some((t, i) => t !== atuais[i])
    if (mudou) {
        stopWaVoIP()
        if (novosTokens.length === 0) { log("Nenhum token vinculado", "err"); setStatus("Sem tokens", "error") }
        else { _currentTokens = novosTokens; iniciarWaVoIP(novosTokens) }
    }
})
document.getElementById("btn-logout-admin").addEventListener("click", () => {
    clearSession(); stopWaVoIP(); showScreen("screen-login")
})

// ── Modal: alterar minha senha ────────────────────────────────────────────────
document.getElementById("btn-senha").addEventListener("click", () => {
    document.getElementById("ms-atual").value = ""
    document.getElementById("ms-nova").value  = ""
    document.getElementById("ms-confirma").value = ""
    document.getElementById("ms-error").textContent = ""
    document.getElementById("modal-senha").classList.add("show")
})
document.getElementById("ms-cancel").addEventListener("click", () => document.getElementById("modal-senha").classList.remove("show"))
document.getElementById("ms-save").addEventListener("click", async () => {
    const atual    = document.getElementById("ms-atual").value
    const nova     = document.getElementById("ms-nova").value
    const confirma = document.getElementById("ms-confirma").value
    const err      = document.getElementById("ms-error")

    if (!atual || !nova) { err.textContent = "Preencha todos os campos"; return }
    if (nova !== confirma) { err.textContent = "Nova senha não confere"; return }
    if (nova.length < 6)  { err.textContent = "Mínimo 6 caracteres"; return }

    const res = await api.auth.alterarSenha(SESSION_TOKEN, atual, nova)
    if (!res.ok) { err.textContent = res.msg; return }
    document.getElementById("modal-senha").classList.remove("show")
})

// ── App tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll("#app-nav button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#app-nav button").forEach(b => b.classList.remove("active"))
        document.querySelectorAll("#screen-app .page").forEach(p => p.classList.remove("active"))
        btn.classList.add("active")
        document.getElementById(`page-${btn.dataset.tab}`).classList.add("active")
        if (btn.dataset.tab === "contacts")  loadContacts()
        if (btn.dataset.tab === "history")   loadHistory()
        if (btn.dataset.tab === "dashboard") loadDashboard()
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// WAVOIP
// ══════════════════════════════════════════════════════════════════════════════
let wavoipInstance = null
let ringtoneStop   = null
let _currentTokens = []
let _devices       = []

function startRingtone() {
    stopRingtone()
    const ctx = new AudioContext(); let alive = true
    ringtoneStop = () => { alive = false; ctx.close() }
    let step = 0
    function beep() {
        if (!alive) return
        const osc = ctx.createOscillator(), g = ctx.createGain()
        osc.connect(g); g.connect(ctx.destination)
        osc.type = "sine"; osc.frequency.value = step % 2 === 0 ? 880 : 1100
        g.gain.setValueAtTime(0.3, ctx.currentTime)
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18)
        step++
        setTimeout(() => { if (alive) beep() }, step % 2 === 0 ? 900 : 150)
    }
    beep()
}

function stopRingtone() { if (ringtoneStop) { ringtoneStop(); ringtoneStop = null } }

function stopWaVoIP() {
    if (wavoipInstance) {
        try { wavoipInstance.destroy?.() } catch {}
        wavoipInstance = null
    }
    _currentTokens = []; _devices = []
    setDeviceReady(false)
    setStatus("Desconectado", "error")
    document.getElementById("btn-conectar").style.display = "none"
}

const logFeed = document.getElementById("log-feed")
function log(msg, type = "info") {
    console.log(`[WaVoIP] ${msg}`)
    const el = document.createElement("div")
    el.className = `log-entry ${type}`
    el.innerHTML = `<div class="log-dot"></div><div class="log-msg">${msg}</div><div class="log-time">${new Date().toLocaleTimeString()}</div>`
    logFeed.prepend(el)
    // mantém no máximo 5 entradas
    while (logFeed.children.length > 5) logFeed.removeChild(logFeed.lastChild)
}

const callAnim     = document.getElementById("call-anim")
const callAnimLbl  = document.getElementById("call-anim-label")
const callAnimNum  = document.getElementById("call-anim-number")

function showCallAnim(label, number) {
    callAnimLbl.textContent = label
    callAnimNum.textContent = number
    callAnim.classList.add("show")
    document.getElementById("phone-input").style.display = "none"
    document.getElementById("call-controls").style.display = "none"
}

function hideCallAnim() {
    callAnim.classList.remove("show")
    document.getElementById("phone-input").style.display = ""
    document.getElementById("call-controls").style.display = ""
}

const statusDot  = document.getElementById("status-dot")
const statusText = document.getElementById("status-text")
let deviceReady  = false

function setStatus(label, state) { statusText.textContent = label; statusDot.className = state }

function setDeviceReady(ready) {
    deviceReady = ready
    document.getElementById("btn-call").disabled = !ready
    document.getElementById("phone-input").disabled = !ready
}

// ── Botão Conectar ────────────────────────────────────────────────────────────
document.getElementById("btn-conectar").addEventListener("click", async () => {
    const btn = document.getElementById("btn-conectar")
    btn.disabled = true; btn.textContent = "Conectando..."

    // 1. Tenta acordar device hibernado
    const hibernating = _devices.find(d => d.status === "hibernating")
    if (hibernating) {
        log("Acordando dispositivo...", "info")
        try { await hibernating.wakeUp() } catch {}
    }

    // 2. Tenta reiniciar device fechado
    const closed = _devices.find(d => d.status === "close" || d.status === "disconnected")
    if (closed) {
        log("Reiniciando dispositivo...", "info")
        try { await closed.restart() } catch {}
    }

    // 3. Exibe QR se disponível
    const comQr = _devices.find(d => d.qrCode)
    if (comQr?.qrCode) {
        renderQR(comQr.qrCode)
        document.querySelectorAll("#app-nav button")[0].click()
    } else {
        // Mostra a seção de QR/pairing mesmo sem QR ainda (vai aparecer via evento)
        document.getElementById("qr-section").style.display = "flex"
        document.querySelectorAll("#app-nav button")[0].click()
    }

    btn.disabled = false; btn.textContent = "🔌 Conectar"
})

// ── Pairing Code ──────────────────────────────────────────────────────────────
document.getElementById("pairing-gerar").addEventListener("click", async () => {
    const phone = document.getElementById("pairing-phone").value.trim()
    const err   = document.getElementById("pairing-error")
    if (!phone) { err.textContent = "Digite o número com código do país"; return }

    const device = _devices.find(d => d.status !== "open")
    if (!device) { err.textContent = "Nenhum dispositivo disponível"; return }

    const btn = document.getElementById("pairing-gerar")
    btn.disabled = true; btn.textContent = "Aguarde..."
    err.textContent = ""; document.getElementById("pairing-code-box").style.display = "none"

    try {
        const res = await device.pairingCode(phone)
        if (res.err) { err.textContent = res.err }
        else {
            document.getElementById("pairing-code").textContent = res.pairingCode
            document.getElementById("pairing-code-box").style.display = "block"
            log("Código de pareamento gerado", "ok")
        }
    } catch (e) { err.textContent = e.message }

    btn.disabled = false; btn.textContent = "Gerar código"
})

function renderQR(data) {
    const sec = document.getElementById("qr-section"); sec.style.display = "flex"
    const img = new Image(); img.crossOrigin = "anonymous"
    img.onload = () => { const ctx = document.getElementById("qr-canvas").getContext("2d"); ctx.clearRect(0,0,180,180); ctx.drawImage(img,0,0,180,180) }
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data)}`
}

let activeCall = null, pendingOffer = null, muted = false, callStartTime = null, activeRecordId = null

function callDuration() { return callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0 }

function showCallControls(show) {
    document.getElementById("btn-end").style.display   = show ? "block" : "none"
    document.getElementById("btn-mute").style.display  = show ? "block" : "none"
    document.getElementById("btn-call").style.display  = show ? "none"  : "block"
    document.getElementById("phone-input").disabled    = show || !deviceReady
}

function iniciarWaVoIP(tokens) {
    _currentTokens = [...tokens]
    log(`Iniciando com ${tokens.length} token(s)...`, "info")
    setStatus("Conectando...", "connecting")
    setDeviceReady(false)

    const wavoip = new Wavoip({ tokens, platform: "wavoip-electron" })
    wavoipInstance = wavoip
    _devices = wavoip.getDevices()

    for (const device of _devices) {
        if (device.status === "open") setDeviceReady(true)
        if (device.qrCode) { renderQR(device.qrCode); document.getElementById("btn-conectar").style.display = "inline-block" }

        device.on("statusChanged", status => {
            log(`Dispositivo: ${status}`, status === "open" ? "ok" : "info")
            if (status === "open") {
                setStatus("Pronto para chamadas", "open"); setDeviceReady(true)
                document.getElementById("qr-section").style.display = "none"
                document.getElementById("btn-conectar").style.display = "none"
                document.getElementById("btn-conectar").style.display = "none"
            } else {
                setStatus(`Dispositivo: ${status}`, status === "disconnected" ? "error" : "connecting")
                setDeviceReady(false)
                const btnQr = document.getElementById("btn-conectar")
                btnQr.style.display = "inline-block"
                btnQr.textContent = status === "hibernating" ? "⚡ Acordar" : "📷 QR Code"
                document.getElementById("btn-conectar").style.display = "inline-block"
            }
        })

        device.on("qrCodeChanged", qrCode => {
            if (qrCode) {
                setStatus("Escaneie o QR Code", "connecting")
                renderQR(qrCode)
                document.getElementById("btn-conectar").style.display = "inline-block"
            } else {
                document.getElementById("qr-section").style.display = "none"
            }
        })
    }

    wavoip.on("offer", async (offer) => {
        const phone = offer.peer?.phone ?? "Desconhecido"
        const nome  = await resolveNome(phone)
        pendingOffer = offer
        document.getElementById("incoming-from").textContent = nome !== phone ? `${nome}\n${phone}` : phone
        document.getElementById("incoming-overlay").classList.add("show")
        startRingtone(); api?.incomingCall()
        log(`Chamada de ${nome ?? phone}`, "info")

        offer.on("ended", () => {
            if (pendingOffer !== offer) return
            stopRingtone(); pendingOffer = null
            document.getElementById("incoming-overlay").classList.remove("show")
            api?.callEnded()
            api?.registros.inserir(SESSION_TOKEN, "perdida", phone, nome !== phone ? nome : null)
            log("Chamador desligou antes de atender", "err")
            loadHistory(); loadDashboard()
        })
    })
}

// Aceitar
document.getElementById("btn-accept").addEventListener("click", async () => {
    if (!pendingOffer) return
    stopRingtone()
    const phone = document.getElementById("incoming-from").textContent.split("\n").pop()
    document.getElementById("incoming-overlay").classList.remove("show")
    const { call, err } = await pendingOffer.accept()
    pendingOffer = null
    if (err) { log(`Erro ao aceitar: ${err.message}`, "err"); return }
    activeCall = call; callStartTime = Date.now()
    const nome = await resolveNome(phone)
    activeRecordId = await api?.registros.inserir(SESSION_TOKEN, "recebida", phone, nome !== phone ? nome : null)
    showCallControls(true); log("Chamada em andamento", "ok")
    call.on("ended", async () => {
        const dur = callDuration()
        if (activeRecordId) await api?.registros.finalizar(SESSION_TOKEN, activeRecordId, dur, true)
        activeCall = null; activeRecordId = null; callStartTime = null
        showCallControls(false); api?.callEnded(); log(`Encerrada (${dur}s)`, "info")
        loadHistory(); loadDashboard()
    })
})

// Recusar
document.getElementById("btn-reject").addEventListener("click", async () => {
    if (!pendingOffer) return
    stopRingtone()
    const phone = document.getElementById("incoming-from").textContent.split("\n").pop()
    await pendingOffer.reject(); pendingOffer = null
    document.getElementById("incoming-overlay").classList.remove("show")
    api?.callEnded()
    await api?.registros.inserir(SESSION_TOKEN, "perdida", phone, null)
    log("Recusada", "info"); loadHistory(); loadDashboard()
})

// Ligar
document.getElementById("btn-call").addEventListener("click", async () => {
    const phone = document.getElementById("phone-input").value.trim()
    if (!phone || !wavoipInstance) return
    const btnCall = document.getElementById("btn-call")
    btnCall.disabled = true
    log(`Ligando para ${phone}...`, "info")

    // Inicia a chamada primeiro, sem aguardar DB
    let result
    try {
        result = await wavoipInstance.startCall({ to: phone })
    } catch (e) {
        log(`Erro ao iniciar: ${e.message}`, "err")
        btnCall.disabled = false
        return
    }

    const { call, err } = result
    showCallAnim("Chamando...", phone)

    if (err) {
        const detail = err.devices ? err.devices.map(d => d.reason).join("; ") : (err.message ?? "Erro desconhecido")
        log(`Falha: ${detail}`, "err")
        hideCallAnim(); btnCall.disabled = false
        return
    }
    log("Aguardando resposta...", "info")

    resolveNome(phone).then(nome => {
        callAnimNum.textContent = nome !== phone ? `${nome}  •  ${phone}` : phone
        api?.registros.inserir(SESSION_TOKEN, "realizada", phone, nome !== phone ? nome : null)
            .then(id => { activeRecordId = id })
    })

    call.on("peerAccept", active => {
        activeCall = active; callStartTime = Date.now()
        callAnimLbl.textContent = "Em chamada"
        showCallControls(true)
        hideCallAnim()
        log("Atendida!", "ok")
    })
    call.on("peerReject", async () => {
        if (activeRecordId) await api?.registros.finalizar(SESSION_TOKEN, activeRecordId, 0, false)
        activeRecordId = null; btnCall.disabled = false
        hideCallAnim(); log("Recusada", "err"); loadHistory(); loadDashboard()
    })
    call.on("unanswered", async () => {
        if (activeRecordId) await api?.registros.finalizar(SESSION_TOKEN, activeRecordId, 0, false)
        activeRecordId = null; btnCall.disabled = false
        hideCallAnim(); log("Sem resposta", "err"); loadHistory(); loadDashboard()
    })
    call.on("ended", async () => {
        const dur = callDuration()
        if (activeRecordId) await api?.registros.finalizar(SESSION_TOKEN, activeRecordId, dur, dur > 0)
        activeCall = null; activeRecordId = null; callStartTime = null
        showCallControls(false); hideCallAnim(); btnCall.disabled = false
        log(`Encerrada (${dur}s)`, "info"); loadHistory(); loadDashboard()
    })
})

document.getElementById("btn-mute").addEventListener("click", async () => {
    if (!activeCall) return
    if (muted) { await activeCall.unmute(); document.getElementById("btn-mute").textContent = "Mutar"; muted = false }
    else        { await activeCall.mute();  document.getElementById("btn-mute").textContent = "Desmutar"; muted = true }
})

document.getElementById("btn-end").addEventListener("click", async () => { if (activeCall) await activeCall.end() })

async function resolveNome(numero) {
    try { const cs = await api.contatos.listar(SESSION_TOKEN); const f = cs.find(c => c.numero === numero); return f ? f.nome : numero } catch { return numero }
}

function dialpad(phone) {
    document.getElementById("phone-input").value = phone
    document.querySelectorAll("#app-nav button")[0].click()
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTACTS
// ══════════════════════════════════════════════════════════════════════════════
let editingContactId = null

async function loadContacts(filter = "") {
    const list = document.getElementById("contacts-list"); list.innerHTML = ""
    const all = await api.contatos.listar(SESSION_TOKEN)
    const data = filter ? all.filter(c => c.nome.toLowerCase().includes(filter.toLowerCase()) || c.numero.includes(filter)) : all
    if (!data.length) { list.innerHTML = `<div class="empty-state">Nenhum contato</div>`; return }
    data.forEach(c => {
        const div = document.createElement("div"); div.className = "contact-item"
        div.innerHTML = `<div class="contact-avatar">${c.nome[0].toUpperCase()}</div><div class="contact-info"><div class="contact-name">${c.nome}</div><div class="contact-number">${c.numero}</div></div><div class="contact-actions"><button class="btn-call-c">Ligar</button><button class="edit-c">Editar</button><button class="del-c">✕</button></div>`
        div.querySelector(".btn-call-c").onclick = () => dialpad(c.numero)
        div.querySelector(".edit-c").onclick = () => { editingContactId = c.id; document.getElementById("form-nome").value = c.nome; document.getElementById("form-numero").value = c.numero; document.getElementById("contact-form").classList.add("show") }
        div.querySelector(".del-c").onclick = async () => { await api.contatos.deletar(SESSION_TOKEN, c.id); loadContacts() }
        list.appendChild(div)
    })
}

document.getElementById("btn-new-contact").onclick = () => { editingContactId = null; document.getElementById("form-nome").value = ""; document.getElementById("form-numero").value = ""; document.getElementById("contact-form").classList.add("show") }
document.getElementById("btn-cancel-contact").onclick = () => { document.getElementById("contact-form").classList.remove("show"); editingContactId = null }
document.getElementById("btn-save-contact").onclick = async () => {
    const nome = document.getElementById("form-nome").value.trim(), numero = document.getElementById("form-numero").value.trim()
    if (!nome || !numero) return
    if (editingContactId) await api.contatos.atualizar(SESSION_TOKEN, editingContactId, nome, numero)
    else await api.contatos.criar(SESSION_TOKEN, nome, numero)
    document.getElementById("contact-form").classList.remove("show"); editingContactId = null; loadContacts()
}
document.getElementById("contact-search").oninput = e => loadContacts(e.target.value)

// ══════════════════════════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════════════════════════
const ICONS  = { recebida: "📥", realizada: "📤", perdida: "📵" }
const LABELS = { recebida: "Recebida", realizada: "Realizada", perdida: "Perdida" }

function badgeInfo(r) {
    if (r.tipo === "perdida")                  return { cls: "badge-perdida",   label: "Perdida",      row: "perdida" }
    if (r.atendida)                            return { cls: "badge-atendida",  label: "Atendida",     row: "atendida" }
    if (r.tipo === "realizada" && !r.atendida) return { cls: "badge-nao-atend", label: "Não atendida", row: "nao-atend" }
    return { cls: "badge-perdida", label: "Perdida", row: "perdida" }
}

function historyRow(r, showDur = true) {
    const { cls, label, row } = badgeInfo(r)
    const dur  = r.duracao > 0 && showDur ? `${r.duracao}s` : null
    const meta = [LABELS[r.tipo], new Date(r.inicio).toLocaleString("pt-BR"), dur].filter(Boolean).join(" · ")
    const div  = document.createElement("div"); div.className = `history-item ${row}`
    div.innerHTML = `<div class="history-icon ${r.tipo}">${ICONS[r.tipo]}</div><div class="history-info"><div class="history-name">${r.nome ?? r.numero}<span class="history-badge ${cls}">${label}</span></div>${r.nome ? `<div class="history-number">${r.numero}</div>` : ""}<div class="history-meta">${meta}</div></div><button class="btn-return">Retornar</button>`
    div.querySelector(".btn-return").onclick = () => dialpad(r.numero)
    return div
}

async function loadHistory() {
    const list = document.getElementById("history-list"); list.innerHTML = ""
    const rows = await api.registros.listar(SESSION_TOKEN, 100)
    if (!rows.length) { list.innerHTML = `<div class="empty-state">Nenhum registro</div>`; return }
    rows.forEach(r => list.appendChild(historyRow(r)))
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
    const [stats, recent] = await Promise.all([api.registros.stats(SESSION_TOKEN), api.registros.listar(SESSION_TOKEN, 5)])
    document.getElementById("stat-atendidas").textContent      = stats.recebidas_atendidas ?? 0
    document.getElementById("stat-perdidas").textContent       = stats.perdidas ?? 0
    document.getElementById("stat-realizadas").textContent     = stats.realizadas_atendidas ?? 0
    document.getElementById("stat-duracao").textContent        = stats.duracao_media ? `${stats.duracao_media}s` : "—"
    document.getElementById("stat-realizadas-nao").textContent = stats.realizadas_nao_atendidas ?? 0
    document.getElementById("stat-total").textContent          = stats.total ?? 0
    const el = document.getElementById("dashboard-recent"); el.innerHTML = ""
    if (!recent.length) { el.innerHTML = `<div class="empty-state">Sem registros</div>`; return }
    recent.forEach(r => el.appendChild(historyRow(r, false)))
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════════════════

// Admin tabs
document.querySelectorAll("#admin-nav button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#admin-nav button").forEach(b => b.classList.remove("active"))
        document.querySelectorAll("#screen-admin .page").forEach(p => p.classList.remove("active"))
        btn.classList.add("active")
        document.getElementById(`apage-${btn.dataset.atab}`).classList.add("active")
        if (btn.dataset.atab === "usuarios") loadAdminUsuarios()
        if (btn.dataset.atab === "tokens")   loadAdminTokens()
        if (btn.dataset.atab === "vinculos") loadAdminVinculos()
    })
})

// ── Usuários ──────────────────────────────────────────────────────────────────
let editingUserId = null

async function loadAdminUsuarios() {
    const tbody = document.querySelector("#table-usuarios tbody"); tbody.innerHTML = ""
    const users = await api.adminUsuarios.listar(SESSION_TOKEN)
    users.forEach(u => {
        const tr = document.createElement("tr")
        tr.innerHTML = `
            <td>${u.nome}</td>
            <td>${u.email}</td>
            <td><span class="badge-tipo badge-${u.tipo}">${u.tipo}</span></td>
            <td><span class="badge-tipo ${u.ativo ? 'badge-ativo' : 'badge-inativo'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
            <td>${u.total_tokens}</td>
            <td><div class="row-actions">
                <button class="edit-u">Editar</button>
                <button class="reset-u">Senha</button>
                <button class="del-u del">Excluir</button>
            </div></td>`
        tr.querySelector(".edit-u").onclick = () => openUsuarioModal(u)
        tr.querySelector(".reset-u").onclick = () => openResetSenha(u.id)
        tr.querySelector(".del-u").onclick = async () => { if (confirm(`Excluir ${u.nome}?`)) { await api.adminUsuarios.deletar(SESSION_TOKEN, u.id); loadAdminUsuarios() } }
        tbody.appendChild(tr)
    })
}

function openUsuarioModal(u = null) {
    editingUserId = u?.id ?? null
    document.getElementById("modal-usuario-title").textContent = u ? "Editar usuário" : "Novo usuário"
    document.getElementById("mu-nome").value  = u?.nome  ?? ""
    document.getElementById("mu-email").value = u?.email ?? ""
    document.getElementById("mu-senha").value = ""
    document.getElementById("mu-tipo").value  = u?.tipo  ?? "usuario"
    document.getElementById("mu-ativo").value = u ? String(u.ativo) : "1"
    document.getElementById("mu-senha-field").style.display = u ? "none" : "flex"
    document.getElementById("mu-error").textContent = ""
    document.getElementById("modal-usuario").classList.add("show")
}

document.getElementById("btn-novo-usuario").onclick = () => openUsuarioModal()
document.getElementById("mu-cancel").onclick = () => document.getElementById("modal-usuario").classList.remove("show")
document.getElementById("mu-save").onclick = async () => {
    const nome  = document.getElementById("mu-nome").value.trim()
    const email = document.getElementById("mu-email").value.trim()
    const senha = document.getElementById("mu-senha").value
    const tipo  = document.getElementById("mu-tipo").value
    const ativo = Number(document.getElementById("mu-ativo").value)
    const err   = document.getElementById("mu-error")

    if (!nome || !email) { err.textContent = "Preencha nome e e-mail"; return }
    if (!editingUserId && senha.length < 6) { err.textContent = "Senha mínimo 6 caracteres"; return }

    if (editingUserId) await api.adminUsuarios.atualizar(SESSION_TOKEN, editingUserId, nome, email, tipo, ativo)
    else               await api.adminUsuarios.criar(SESSION_TOKEN, nome, email, senha, tipo)

    document.getElementById("modal-usuario").classList.remove("show")
    loadAdminUsuarios()
}

let resetingUserId = null
function openResetSenha(id) {
    resetingUserId = id
    document.getElementById("mrs-senha").value = ""
    document.getElementById("mrs-error").textContent = ""
    document.getElementById("modal-reset-senha").classList.add("show")
}
document.getElementById("mrs-cancel").onclick = () => document.getElementById("modal-reset-senha").classList.remove("show")
document.getElementById("mrs-save").onclick = async () => {
    const senha = document.getElementById("mrs-senha").value
    const err   = document.getElementById("mrs-error")
    if (senha.length < 6) { err.textContent = "Mínimo 6 caracteres"; return }
    await api.adminUsuarios.resetarSenha(SESSION_TOKEN, resetingUserId, senha)
    document.getElementById("modal-reset-senha").classList.remove("show")
}

// ── Tokens ────────────────────────────────────────────────────────────────────
let editingTokenId = null

async function loadAdminTokens() {
    const tbody = document.querySelector("#table-tokens tbody"); tbody.innerHTML = ""
    const tokens = await api.adminTokens.listar(SESSION_TOKEN)
    tokens.forEach(t => {
        const tr = document.createElement("tr")
        const tokenShort = t.token.length > 20 ? t.token.slice(0, 20) + "…" : t.token
        tr.innerHTML = `
            <td>${t.nome}</td>
            <td style="font-family:monospace;font-size:11px" title="${t.token}">${tokenShort}</td>
            <td><span class="badge-tipo ${t.ativo ? 'badge-ativo' : 'badge-inativo'}">${t.ativo ? 'Ativo' : 'Inativo'}</span></td>
            <td>${t.total_usuarios}</td>
            <td><div class="row-actions">
                <button class="edit-t">Editar</button>
                <button class="del-t del">Excluir</button>
            </div></td>`
        tr.querySelector(".edit-t").onclick = () => openTokenModal(t)
        tr.querySelector(".del-t").onclick = async () => { if (confirm(`Excluir token "${t.nome}"?`)) { await api.adminTokens.deletar(SESSION_TOKEN, t.id); loadAdminTokens() } }
        tbody.appendChild(tr)
    })
}

function openTokenModal(t = null) {
    editingTokenId = t?.id ?? null
    document.getElementById("modal-token-title").textContent = t ? "Editar token" : "Novo token"
    document.getElementById("mt-nome").value  = t?.nome  ?? ""
    document.getElementById("mt-token").value = t?.token ?? ""
    document.getElementById("mt-ativo").value = t ? String(t.ativo) : "1"
    document.getElementById("mt-error").textContent = ""
    document.getElementById("modal-token").classList.add("show")
}

document.getElementById("btn-novo-token").onclick = () => openTokenModal()
document.getElementById("mt-cancel").onclick = () => document.getElementById("modal-token").classList.remove("show")
document.getElementById("mt-save").onclick = async () => {
    const nome  = document.getElementById("mt-nome").value.trim()
    const token = document.getElementById("mt-token").value.trim()
    const ativo = Number(document.getElementById("mt-ativo").value)
    const err   = document.getElementById("mt-error")

    if (!nome || !token) { err.textContent = "Preencha todos os campos"; return }

    if (editingTokenId) await api.adminTokens.atualizar(SESSION_TOKEN, editingTokenId, nome, token, ativo)
    else                await api.adminTokens.criar(SESSION_TOKEN, nome, token)

    document.getElementById("modal-token").classList.remove("show")
    loadAdminTokens()
}

// ── Vínculos ──────────────────────────────────────────────────────────────────
async function loadAdminVinculos() {
    const select = document.getElementById("vinculos-usuario-select")
    const users  = await api.adminUsuarios.listar(SESSION_TOKEN)
    select.innerHTML = users.map(u => `<option value="${u.id}">${u.nome} (${u.email})</option>`).join("")
    select.onchange = () => renderVinculos(Number(select.value))
    if (users.length) renderVinculos(users[0].id)
}

async function renderVinculos(usuarioId) {
    const grid    = document.getElementById("vinculos-grid"); grid.innerHTML = ""
    const tokens  = await api.adminTokens.listar(SESSION_TOKEN)
    const vincIds = await api.adminVinculos.doUsuario(SESSION_TOKEN, usuarioId)

    if (!tokens.length) { grid.innerHTML = `<div class="empty-state">Nenhum token cadastrado</div>`; return }

    tokens.forEach(t => {
        const vinculado = vincIds.includes(t.id)
        const div = document.createElement("div"); div.className = "vinculo-item"
        div.innerHTML = `
            <div>
                <div class="vi-name">${t.nome}</div>
                <div class="vi-token">${t.token.slice(0,32)}…</div>
            </div>
            <button class="btn btn-sm ${vinculado ? 'btn-red' : 'btn-green'}" style="width:auto">
                ${vinculado ? 'Desvincular' : 'Vincular'}
            </button>`
        div.querySelector("button").onclick = async () => {
            if (vinculado) await api.adminVinculos.desvincular(SESSION_TOKEN, usuarioId, t.id)
            else           await api.adminVinculos.vincular(SESSION_TOKEN, usuarioId, t.id)
            renderVinculos(usuarioId)
        }
        grid.appendChild(div)
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════════════════
if (loadSession()) {
    api.auth.check(SESSION_TOKEN).then(res => {
        if (res.ok) { SESSION_USER = { ...SESSION_USER, ...res.user }; initApp() }
        else { clearSession(); showScreen("screen-login") }
    })
} else {
    showScreen("screen-login")
}
