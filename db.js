import mysql from "mysql2/promise"
import crypto from "crypto"
import bcrypt from "bcryptjs"

// ── Credenciais criptografadas (AES-256) ──────────────────────────────────────
const _K = Buffer.alloc(32); Buffer.from("w4v01p-1c0r3-s3cr3t-k3y").copy(_K)
const _I = Buffer.alloc(16); Buffer.from("w4v01p1v16bytes!").copy(_I)
const _d = (h) => { const c = crypto.createDecipheriv("aes-256-cbc", _K, _I); return c.update(h, "hex", "utf8") + c.final("utf8") }

const DB = {
    host:     _d("28d3d3bc63bd6e8764610bf6d8b18618"),
    port:     Number(_d("d0cb679d03d959cf5195833dce4dff63")),
    user:     _d("9278ed4e3bcd5164df772aba03fe2601"),
    password: _d("435cb6a372b5ca112ba0395e33b0145a3d6751330238193ff37d7f38d7f87b66"),
    database: _d("48cbaef46d6404037eb564cd41cde7b3"),
}

// ── Pool ──────────────────────────────────────────────────────────────────────
let pool = null

export async function getPool() {
    if (pool) return pool
    pool = mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 5 })
    await migrate(pool)
    return pool
}

// ── Migrations ────────────────────────────────────────────────────────────────
async function migrate(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_usuarios (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            nome       VARCHAR(100) NOT NULL,
            email      VARCHAR(100) NOT NULL UNIQUE,
            senha_hash VARCHAR(255) NOT NULL,
            tipo       ENUM('admin','usuario') DEFAULT 'usuario',
            ativo      TINYINT(1) DEFAULT 1,
            criado_em  DATETIME DEFAULT NOW()
        )`)

    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_tokens (
            id        INT AUTO_INCREMENT PRIMARY KEY,
            nome      VARCHAR(100) NOT NULL,
            token     VARCHAR(255) NOT NULL,
            ativo     TINYINT(1) DEFAULT 1,
            criado_em DATETIME DEFAULT NOW()
        )`)

    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_usuario_token (
            usuario_id INT NOT NULL,
            token_id   INT NOT NULL,
            PRIMARY KEY (usuario_id, token_id),
            FOREIGN KEY (usuario_id) REFERENCES wavoip_usuarios(id) ON DELETE CASCADE,
            FOREIGN KEY (token_id)   REFERENCES wavoip_tokens(id)   ON DELETE CASCADE
        )`)

    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_contatos (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            nome       VARCHAR(100) NOT NULL,
            numero     VARCHAR(30)  NOT NULL,
            criado_em  DATETIME DEFAULT NOW()
        )`)

    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_registros (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            tipo       ENUM('recebida','realizada','perdida') NOT NULL,
            numero     VARCHAR(30)  NOT NULL,
            nome       VARCHAR(100) DEFAULT NULL,
            usuario_id INT          DEFAULT NULL,
            inicio     DATETIME     DEFAULT NOW(),
            duracao    INT          DEFAULT 0,
            atendida   TINYINT(1)   DEFAULT 0
        )`)

    // Cria admin padrão se não existir nenhum usuário
    const [[{ total }]] = await db.execute("SELECT COUNT(*) as total FROM wavoip_usuarios")
    if (total === 0) {
        const hash = await bcrypt.hash("Admin@2024", 12)
        await db.execute(
            "INSERT INTO wavoip_usuarios (nome, email, senha_hash, tipo) VALUES (?, ?, ?, 'admin')",
            ["Administrador", "admin@wavoip.com", hash]
        )
    }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function autenticar(email, senha) {
    const db = await getPool()
    const [[user]] = await db.execute(
        "SELECT * FROM wavoip_usuarios WHERE email = ? AND ativo = 1", [email]
    )
    if (!user) return null
    const ok = await bcrypt.compare(senha, user.senha_hash)
    if (!ok) return null
    return { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo }
}

export async function alterarSenha(id, senhaAtual, novaSenha) {
    const db = await getPool()
    const [[user]] = await db.execute("SELECT senha_hash FROM wavoip_usuarios WHERE id = ?", [id])
    if (!user) return { ok: false, msg: "Usuário não encontrado" }
    const ok = await bcrypt.compare(senhaAtual, user.senha_hash)
    if (!ok) return { ok: false, msg: "Senha atual incorreta" }
    const hash = await bcrypt.hash(novaSenha, 12)
    await db.execute("UPDATE wavoip_usuarios SET senha_hash = ? WHERE id = ?", [hash, id])
    return { ok: true }
}

// ── Usuários ──────────────────────────────────────────────────────────────────
export async function listarUsuarios() {
    const db = await getPool()
    const [rows] = await db.execute(`
        SELECT u.id, u.nome, u.email, u.tipo, u.ativo, u.criado_em,
               COUNT(ut.token_id) as total_tokens
        FROM wavoip_usuarios u
        LEFT JOIN wavoip_usuario_token ut ON ut.usuario_id = u.id
        GROUP BY u.id ORDER BY u.nome`)
    return rows
}

export async function criarUsuario(nome, email, senha, tipo = "usuario") {
    const db = await getPool()
    const hash = await bcrypt.hash(senha, 12)
    const [r] = await db.execute(
        "INSERT INTO wavoip_usuarios (nome, email, senha_hash, tipo) VALUES (?, ?, ?, ?)",
        [nome, email, hash, tipo]
    )
    return { id: r.insertId, nome, email, tipo }
}

export async function atualizarUsuario(id, nome, email, tipo, ativo) {
    const db = await getPool()
    await db.execute(
        "UPDATE wavoip_usuarios SET nome=?, email=?, tipo=?, ativo=? WHERE id=?",
        [nome, email, tipo, ativo, id]
    )
}

export async function resetarSenha(id, novaSenha) {
    const db = await getPool()
    const hash = await bcrypt.hash(novaSenha, 12)
    await db.execute("UPDATE wavoip_usuarios SET senha_hash=? WHERE id=?", [hash, id])
}

export async function deletarUsuario(id) {
    const db = await getPool()
    await db.execute("DELETE FROM wavoip_usuarios WHERE id=?", [id])
}

// ── Tokens ────────────────────────────────────────────────────────────────────
export async function listarTokens() {
    const db = await getPool()
    const [rows] = await db.execute(`
        SELECT t.id, t.nome, t.token, t.ativo, t.criado_em,
               COUNT(ut.usuario_id) as total_usuarios
        FROM wavoip_tokens t
        LEFT JOIN wavoip_usuario_token ut ON ut.token_id = t.id
        GROUP BY t.id ORDER BY t.nome`)
    return rows
}

export async function criarToken(nome, token) {
    const db = await getPool()
    const [r] = await db.execute(
        "INSERT INTO wavoip_tokens (nome, token) VALUES (?, ?)", [nome, token]
    )
    return { id: r.insertId, nome, token }
}

export async function atualizarToken(id, nome, token, ativo) {
    const db = await getPool()
    await db.execute(
        "UPDATE wavoip_tokens SET nome=?, token=?, ativo=? WHERE id=?",
        [nome, token, ativo, id]
    )
}

export async function deletarToken(id) {
    const db = await getPool()
    await db.execute("DELETE FROM wavoip_tokens WHERE id=?", [id])
}

// ── Vínculos usuário ↔ token ──────────────────────────────────────────────────
export async function tokensPorUsuario(usuarioId) {
    const db = await getPool()
    const [rows] = await db.execute(`
        SELECT t.id, t.nome, t.token FROM wavoip_tokens t
        JOIN wavoip_usuario_token ut ON ut.token_id = t.id
        WHERE ut.usuario_id = ? AND t.ativo = 1`, [usuarioId])
    return rows
}

export async function vincularToken(usuarioId, tokenId) {
    const db = await getPool()
    await db.execute(
        "INSERT IGNORE INTO wavoip_usuario_token (usuario_id, token_id) VALUES (?, ?)",
        [usuarioId, tokenId]
    )
}

export async function desvincularToken(usuarioId, tokenId) {
    const db = await getPool()
    await db.execute(
        "DELETE FROM wavoip_usuario_token WHERE usuario_id=? AND token_id=?",
        [usuarioId, tokenId]
    )
}

export async function vinculosDoUsuario(usuarioId) {
    const db = await getPool()
    const [rows] = await db.execute(
        "SELECT token_id FROM wavoip_usuario_token WHERE usuario_id=?", [usuarioId]
    )
    return rows.map(r => r.token_id)
}

// ── Contatos ──────────────────────────────────────────────────────────────────
export async function listarContatos() {
    const db = await getPool()
    const [rows] = await db.execute("SELECT * FROM wavoip_contatos ORDER BY nome")
    return rows
}

export async function criarContato(nome, numero) {
    const db = await getPool()
    const [r] = await db.execute(
        "INSERT INTO wavoip_contatos (nome, numero) VALUES (?, ?)", [nome, numero]
    )
    return { id: r.insertId, nome, numero }
}

export async function atualizarContato(id, nome, numero) {
    const db = await getPool()
    await db.execute("UPDATE wavoip_contatos SET nome=?, numero=? WHERE id=?", [nome, numero, id])
}

export async function deletarContato(id) {
    const db = await getPool()
    await db.execute("DELETE FROM wavoip_contatos WHERE id=?", [id])
}

// ── Registros ─────────────────────────────────────────────────────────────────
export async function inserirRegistro(tipo, numero, nome = null, usuarioId = null) {
    const db = await getPool()
    const [r] = await db.execute(
        "INSERT INTO wavoip_registros (tipo, numero, nome, usuario_id) VALUES (?, ?, ?, ?)",
        [tipo, numero, nome, usuarioId]
    )
    return r.insertId
}

export async function finalizarRegistro(id, duracao, atendida) {
    const db = await getPool()
    await db.execute(
        "UPDATE wavoip_registros SET duracao=?, atendida=? WHERE id=?",
        [duracao, atendida ? 1 : 0, id]
    )
}

export async function listarRegistros(limite = 50) {
    const db = await getPool()
    const [rows] = await db.execute(
        "SELECT * FROM wavoip_registros ORDER BY inicio DESC LIMIT ?", [limite]
    )
    return rows
}

export async function estatisticas() {
    const db = await getPool()
    const [[totais]] = await db.execute(`
        SELECT
            COUNT(*) AS total,
            SUM(tipo = 'recebida'  AND atendida = 1) AS recebidas_atendidas,
            SUM(tipo = 'perdida'   OR (tipo = 'recebida' AND atendida = 0)) AS perdidas,
            SUM(tipo = 'realizada' AND atendida = 1) AS realizadas_atendidas,
            SUM(tipo = 'realizada' AND atendida = 0) AS realizadas_nao_atendidas,
            ROUND(AVG(CASE WHEN duracao > 0 THEN duracao END)) AS duracao_media
        FROM wavoip_registros
    `)
    return totais
}
