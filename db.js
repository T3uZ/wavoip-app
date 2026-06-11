import mysql from "mysql2/promise"
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import path from "path"

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") })

let pool = null

export async function getPool() {
    if (pool) return pool
    pool = mysql.createPool({
        host:     process.env.DB_HOST,
        port:     Number(process.env.DB_PORT),
        user:     process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
    })
    await migrate(pool)
    return pool
}

async function migrate(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_contatos (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            nome       VARCHAR(100) NOT NULL,
            numero     VARCHAR(30)  NOT NULL,
            criado_em  DATETIME     DEFAULT NOW()
        )
    `)
    await db.execute(`
        CREATE TABLE IF NOT EXISTS wavoip_registros (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            tipo       ENUM('recebida','realizada','perdida') NOT NULL,
            numero     VARCHAR(30)  NOT NULL,
            nome       VARCHAR(100) DEFAULT NULL,
            inicio     DATETIME     DEFAULT NOW(),
            duracao    INT          DEFAULT 0,
            atendida   TINYINT(1)   DEFAULT 0
        )
    `)
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
export async function inserirRegistro(tipo, numero, nome = null) {
    const db = await getPool()
    const [r] = await db.execute(
        "INSERT INTO wavoip_registros (tipo, numero, nome) VALUES (?, ?, ?)", [tipo, numero, nome]
    )
    return r.insertId
}

export async function finalizarRegistro(id, duracao, atendida) {
    const db = await getPool()
    await db.execute(
        "UPDATE wavoip_registros SET duracao=?, atendida=? WHERE id=?", [duracao, atendida ? 1 : 0, id]
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
