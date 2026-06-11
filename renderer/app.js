import { Wavoip } from "../node_modules/@wavoip/wavoip-api/dist/index.es.js"

const api = window.electronAPI

// ── Ringtone ──────────────────────────────────────────────────────────────────
let ringtoneStop = null

function startRingtone() {
    stopRingtone()
    const ctx = new AudioContext()
    let alive = true
    ringtoneStop = () => { alive = false; ctx.close() }
    let step = 0
    function beep() {
        if (!alive) return
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = "sine"
        osc.frequency.value = step % 2 === 0 ? 880 : 1100
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18)
        step++
        setTimeout(() => { if (alive) beep() }, step % 2 === 0 ? 900 : 150)
    }
    beep()
}

function stopRingtone() {
    if (ringtoneStop) { ringtoneStop(); ringtoneStop = null }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll("nav button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"))
        document.querySelectorAll(".page").forEach(p => p.classList.remove("active"))
        btn.classList.add("active")
        document.getElementById(`page-${btn.dataset.tab}`).classList.add("active")
        if (btn.dataset.tab === "contacts")  loadContacts()
        if (btn.dataset.tab === "history")   loadHistory()
        if (btn.dataset.tab === "dashboard") loadDashboard()
    })
})

// ── Log ───────────────────────────────────────────────────────────────────────
const logEl = document.getElementById("log")
function log(msg, type = "info") {
    console.log(`[WaVoIP] ${msg}`)
    const el = document.createElement("div")
    el.className = `entry ${type}`
    el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
    logEl.prepend(el)
}

// ── Status ────────────────────────────────────────────────────────────────────
const statusDot  = document.getElementById("status-dot")
const statusText = document.getElementById("status-text")
let deviceReady  = false

function setStatus(label, state) {
    statusText.textContent = label
    statusDot.className    = state
}

function setDeviceReady(ready) {
    deviceReady = ready
    document.getElementById("btn-call").disabled = !ready
    document.getElementById("phone-input").disabled = !ready
}

// ── QR ────────────────────────────────────────────────────────────────────────
function renderQR(data) {
    const sec = document.getElementById("qr-section")
    sec.style.display = "flex"
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data)}`
    const img = new Image(); img.crossOrigin = "anonymous"
    img.onload = () => {
        const ctx = document.getElementById("qr-canvas").getContext("2d")
        ctx.clearRect(0, 0, 180, 180); ctx.drawImage(img, 0, 0, 180, 180)
    }
    img.src = url
}

// ── Call state ────────────────────────────────────────────────────────────────
let activeCall     = null
let pendingOffer   = null
let muted          = false
let callStartTime  = null
let activeRecordId = null

function showCallControls(show) {
    document.getElementById("btn-end").style.display  = show ? "block" : "none"
    document.getElementById("btn-mute").style.display = show ? "block" : "none"
    document.getElementById("btn-call").style.display = show ? "none"  : "block"
    document.getElementById("phone-input").disabled   = show || !deviceReady
}

function callDuration() {
    return callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0
}

// ── WaVoIP ───────────────────────────────────────────────────────────────────
log("Conectando...", "info")
setStatus("Conectando...", "connecting")
setDeviceReady(false)

const wavoip = new Wavoip({ tokens: ["c0f1b757-7e60-401e-be69-a4caebefec54"], platform: "wavoip-electron" })

for (const device of wavoip.getDevices()) {
    if (device.status === "open") setDeviceReady(true)

    device.on("statusChanged", status => {
        log(`Dispositivo: ${status}`, status === "open" ? "ok" : "info")
        if (status === "open") {
            setStatus("Pronto para chamadas", "open")
            setDeviceReady(true)
            document.getElementById("qr-section").style.display = "none"
        } else {
            setStatus(`Dispositivo: ${status}`, status === "disconnected" ? "error" : "connecting")
            setDeviceReady(false)
        }
    })

    device.on("qrCodeChanged", qrCode => {
        if (qrCode) { setStatus("Escaneie o QR Code", "connecting"); renderQR(qrCode) }
        else document.getElementById("qr-section").style.display = "none"
    })
}

// ── Chamadas recebidas ────────────────────────────────────────────────────────
wavoip.on("offer", async (offer) => {
    const phone = offer.peer?.phone ?? "Desconhecido"
    const nome  = await resolveNome(phone)
    pendingOffer = offer

    document.getElementById("incoming-from").textContent = nome !== phone ? `${nome}\n${phone}` : phone
    document.getElementById("incoming-overlay").classList.add("show")
    startRingtone()
    api?.incomingCall()
    log(`Chamada recebida de ${nome ?? phone}`, "info")

    offer.on("ended", () => {
        if (pendingOffer !== offer) return
        stopRingtone()
        pendingOffer = null
        document.getElementById("incoming-overlay").classList.remove("show")
        api?.callEnded()
        api?.registros.inserir("perdida", phone, nome !== phone ? nome : null)
        log("Chamador desligou antes de atender", "err")
        loadHistory(); loadDashboard()
    })
})

document.getElementById("btn-accept").addEventListener("click", async () => {
    if (!pendingOffer) return
    stopRingtone()
    const phone = document.getElementById("incoming-from").textContent.split("\n").pop()
    document.getElementById("incoming-overlay").classList.remove("show")

    const { call, err } = await pendingOffer.accept()
    pendingOffer = null
    if (err) { log(`Erro ao aceitar: ${err.message}`, "err"); return }

    activeCall    = call
    callStartTime = Date.now()
    const nome    = await resolveNome(phone)
    activeRecordId = await api?.registros.inserir("recebida", phone, nome !== phone ? nome : null)
    showCallControls(true)
    log("Chamada em andamento", "ok")

    call.on("ended", async () => {
        const dur = callDuration()
        if (activeRecordId) await api?.registros.finalizar(activeRecordId, dur, true)
        activeCall = null; activeRecordId = null; callStartTime = null
        showCallControls(false)
        api?.callEnded()
        log(`Chamada encerrada (${dur}s)`, "info")
        loadHistory(); loadDashboard()
    })
})

document.getElementById("btn-reject").addEventListener("click", async () => {
    if (!pendingOffer) return
    stopRingtone()
    const phone = document.getElementById("incoming-from").textContent.split("\n").pop()
    await pendingOffer.reject()
    pendingOffer = null
    document.getElementById("incoming-overlay").classList.remove("show")
    api?.callEnded()
    await api?.registros.inserir("perdida", phone, null)
    log("Chamada recusada", "info")
    loadHistory(); loadDashboard()
})

// ── Chamadas saintes ──────────────────────────────────────────────────────────
document.getElementById("btn-call").addEventListener("click", async () => {
    const phone = document.getElementById("phone-input").value.trim()
    if (!phone) return
    const btnCall = document.getElementById("btn-call")
    btnCall.disabled = true
    log(`Ligando para ${phone}...`, "info")

    const nome = await resolveNome(phone)
    activeRecordId = await api?.registros.inserir("realizada", phone, nome !== phone ? nome : null)

    let result
    try { result = await wavoip.startCall({ to: phone }) }
    catch (e) {
        log(`Exceção: ${e.message}`, "err")
        if (activeRecordId) await api?.registros.finalizar(activeRecordId, 0, false)
        btnCall.disabled = false; return
    }

    const { call, err } = result
    if (err) {
        const detail = err.devices
            ? err.devices.map(d => `${d.reason}`).join("; ")
            : err.message
        log(`Falha: ${detail}`, "err")
        if (activeRecordId) await api?.registros.finalizar(activeRecordId, 0, false)
        activeRecordId = null; btnCall.disabled = false; return
    }

    call.on("peerAccept", active => {
        activeCall = active; callStartTime = Date.now()
        showCallControls(true); log("Atendida!", "ok")
    })

    call.on("peerReject", async () => {
        if (activeRecordId) await api?.registros.finalizar(activeRecordId, 0, false)
        activeRecordId = null; btnCall.disabled = false
        log("Recusada pelo destinatário", "err")
        loadHistory(); loadDashboard()
    })

    call.on("unanswered", async () => {
        if (activeRecordId) await api?.registros.finalizar(activeRecordId, 0, false)
        activeRecordId = null; btnCall.disabled = false
        log("Sem resposta", "err")
        loadHistory(); loadDashboard()
    })

    call.on("ended", async () => {
        const dur = callDuration()
        if (activeRecordId) await api?.registros.finalizar(activeRecordId, dur, dur > 0)
        activeCall = null; activeRecordId = null; callStartTime = null
        showCallControls(false); btnCall.disabled = false
        log(`Encerrada (${dur}s)`, "info")
        loadHistory(); loadDashboard()
    })
})

document.getElementById("btn-mute").addEventListener("click", async () => {
    if (!activeCall) return
    if (muted) { await activeCall.unmute(); document.getElementById("btn-mute").textContent = "Mutar"; muted = false }
    else        { await activeCall.mute();  document.getElementById("btn-mute").textContent = "Desmutar"; muted = true }
})

document.getElementById("btn-end").addEventListener("click", async () => {
    if (!activeCall) return
    await activeCall.end()
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function resolveNome(numero) {
    if (!api) return numero
    try {
        const contatos = await api.contatos.listar()
        const found = contatos.find(c => c.numero === numero || c.numero === numero.replace(/\D/g, ""))
        return found ? found.nome : numero
    } catch { return numero }
}

function dialpad(phone) {
    document.getElementById("phone-input").value = phone
    document.querySelectorAll("nav button")[0].click()
}

// ── Contacts ──────────────────────────────────────────────────────────────────
let editingId = null

async function loadContacts(filter = "") {
    const list = document.getElementById("contacts-list")
    list.innerHTML = ""
    if (!api) return
    const contatos = await api.contatos.listar()
    const filtered = filter
        ? contatos.filter(c => c.nome.toLowerCase().includes(filter.toLowerCase()) || c.numero.includes(filter))
        : contatos

    if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-state">Nenhum contato encontrado</div>`
        return
    }

    filtered.forEach(c => {
        const div = document.createElement("div")
        div.className = "contact-item"
        div.innerHTML = `
            <div class="contact-avatar">${c.nome[0].toUpperCase()}</div>
            <div class="contact-info">
                <div class="contact-name">${c.nome}</div>
                <div class="contact-number">${c.numero}</div>
            </div>
            <div class="contact-actions">
                <button class="btn-call-contact" data-num="${c.numero}">Ligar</button>
                <button class="btn-edit-contact" data-id="${c.id}" data-nome="${c.nome}" data-num="${c.numero}">Editar</button>
                <button class="btn-del-contact"  data-id="${c.id}">✕</button>
            </div>`
        div.querySelector(".btn-call-contact").addEventListener("click", () => dialpad(c.numero))
        div.querySelector(".btn-edit-contact").addEventListener("click", () => openForm(c.id, c.nome, c.numero))
        div.querySelector(".btn-del-contact").addEventListener("click",  async () => {
            await api.contatos.deletar(c.id); loadContacts()
        })
        list.appendChild(div)
    })
}

function openForm(id = null, nome = "", numero = "") {
    editingId = id
    document.getElementById("form-nome").value   = nome
    document.getElementById("form-numero").value = numero
    document.getElementById("contact-form").classList.add("show")
    document.getElementById("form-nome").focus()
}

document.getElementById("btn-new-contact").addEventListener("click", () => openForm())
document.getElementById("btn-cancel-contact").addEventListener("click", () => {
    document.getElementById("contact-form").classList.remove("show"); editingId = null
})
document.getElementById("btn-save-contact").addEventListener("click", async () => {
    const nome   = document.getElementById("form-nome").value.trim()
    const numero = document.getElementById("form-numero").value.trim()
    if (!nome || !numero) return
    if (editingId) await api.contatos.atualizar(editingId, nome, numero)
    else           await api.contatos.criar(nome, numero)
    document.getElementById("contact-form").classList.remove("show")
    editingId = null; loadContacts()
})
document.getElementById("contact-search").addEventListener("input", e => loadContacts(e.target.value))

// ── History ───────────────────────────────────────────────────────────────────
const ICONS  = { recebida: "📥", realizada: "📤", perdida: "📵" }
const LABELS = { recebida: "Recebida", realizada: "Realizada", perdida: "Perdida" }

function badgeInfo(r) {
    if (r.tipo === "perdida")                          return { cls: "badge-perdida",   label: "Perdida",        row: "perdida" }
    if (r.tipo === "recebida"  && r.atendida)          return { cls: "badge-atendida",  label: "Atendida",       row: "atendida" }
    if (r.tipo === "realizada" && r.atendida)          return { cls: "badge-atendida",  label: "Atendida",       row: "atendida" }
    if (r.tipo === "realizada" && !r.atendida)         return { cls: "badge-nao-atend", label: "Não atendida",   row: "nao-atend" }
    return { cls: "badge-perdida", label: "Perdida", row: "perdida" }
}

function historyRow(r, showDur = true) {
    const { cls, label, row } = badgeInfo(r)
    const durStr  = r.duracao > 0 ? `${r.duracao}s` : ""
    const dataStr = new Date(r.inicio).toLocaleString("pt-BR")
    const meta    = [LABELS[r.tipo], dataStr, showDur && durStr ? durStr : null].filter(Boolean).join(" · ")
    const div = document.createElement("div")
    div.className = `history-item ${row}`
    div.innerHTML = `
        <div class="history-icon ${r.tipo}">${ICONS[r.tipo]}</div>
        <div class="history-info">
            <div class="history-name" style="display:flex;align-items:center;gap:8px">
                ${r.nome ?? r.numero}
                <span class="history-badge ${cls}">${label}</span>
            </div>
            ${r.nome ? `<div class="history-number">${r.numero}</div>` : ""}
            <div class="history-meta">${meta}</div>
        </div>
        <button class="btn-return" data-num="${r.numero}">Retornar</button>`
    div.querySelector(".btn-return").addEventListener("click", () => dialpad(r.numero))
    return div
}

async function loadHistory() {
    const list = document.getElementById("history-list")
    list.innerHTML = ""
    if (!api) return
    const registros = await api.registros.listar(100)
    if (registros.length === 0) {
        list.innerHTML = `<div class="empty-state">Nenhum registro ainda</div>`
        return
    }
    registros.forEach(r => list.appendChild(historyRow(r)))
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
    if (!api) return
    const [stats, recent] = await Promise.all([api.registros.stats(), api.registros.listar(5)])

    document.getElementById("stat-atendidas").textContent      = stats.recebidas_atendidas ?? 0
    document.getElementById("stat-perdidas").textContent       = stats.perdidas ?? 0
    document.getElementById("stat-realizadas").textContent     = stats.realizadas_atendidas ?? 0
    document.getElementById("stat-duracao").textContent        = stats.duracao_media ? `${stats.duracao_media}s` : "—"
    document.getElementById("stat-realizadas-nao").textContent = stats.realizadas_nao_atendidas ?? 0
    document.getElementById("stat-total").textContent          = stats.total ?? 0

    const el = document.getElementById("dashboard-recent")
    el.innerHTML = ""
    if (recent.length === 0) { el.innerHTML = `<div class="empty-state">Sem registros</div>`; return }
    recent.forEach(r => el.appendChild(historyRow(r, false)))
}
