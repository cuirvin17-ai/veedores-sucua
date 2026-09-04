/**
 * server.js — Sistema de Veedores Electorales Sucúa 2026
 */

const express   = require('express');
const mysql     = require('mysql2');
const cors      = require('cors');
const helmet    = require('helmet');
const crypto    = require('crypto');
const ExcelJS   = require('exceljs');
const archiver  = require('archiver');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);

// ── DIRECTORIO DE UPLOADS ─────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── MULTER (subida de fotos de actas) ────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase();
        const name = `acta_${req.body.junta_id || Date.now()}_${Date.now()}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB máx
    fileFilter: (req, file, cb) => {
        const allow = /jpeg|jpg|png|webp|heic/;
        if (allow.test(path.extname(file.originalname).toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error('Solo se aceptan imágenes (jpg, png, webp)'));
        }
    }
});

// ── CORS ──────────────────────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','ngrok-skip-browser-warning']
}));

// ── NO-CACHE PARA API ─────────────────────────────────────────────────
const noStore = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
};

// ── MIDDLEWARE ────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    message: '⚠️ Demasiados intentos. Espera 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: '⚠️ Demasiados registros. Espera 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false
});

// ── ARCHIVOS ESTÁTICOS ────────────────────────────────────────────────
const publicPath = path.resolve(__dirname);
app.use('/veedores_sucua', express.static(publicPath, { maxAge: '0', etag: false }));
// Servir fotos de actas directamente (sin prefijo de ruta)
app.use('/uploads', express.static(uploadsDir));

// ── BASE DE DATOS ─────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
let isPostgres = false;
let pgPool;
let db;

if (DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    isPostgres = true;

    function pgConvert(sql, params = []) {
        let idx = 1;
        let s = sql.replace(/\?/g, () => `$${idx++}`);
        const pkMap = { sistema_config: 'clave', dignidad_config: 'clave', usuarios: 'usuario', fotos_actas: 'junta_id', resultados: 'junta_id, dignidad, candidato' };
        const tableMatch = s.match(/INSERT\s+INTO\s+(\w+)/i);
        const tableName = tableMatch ? tableMatch[1] : '';
        const pk = pkMap[tableName] || 'id';
        s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(\w+)\s*=\s*VALUES\(\1\)/gi, `ON CONFLICT (${pk}) DO UPDATE SET $1 = EXCLUDED.$1`);
        s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(\w+)\s*=\s*VALUES\(\w+\)/gi, `ON CONFLICT (${pk}) DO UPDATE SET $1 = EXCLUDED.$1`);
        s = s.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT INTO');
        s = s.replace(/INSERT\s+IGNORE/gi, 'INSERT');
        s = s.replace(/ORDER BY FIELD\((\w+),\s*'([^']+)'(?:,\s*'([^']+)')*(?:,\s*'([^']+)')*\)/g, (_, col, v1, v2, v3) => {
            let caseExpr = `CASE ${col}`;
            if (v1) caseExpr += ` WHEN '${v1}' THEN 1`;
            if (v2) caseExpr += ` WHEN '${v2}' THEN 2`;
            if (v3) caseExpr += ` WHEN '${v3}' THEN 3`;
            caseExpr += ' END';
            return `ORDER BY ${caseExpr}`;
        });
        s = s.replace(/IF\(([^,]+),\s*'([^']*)',\s*'([^']*)'\)/gi, "CASE WHEN $1 THEN '$2' ELSE '$3' END");
        s = s.replace(/DATE_FORMAT\((\w+\.\w+),\s*'%d\/%m\/%Y'\)/g, "TO_CHAR($1, 'DD/MM/YYYY')");
        s = s.replace(/DATE_FORMAT\((\w+\.\w+),\s*'%H:%i:%s'\)/g, "TO_CHAR($1, 'HH24:MI:SS')");
        s = s.replace(/TINYINT\(1\)/gi, 'BOOLEAN');
        s = s.replace(/IFNULL\((\w+),\s*([^)]+)\)/gi, 'COALESCE($1, $2)');
        return { sql: s, params };
    }

    function coerceNumericStrings(rows) {
        if (!rows || !rows.length) return rows;
        return rows.map(row => {
            const out = {};
            for (const [k, v] of Object.entries(row)) {
                out[k] = (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : v;
            }
            return out;
        });
    }

    db = {
        execute: async (sql, params = []) => {
            const converted = pgConvert(sql, params);
            let pgSql = converted.sql;
            let isInsert = /^\s*INSERT\s/i.test(pgSql);
            let isWrite = /^\s*(INSERT|UPDATE|DELETE)\s/i.test(pgSql);
            if (isInsert && !/RETURNING/i.test(pgSql)) pgSql += ' RETURNING *';
            try {
                const result = await pgPool.query(pgSql, converted.params);
                if (isInsert && result.rows.length > 0) {
                    const row = result.rows[0];
                    return [{ insertId: row.id || row.clave || 0, affectedRows: result.rowCount }, result.fields];
                }
                if (isWrite) return [{ affectedRows: result.rowCount }, result.fields];
                return [coerceNumericStrings(result.rows), result.fields];
            } catch (err) {
                if (err.code === '23505') { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
                throw err;
            }
        },
        query: async (sql, params = []) => {
            const converted = pgConvert(sql, params);
            let pgSql = converted.sql;
            let isInsert = /^\s*INSERT\s/i.test(pgSql);
            if (isInsert && !/RETURNING/i.test(pgSql)) pgSql += ' RETURNING *';
            try {
                const result = await pgPool.query(pgSql, converted.params);
                if (isInsert && result.rows.length > 0) {
                    const row = result.rows[0];
                    return [{ insertId: row.id || row.clave || 0, affectedRows: result.rowCount }, result.fields];
                }
                if (/^\s*(INSERT|UPDATE|DELETE)\s/i.test(pgSql)) return [{ affectedRows: result.rowCount }, result.fields];
                return [coerceNumericStrings(result.rows), result.fields];
            } catch (err) {
                if (err.code === '23505') { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
                throw err;
            }
        }
    };

    console.log('✅ PostgreSQL detectado (DATABASE_URL)');
    pgPool.query('SELECT 1').then(() => {
        initSistemaConfig();
        initDignidadesConfig();
        console.log('✅ PostgreSQL conectado y tablas inicializadas');
    }).catch(err => console.error('❌ PostgreSQL:', err.message));
} else {
    const mysql = require('mysql2');
    const pool = mysql.createPool({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'Betoben1',
        database: process.env.DB_NAME || 'veedores_sucua_bd',
        charset:  'utf8mb4',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    db = pool.promise();

    pool.getConnection((err, conn) => {
        if (err) console.error('❌ MySQL:', err.message);
        else {
            console.log('✅ MySQL conectado');
            conn.release();
            initSistemaConfig();
            asegurarColumnaPassword();
            initDignidadesConfig();
            asegurarColumnasDignidad();
        }
    });
}

async function initSistemaConfig() {
    try {
        if (isPostgres) {
            await db.execute(`CREATE TABLE IF NOT EXISTS sistema_config (clave VARCHAR(64) PRIMARY KEY, valor VARCHAR(255) NOT NULL DEFAULT '0')`);
            await db.execute("INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', '0') ON CONFLICT DO NOTHING");
            return;
        }
        await db.execute(`
            CREATE TABLE IF NOT EXISTS sistema_config (
                clave VARCHAR(64) PRIMARY KEY,
                valor VARCHAR(255) NOT NULL DEFAULT '0'
            )
        `);
        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado'"
        );
        if (!rows.length) {
            await db.execute(
                "INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', '0')"
            );
        }
    } catch (err) {
        console.error('❌ Error init sistema_config:', err.message);
    }
}

async function estaAccesoBloqueado() {
    try {
        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado' LIMIT 1"
        );
        return rows.length > 0 && String(rows[0].valor) === '1';
    } catch (err) {
        console.error('❌ Error leyendo acceso_bloqueado:', err.message);
        return false;
    }
}

async function setAccesoBloqueado(bloquear) {
    await db.execute(
        `INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [bloquear ? '1' : '0']
    );
}

async function asegurarColumnaPassword() {
    try {
        const [cols] = await db.execute(
            "SELECT CHARACTER_MAXIMUM_LENGTH AS maxlen FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'password' LIMIT 1"
        );
        const maxLen = Number(cols?.[0]?.maxlen || 0);
        if (!maxLen || maxLen < 255) {
            await db.execute("ALTER TABLE usuarios MODIFY COLUMN password VARCHAR(255) NOT NULL");
            console.log('✅ Columna password ampliada a VARCHAR(255)');
        }
    } catch (err) {
        console.error('⚠️ Error verificando columna password:', err.message);
    }
}

// ── DIGNIDADES ─────────────────────────────────────────────────────────
const DIGNIDADES_CONFIG = ['ALCALDE', 'CONCEJALES_URBANOS', 'CONCEJALES_RURALES', 'JUNTAS_PARROQUIALES'];

async function initDignidadesConfig() {
    try {
        if (isPostgres) {
            await db.execute(`CREATE TABLE IF NOT EXISTS dignidad_config (clave VARCHAR(64) PRIMARY KEY, habilitada BOOLEAN NOT NULL DEFAULT TRUE)`);
            for (const clave of DIGNIDADES_CONFIG) {
                await db.execute(`INSERT INTO dignidad_config (clave, habilitada) VALUES ($1, true) ON CONFLICT DO NOTHING`, [clave]);
            }
            return;
        }
        await db.execute(`
            CREATE TABLE IF NOT EXISTS dignidad_config (
                clave VARCHAR(64) PRIMARY KEY,
                habilitada TINYINT(1) NOT NULL DEFAULT 1
            )
        `);
        for (const clave of DIGNIDADES_CONFIG) {
            await db.execute(
                `INSERT IGNORE INTO dignidad_config (clave, habilitada) VALUES (?, 1)`, [clave]
            );
        }
    } catch (err) {
        console.error('❌ Error init dignidad_config:', err.message);
    }
}

async function obtenerEstadoDignidades() {
    try {
        if (isPostgres) {
            const [rows] = await db.execute('SELECT clave, habilitada FROM dignidad_config');
            return rows;
        }
        const [rows] = await db.execute('SELECT clave, habilitada FROM dignidad_config ORDER BY FIELD(clave, ?,?,?,?)', DIGNIDADES_CONFIG);
        return rows;
    } catch (err) {
        console.error('❌ Error estado dignidades:', err.message);
        return DIGNIDADES_CONFIG.map(c => ({ clave: c, habilitada: 1 }));
    }
}

async function estaDignidadHabilitada(clave) {
    try {
        const [rows] = await db.execute('SELECT habilitada FROM dignidad_config WHERE clave=? LIMIT 1', [clave]);
        return rows.length > 0 && rows[0].habilitada === 1;
    } catch (err) {
        return true;
    }
}

async function setDignidadHabilitada(clave, habilitada) {
    await db.execute(
        'INSERT INTO dignidad_config (clave, habilitada) VALUES (?, ?) ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada)',
        [clave, habilitada ? 1 : 0]
    );
}

async function asegurarColumnasDignidad() {
    try {
        // candidatos
        const [cCols] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidatos' AND COLUMN_NAME = 'dignidad'"
        );
        if (!cCols?.[0]?.total) {
            await db.execute("ALTER TABLE candidatos ADD COLUMN dignidad VARCHAR(40) NOT NULL DEFAULT 'ALCALDE' AFTER id, ADD INDEX idx_dignidad (dignidad)");
            console.log('✅ Columna dignidad agregada en candidatos');
        }
        // resultados
        const [rCols] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'resultados' AND COLUMN_NAME = 'dignidad'"
        );
        if (!rCols?.[0]?.total) {
            await db.execute("ALTER TABLE resultados ADD COLUMN dignidad VARCHAR(40) NOT NULL DEFAULT 'ALCALDE' AFTER junta_id, ADD INDEX idx_dignidad (dignidad)");
            console.log('✅ Columna dignidad agregada en resultados');
            // Recrear UNIQUE KEY
            try { await db.execute('ALTER TABLE resultados DROP INDEX uq_resultado'); } catch (e) {}
            await db.execute('ALTER TABLE resultados ADD UNIQUE KEY uq_resultado (junta_id, dignidad, candidato)');
            console.log('✅ UNIQUE KEY actualizado en resultados');
        }
        // juntas
        const [jCols] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'juntas' AND COLUMN_NAME = 'dignidad'"
        );
        if (!jCols?.[0]?.total) {
            await db.execute("ALTER TABLE juntas ADD COLUMN dignidad VARCHAR(40) DEFAULT NULL AFTER numero_junta, ADD INDEX idx_junta_dignidad (dignidad)");
            console.log('✅ Columna dignidad agregada en juntas');
            try { await db.execute('ALTER TABLE juntas DROP INDEX uq_junta'); } catch (e) {}
            await db.execute('ALTER TABLE juntas ADD UNIQUE KEY uq_junta (parroquia, zona, numero_junta, dignidad)');
            console.log('✅ UNIQUE KEY actualizado en juntas');
        }
    } catch (err) {
        console.error('⚠️ Error asegurando columnas dignidad:', err.message);
    }
}

// Database connection handled above

// ── SESSION MANAGEMENT ───────────────────────────────────────────────
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sesiones = new Map();

function limpiarSesionesExpiradas() {
    const ahora = Date.now();
    for (const [token, sesion] of sesiones.entries()) {
        if (!sesion || sesion.expiresAt <= ahora) sesiones.delete(token);
    }
}

// ── PASSWORD HASHING (PBKDF2) ────────────────────────────────────────
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
    return `pbkdf2$${salt}$${hash}`;
}

function verificarPassword(password, stored) {
    if (typeof stored !== 'string' || typeof password !== 'string') return false;
    if (!stored.startsWith('pbkdf2$')) return password === stored;
    const partes = stored.split('$');
    if (partes.length !== 3) return false;
    const salt = partes[1];
    const hashGuardado = partes[2];
    const hashCalculado = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
    if (hashGuardado.length !== hashCalculado.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hashGuardado, 'hex'), Buffer.from(hashCalculado, 'hex'));
}

// ── SESSION TOKEN ─────────────────────────────────────────────────────
function crearSesion(usuario) {
    limpiarSesionesExpiradas();
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, {
        user: { id: usuario.id, usuario: usuario.usuario, rol: usuario.rol, cedula: usuario.cedula },
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────
function autenticarSesion(req, res, next) {
    limpiarSesionesExpiradas();
    const auth = req.headers.authorization || '';
    const tokenEncabezado = req.headers['x-session-token'];
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : tokenEncabezado;
    if (!token) return res.status(401).json({ success: false, message: 'Sesión requerida' });
    const sesion = sesiones.get(token);
    if (!sesion) return res.status(401).json({ success: false, message: 'Sesión inválida o expirada' });
    req.auth = { token, user: sesion.user };
    next();
}

function requiereRol(...rolesPermitidos) {
    return (req, res, next) => {
        const rol = req.auth?.user?.rol || '';
        if (!rolesPermitidos.includes(rol))
            return res.status(403).json({ success: false, message: 'No tiene permisos para realizar esta acción' });
        next();
    };
}

// Aplicar auth a rutas protegidas
const rutasProtegidas = [
    '/registrar', '/usuarios', '/candidatos',
    '/bloqueo-acceso', '/todas-fotos', '/foto-acta',
    '/estadisticas', '/estadisticas-especiales', '/estadisticas-resumen',
    '/estadisticas-junta', '/juntas-pendientes', '/descargar-excel',
    '/descargar-fotos-actas', '/parroquias-disponibles', '/zonas-disponibles',
    '/subir-foto', '/registrar-resultados', '/resultados', '/junta-registrada',
    '/admin'
];
app.use(rutasProtegidas, autenticarSesion);

// ── NO-CACHE PARA RUTAS SENSIBLES ─────────────────────────────────────
const apiNoStore = [
    '/login', '/registrar', '/estado-acceso', '/bloqueo-acceso',
    '/usuarios', '/estadisticas', '/estadisticas-especiales',
    '/estadisticas-resumen', '/estadisticas-junta', '/juntas-pendientes',
    '/descargar-excel', '/descargar-fotos-actas',
    '/candidatos', '/todas-fotos', '/foto-acta', '/subir-foto',
    '/registrar-resultados', '/resultados',
    '/parroquias-disponibles', '/zonas-disponibles', '/junta-registrada'
];
app.use(apiNoStore, noStore);

// ── VALIDADORES ───────────────────────────────────────────────────────
function validarLogin(req, res, next) {
    const { usuario, password } = req.body;
    if (!usuario || !password)
        return res.status(400).json({ success: false, message: 'Campos requeridos' });
    if (typeof usuario !== 'string' || typeof password !== 'string')
        return res.status(400).json({ success: false, message: 'Formato inválido' });
    next();
}

function validarRegistro(req, res, next) {
    const { cedula, usuario, password, rol } = req.body;
    if (!cedula || !usuario || !password || !rol)
        return res.status(400).json({ success: false, message: 'Todos los campos son requeridos' });
    if (typeof cedula !== 'string' || typeof usuario !== 'string' || typeof password !== 'string' || typeof rol !== 'string')
        return res.status(400).json({ success: false, message: 'Formato inválido' });
    const rolesValidos = ['admin', 'veedor'];
    if (!rolesValidos.includes(rol))
        return res.status(400).json({ success: false, message: 'Rol no permitido' });
    next();
}

// ── RUTAS ─────────────────────────────────────────────────────────────

// Health
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Login
app.post('/login', loginLimiter, validarLogin, async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const [rows] = await db.execute(
            'SELECT id, usuario, rol, cedula, password FROM usuarios WHERE usuario=? LIMIT 1',
            [usuario]
        );
        if (rows.length === 0)
            return res.status(401).json({ success: false, message: 'Usuario o clave incorrectos' });

        const u = rows[0];
        const passwordOk = verificarPassword(password, u.password);
        if (!passwordOk)
            return res.status(401).json({ success: false, message: 'Usuario o clave incorrectos' });

        // Auto-actualizar contraseñas planas a PBKDF2
        if (typeof u.password === 'string' && !u.password.startsWith('pbkdf2$')) {
            await db.execute('UPDATE usuarios SET password=? WHERE id=?', [hashPassword(password), u.id]);
        }

        if (u.rol !== 'superadmin' && await estaAccesoBloqueado()) {
            return res.status(403).json({
                success: false,
                codigo: 'ACCESO_BLOQUEADO',
                message: 'El acceso al sistema está bloqueado. Solo el superadministrador puede ingresar.'
            });
        }

        const token = crearSesion(u);
        res.json({ success: true, token, user: { id: u.id, usuario: u.usuario, rol: u.rol, cedula: u.cedula } });
    } catch (err) {
        console.error('❌ Login:', err.message);
        res.status(500).json({ success: false, message: 'Error servidor' });
    }
});

// Registrar usuario (solo admin/superadmin con sesión)
app.post('/registrar', registerLimiter, validarRegistro, requiereRol('admin', 'superadmin'), async (req, res) => {
    const { cedula, usuario, password, rol } = req.body;

    if (await estaAccesoBloqueado()) {
        return res.status(403).json({
            success: false,
            codigo: 'ACCESO_BLOQUEADO',
            message: 'El sistema está bloqueado. No se pueden registrar usuarios.'
        });
    }
    try {
        const [exist] = await db.execute('SELECT id FROM usuarios WHERE usuario=?', [usuario]);
        if (exist.length > 0)
            return res.status(409).json({ success: false, message: `Usuario "${usuario}" ya existe` });

        const [result] = await db.execute(
            'INSERT INTO usuarios (cedula, usuario, password, rol) VALUES (?,?,?,?)',
            [cedula, usuario, hashPassword(password), rol]
        );
        res.json({ success: true, message: `Usuario "${usuario}" creado`, id: result.insertId });
    } catch (err) {
        console.error('❌ Registrar:', err.message);
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ success: false, message: 'El usuario o cédula ya existe' });
        res.status(500).json({ success: false, message: 'Error interno' });
    }
});

// Estado de bloqueo de acceso
app.get('/estado-acceso', async (_, res) => {
    try {
        res.json({ success: true, bloqueado: await estaAccesoBloqueado() });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al consultar estado' });
    }
});

// Bloquear / desbloquear acceso (solo superadmin)
app.post('/bloqueo-acceso', requiereRol('superadmin'), async (req, res) => {
    const { bloquear } = req.body;
    if (typeof bloquear !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Parámetro bloquear requerido (true/false)' });
    }
    try {
        await setAccesoBloqueado(bloquear);
        console.log(bloquear ? '🔒 Veedores: acceso bloqueado' : '🔓 Veedores: acceso desbloqueado');
        res.json({
            success: true,
            bloqueado: bloquear,
            message: bloquear
                ? 'Acceso bloqueado para administradores y veedores.'
                : 'Acceso habilitado para todos los usuarios.'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al actualizar el bloqueo' });
    }
});

// Listar usuarios
app.get('/usuarios', async (req, res) => {
    const esSuperadmin = req.auth?.user?.rol === 'superadmin';
    try {
        const sql = esSuperadmin
            ? 'SELECT id, cedula, usuario, rol, fecha_creacion FROM usuarios ORDER BY fecha_creacion DESC'
            : "SELECT id, cedula, usuario, rol, fecha_creacion FROM usuarios WHERE rol != 'superadmin' ORDER BY fecha_creacion DESC";
        const [rows] = await db.execute(sql);
        res.json({ success: true, usuarios: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Eliminar usuario (solo superadmin)
app.delete('/usuarios/:id', requiereRol('superadmin'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.execute('SELECT usuario, rol FROM usuarios WHERE id=?', [id]);
        if (rows.length === 0)
            return res.status(404).json({ success: false, message: 'No encontrado' });

        // Bloqueo de seguridad: No se puede eliminar a un superadmin
        if (rows[0].rol === 'superadmin') {
            return res.status(403).json({ success: false, message: 'No se puede eliminar la cuenta de superadministrador' });
        }

        await db.execute('DELETE FROM usuarios WHERE id=?', [id]);
        res.json({ success: true, message: `Usuario "${rows[0].usuario}" eliminado` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── DIGNIDADES ─────────────────────────────────────────────────────────
app.get('/dignidades-estado', async (_, res) => {
    try {
        res.json({ success: true, dignidades: await obtenerEstadoDignidades() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/dignidades-estado/:clave', requiereRol('superadmin'), async (req, res) => {
    const clave = String(req.params.clave || '').toUpperCase();
    const { habilitada } = req.body;
    if (!DIGNIDADES_CONFIG.includes(clave))
        return res.status(400).json({ success: false, message: 'Dignidad inválida' });
    if (typeof habilitada !== 'boolean')
        return res.status(400).json({ success: false, message: 'habilitada requerido (true/false)' });
    try {
        await setDignidadHabilitada(clave, habilitada);
        res.json({ success: true, message: `Dignidad ${habilitada ? 'habilitada' : 'deshabilitada'}: ${clave}` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── CATÁLOGOS ─────────────────────────────────────────────────────────

app.get('/parroquias', async (req, res) => {
    const { dignidad } = req.query;
    try {
        let sql = 'SELECT DISTINCT parroquia FROM juntas';
        const params = [];
        if (dignidad) { sql += ' WHERE dignidad=? OR dignidad IS NULL'; params.push(dignidad); }
        sql += ' ORDER BY parroquia ASC';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/zonas', async (req, res) => {
    const { parroquia, dignidad } = req.query;
    if (!parroquia) return res.status(400).json({ error: 'Parroquia requerida' });
    try {
        let sql = 'SELECT DISTINCT zona FROM juntas WHERE parroquia=?';
        const params = [parroquia];
        if (dignidad) { sql += ' AND (dignidad=? OR dignidad IS NULL)'; params.push(dignidad); }
        sql += ' ORDER BY zona ASC';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/juntas', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    if (!parroquia || !zona) return res.status(400).json({ error: 'Parroquia y zona requeridas' });
    try {
        let sql = 'SELECT id, numero_junta FROM juntas WHERE parroquia=? AND zona=?';
        const params = [parroquia, zona];
        if (dignidad) { sql += ' AND (dignidad=? OR dignidad IS NULL)'; params.push(dignidad); }
        sql += ' ORDER BY numero_junta ASC';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: JUNTAS CRUD ──────────────────────────────────────────────
app.get('/admin/juntas', requiereRol('superadmin'), async (req, res) => {
    const { dignidad, parroquia, zona } = req.query;
    try {
        let sql = 'SELECT id, parroquia, zona, numero_junta, dignidad FROM juntas WHERE 1=1';
        const params = [];
        if (dignidad) { sql += ' AND dignidad=?'; params.push(dignidad); }
        if (parroquia && parroquia !== 'todas') { sql += ' AND parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { sql += ' AND zona=?';      params.push(zona); }
        sql += ' ORDER BY parroquia, zona, numero_junta';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/juntas', requiereRol('superadmin'), async (req, res) => {
    const { parroquia, zona, numero_junta, dignidad } = req.body;
    if (!parroquia || !zona || !numero_junta)
        return res.status(400).json({ success: false, message: 'Parroquia, zona y número de junta requeridos' });
    const dig = dignidad || null;
    try {
        const [result] = await db.execute(
            'INSERT INTO juntas (parroquia, zona, numero_junta, dignidad) VALUES (?,?,?,?)',
            [parroquia, zona, numero_junta, dig]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ success: false, message: 'Esta junta ya existe para la dignidad seleccionada' });
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/admin/juntas/:id', requiereRol('superadmin'), async (req, res) => {
    const { parroquia, zona, numero_junta, dignidad } = req.body;
    const dig = dignidad || null;
    try {
        const [result] = await db.execute(
            'UPDATE juntas SET parroquia=?, zona=?, numero_junta=?, dignidad=? WHERE id=?',
            [parroquia, zona, numero_junta, dig, req.params.id]
        );
        if (result.affectedRows === 0)
            return res.status(404).json({ success: false, message: 'Junta no encontrada' });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ success: false, message: 'Ya existe otra junta con los mismos datos' });
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/admin/juntas/:id', requiereRol('superadmin'), async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM juntas WHERE id=?', [req.params.id]);
        if (result.affectedRows === 0)
            return res.status(404).json({ success: false, message: 'Junta no encontrada' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/candidatos', async (req, res) => {
    const { dignidad } = req.query;
    try {
        let sql = 'SELECT id, dignidad, nombre, partido, orden FROM candidatos';
        const params = [];
        if (dignidad) { sql += ' WHERE dignidad=?'; params.push(dignidad); }
        sql += ' ORDER BY orden ASC, nombre ASC';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/candidatos', requiereRol('superadmin'), async (req, res) => {
    const { dignidad, nombre, partido, orden } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'Nombre requerido' });
    const dig = dignidad || 'ALCALDE';
    if (!DIGNIDADES_CONFIG.includes(dig))
        return res.status(400).json({ success: false, message: 'Dignidad inválida' });
    try {
        const [result] = await db.execute(
            'INSERT INTO candidatos (dignidad, nombre, partido, orden) VALUES (?,?,?,?)',
            [dig, nombre, partido || '', orden || 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/candidatos/:id', requiereRol('superadmin'), async (req, res) => {
    try {
        await db.execute('DELETE FROM candidatos WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── FOTOS DE ACTAS ────────────────────────────────────────────────────

// Subir foto del acta
app.post('/subir-foto', upload.single('foto'), async (req, res) => {
    try {
        if (await estaAccesoBloqueado()) {
            if (req.file) {
                const f = path.join(uploadsDir, req.file.filename);
                if (fs.existsSync(f)) fs.unlinkSync(f);
            }
            return res.status(403).json({
                success: false,
                codigo: 'ACCESO_BLOQUEADO',
                message: 'El sistema está bloqueado. No se pueden subir actas.'
            });
        }

        const { junta_id, id_veedor } = req.body;

        if (!req.file)
            return res.status(400).json({ success: false, message: 'No se recibió ninguna imagen' });
        if (!junta_id)
            return res.status(400).json({ success: false, message: 'junta_id requerido' });

        const filename = req.file.filename;

        // Si ya hay foto previa para esta junta, borrar el archivo anterior
        const [prev] = await db.execute(
            'SELECT foto FROM fotos_actas WHERE junta_id=?', [junta_id]
        );
        if (prev.length > 0 && prev[0].foto) {
            const oldFile = path.join(uploadsDir, prev[0].foto);
            if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
        }

        // Guardar en BD (INSERT o UPDATE)
        await db.execute(
            `INSERT INTO fotos_actas (junta_id, foto, id_veedor)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE foto=VALUES(foto), id_veedor=VALUES(id_veedor), fecha_subida=NOW()`,
            [junta_id, filename, id_veedor || null]
        );

        console.log(`📷 Foto guardada para junta ${junta_id}: ${filename}`);
        res.json({ success: true, filename, url: `/veedores_sucua/uploads/${filename}` });

    } catch (err) {
        console.error('❌ Subir foto:', err.message);
        // Limpiar archivo subido si hubo error de BD
        if (req.file) {
            const f = path.join(uploadsDir, req.file.filename);
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        res.status(500).json({ success: false, message: 'Error al guardar la foto' });
    }
});

// Obtener foto de una junta
app.get('/foto-acta/:junta_id', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT f.foto, f.fecha_subida, u.usuario AS veedor
             FROM fotos_actas f
             LEFT JOIN usuarios u ON f.id_veedor = u.id
             WHERE f.junta_id=?`,
            [req.params.junta_id]
        );
        if (!rows.length) return res.json({ tiene_foto: false });
        res.json({ tiene_foto: true, ...rows[0], url: `/veedores_sucua/uploads/${rows[0].foto}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Listar todas las fotos (para admin)
app.get('/todas-fotos', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    try {
        let sql = `SELECT f.junta_id, f.foto, f.fecha_subida,
                          j.parroquia, j.zona, j.numero_junta,
                          u.usuario AS veedor
                   FROM fotos_actas f
                   JOIN juntas j ON f.junta_id = j.id
                   LEFT JOIN usuarios u ON f.id_veedor = u.id
                   WHERE 1=1`;
        const params = [];
        if (dignidad) { sql += ' AND (j.dignidad=? OR j.dignidad IS NULL)'; params.push(dignidad); }
        if (parroquia && parroquia !== 'todas') { sql += ' AND j.parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { sql += ' AND j.zona=?';      params.push(zona); }
        sql += ' ORDER BY f.fecha_subida DESC';
        const [rows] = await db.execute(sql, params);
        res.json(rows.map(r => ({ ...r, url: `/veedores_sucua/uploads/${r.foto}` })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar foto de una junta (admin)
app.delete('/foto-acta/:junta_id', requiereRol('superadmin', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT foto FROM fotos_actas WHERE junta_id=?', [req.params.junta_id]
        );
        if (rows.length && rows[0].foto) {
            const f = path.join(uploadsDir, rows[0].foto);
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        await db.execute('DELETE FROM fotos_actas WHERE junta_id=?', [req.params.junta_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── RESULTADOS ────────────────────────────────────────────────────────

app.get('/junta-registrada', async (req, res) => {
    const { junta_id, dignidad } = req.query;
    if (!junta_id) return res.status(400).json({ error: 'junta_id requerido' });
    const dig = dignidad || 'ALCALDE';
    try {
        const [rows] = await db.execute(
            `SELECT r.id, u.usuario AS veedor, r.fecha_registro
             FROM resultados r
             JOIN usuarios u ON r.id_veedor = u.id
             WHERE r.junta_id = ? AND r.dignidad = ? LIMIT 1`,
            [junta_id, dig]
        );
        const [foto] = await db.execute(
            'SELECT foto FROM fotos_actas WHERE junta_id=?', [junta_id]
        );
        res.json({
            registrada: rows.length > 0,
            tiene_foto: foto.length > 0,
            info: rows[0] || null
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/registrar-resultados', async (req, res) => {
    const { junta_id, id_veedor, votos, sobreescribir, dignidad } = req.body;
    const dig = dignidad || 'ALCALDE';

    if (await estaAccesoBloqueado()) {
        return res.status(403).json({
            success: false,
            codigo: 'ACCESO_BLOQUEADO',
            message: 'El sistema está bloqueado. No se pueden registrar resultados.'
        });
    }

    if (!junta_id || !id_veedor || !Array.isArray(votos) || votos.length === 0)
        return res.status(400).json({ success: false, message: 'Datos incompletos' });

    try {
        const [existe] = await db.execute(
            'SELECT id FROM resultados WHERE junta_id=? AND dignidad=? LIMIT 1', [junta_id, dig]
        );
        if (existe.length > 0 && !sobreescribir)
            return res.status(409).json({
                success: false,
                message: 'Esta junta ya tiene resultados registrados para esta dignidad',
                yaRegistrada: true
            });

        if (sobreescribir) {
            await db.execute('DELETE FROM resultados WHERE junta_id=? AND dignidad=?', [junta_id, dig]);
        }

        for (const item of votos) {
            await db.execute(
                `INSERT INTO resultados (junta_id, dignidad, candidato, votos, id_veedor)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE votos=VALUES(votos), id_veedor=VALUES(id_veedor)`,
                [junta_id, dig, item.candidato, parseInt(item.votos) || 0, id_veedor]
            );
        }

        const [juntaInfo] = await db.execute(
            'SELECT parroquia, zona, numero_junta FROM juntas WHERE id=?', [junta_id]
        );
        console.log(`✅ Resultados registrados: junta ${junta_id} dignidad ${dig} (${juntaInfo[0]?.numero_junta})`);
        res.json({ success: true, message: 'Resultados registrados correctamente' });

    } catch (err) {
        console.error('❌ Registrar resultados:', err.message);
        res.status(500).json({ success: false, message: 'Error al guardar' });
    }
});

// Para eliminar la junta mal ingresada (solo superadmin)
app.delete('/resultados/:junta_id', requiereRol('superadmin', 'admin'), async (req, res) => {
    const { junta_id } = req.params;
    try {
        // Eliminar votos
        const [result] = await db.execute(
            'DELETE FROM resultados WHERE junta_id = ?', [junta_id]
        );
        if (result.affectedRows === 0)
            return res.status(404).json({ success: false, message: 'No se encontraron resultados para esta junta' });

        // Eliminar foto si existe
        const [fotos] = await db.execute(
            'SELECT foto FROM fotos_actas WHERE junta_id = ?', [junta_id]
        );
        if (fotos.length > 0 && fotos[0].foto) {
            const archivoFoto = path.join(uploadsDir, fotos[0].foto);
            if (fs.existsSync(archivoFoto)) fs.unlinkSync(archivoFoto);
            await db.execute('DELETE FROM fotos_actas WHERE junta_id = ?', [junta_id]);
        }

        res.json({ success: true, message: 'Acta y foto eliminadas correctamente.' });
    } catch (err) {
        console.error('❌ Eliminar resultados:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ── ESTADÍSTICAS ADMIN ────────────────────────────────────────────────

app.get('/estadisticas', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    const dig = dignidad || 'ALCALDE';
    try {
        let where = "WHERE r.candidato NOT IN ('NULO','BLANCO') AND r.dignidad=?";
        const params = [dig];
        if (parroquia && parroquia !== 'todas') { where += ' AND j.parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { where += ' AND j.zona=?';      params.push(zona); }
        const [rows] = await db.execute(
            `SELECT r.candidato, SUM(r.votos) as total
             FROM resultados r JOIN juntas j ON r.junta_id = j.id
             ${where} GROUP BY r.candidato ORDER BY total DESC`, params
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/estadisticas-especiales', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    const dig = dignidad || 'ALCALDE';
    try {
        let where = "WHERE r.candidato IN ('NULO','BLANCO') AND r.dignidad=?";
        const params = [dig];
        if (parroquia && parroquia !== 'todas') { where += ' AND j.parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { where += ' AND j.zona=?';      params.push(zona); }
        const [rows] = await db.execute(
            `SELECT r.candidato, SUM(r.votos) as total
             FROM resultados r JOIN juntas j ON r.junta_id = j.id
             ${where} GROUP BY r.candidato`, params
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/estadisticas-resumen', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    const dig = dignidad || 'ALCALDE';
    try {
        let where = 'WHERE r.dignidad=?';
        const params = [dig];
        if (parroquia && parroquia !== 'todas') { where += ' AND j.parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { where += ' AND j.zona=?';      params.push(zona); }
        const [[resumen]] = await db.execute(
            `SELECT SUM(r.votos) as total_votos, COUNT(DISTINCT r.junta_id) as juntas_con_acta
             FROM resultados r JOIN juntas j ON r.junta_id = j.id ${where}`, params
        );
        const pJuntas = [dig];
        let qJuntas = 'SELECT COUNT(*) as total FROM juntas WHERE (dignidad=? OR dignidad IS NULL)';
        if (parroquia && parroquia !== 'todas') { qJuntas += ' AND parroquia=?'; pJuntas.push(parroquia); }
        if (zona && zona !== 'todas')           { qJuntas += ' AND zona=?';      pJuntas.push(zona); }
        const [[totalJuntas]] = await db.execute(qJuntas, pJuntas);
        res.json({
            total_votos: resumen.total_votos || 0,
            juntas_con_acta: resumen.juntas_con_acta || 0,
            total_juntas: totalJuntas.total || 0
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/estadisticas-junta', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    const dig = dignidad || 'ALCALDE';
    try {
        let where = 'WHERE r.dignidad=?';
        const params = [dig];
        if (parroquia && parroquia !== 'todas') { where += ' AND j.parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { where += ' AND j.zona=?';      params.push(zona); }
        const [rows] = await db.execute(
            `SELECT j.id AS junta_id, j.parroquia, j.zona, j.numero_junta,
                    r.candidato, r.votos, u.usuario AS veedor, r.fecha_registro,
                    f.foto AS foto_acta
             FROM resultados r
             JOIN juntas j ON r.junta_id = j.id
             JOIN usuarios u ON r.id_veedor = u.id
             LEFT JOIN fotos_actas f ON f.junta_id = j.id
             ${where}
             ORDER BY j.parroquia, j.zona, j.numero_junta, r.votos DESC`, params
        );
        res.json(rows.map(r => ({
            ...r,
            foto_url: r.foto_acta ? `/veedores_sucua/uploads/${r.foto_acta}` : null
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/juntas-pendientes', async (req, res) => {
    const { parroquia, zona, dignidad } = req.query;
    const dig = dignidad || 'ALCALDE';
    try {
        let where = 'WHERE (j.dignidad=? OR j.dignidad IS NULL) AND j.id NOT IN (SELECT DISTINCT junta_id FROM resultados WHERE dignidad=?)';
        const params = [dig, dig];
        if (parroquia && parroquia !== 'todas') { where += ' AND j.parroquia=?'; params.push(parroquia); }
        if (zona && zona !== 'todas')           { where += ' AND j.zona=?';      params.push(zona); }
        const [rows] = await db.execute(
            `SELECT j.parroquia, j.zona, j.numero_junta
             FROM juntas j ${where} ORDER BY j.parroquia, j.zona, j.numero_junta`, params
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/parroquias-disponibles', async (_, res) => {
    try {
        const [rows] = await db.execute('SELECT DISTINCT parroquia FROM juntas ORDER BY parroquia ASC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/zonas-disponibles', async (req, res) => {
    const { parroquia } = req.query;
    try {
        let q = 'SELECT DISTINCT zona FROM juntas';
        const p = [];
        if (parroquia && parroquia !== 'todas') { q += ' WHERE parroquia=?'; p.push(parroquia); }
        q += ' ORDER BY zona ASC';
        const [rows] = await db.execute(q, p);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EXCEL ─────────────────────────────────────────────────────────────
app.get('/descargar-excel', async (_, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT j.parroquia, j.zona, j.numero_junta,
                   r.candidato, r.votos, u.usuario AS veedor, u.cedula,
                   IF(f.foto IS NOT NULL,'Sí','No') AS tiene_foto,
                   DATE_FORMAT(r.fecha_registro,'%d/%m/%Y') AS fecha,
                   DATE_FORMAT(r.fecha_registro,'%H:%i:%s') AS hora
            FROM resultados r
            JOIN juntas j ON r.junta_id = j.id
            JOIN usuarios u ON r.id_veedor = u.id
            LEFT JOIN fotos_actas f ON f.junta_id = j.id
            ORDER BY j.parroquia, j.zona, j.numero_junta, r.votos DESC
        `);

        if (!rows.length)
            return res.status(404).json({ error: 'Sin datos para exportar' });

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Resultados Sucúa 2026');

        ws.columns = [
            { header: 'Parroquia',    key: 'parroquia',    width: 18 },
            { header: 'Zona',         key: 'zona',         width: 18 },
            { header: 'Junta',        key: 'numero_junta', width: 14 },
            { header: 'Candidato',    key: 'candidato',    width: 25 },
            { header: 'Votos',        key: 'votos',        width: 10 },
            { header: 'Veedor',       key: 'veedor',       width: 18 },
            { header: 'Cédula',       key: 'cedula',       width: 14 },
            { header: 'Foto Acta',    key: 'tiene_foto',   width: 12 },
            { header: 'Fecha',        key: 'fecha',        width: 14 },
            { header: 'Hora',         key: 'hora',         width: 12 }
        ];

        const hr = ws.getRow(1);
        hr.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        hr.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
        hr.alignment = { vertical: 'middle', horizontal: 'center' };
        hr.height    = 22;

        ws.addRows(rows);
        ws.eachRow((row, n) => {
            if (n > 1) {
                row.fill = { type:'pattern', pattern:'solid',
                    fgColor:{ argb: n%2===0 ? 'FFECFDF5' : 'FFFFFFFF' } };
            }
            row.alignment = { vertical: 'middle' };
        });

        const fecha = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Resultados_Sucua_${fecha}.xlsx`);
        await wb.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('❌ Excel:', err.message);
        res.status(500).json({ error: 'Error generando Excel' });
    }
});

// ── DESCARGAR TODAS LAS FOTOS DE ACTAS (ZIP) ──────────────────────────
function sanitizarNombreArchivo(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 60) || 'sin_nombre';
}

app.get('/descargar-fotos-actas', async (req, res) => {
    try {
        const { parroquia, zona } = req.query;
        let sql = `
            SELECT f.foto, j.parroquia, j.zona, j.numero_junta
            FROM fotos_actas f
            JOIN juntas j ON f.junta_id = j.id
            WHERE f.foto IS NOT NULL AND TRIM(f.foto) != ''
        `;
        const params = [];
        if (parroquia && parroquia !== 'todas') {
            sql += ' AND j.parroquia = ?';
            params.push(parroquia);
        }
        if (zona && zona !== 'todas') {
            sql += ' AND j.zona = ?';
            params.push(zona);
        }
        sql += ' ORDER BY j.parroquia, j.zona, j.numero_junta';

        const [rows] = await db.execute(sql, params);
        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'No hay fotos de actas registradas para descargar.'
            });
        }

        const archivos = [];
        for (const row of rows) {
            const filePath = path.join(uploadsDir, row.foto);
            if (fs.existsSync(filePath)) archivos.push({ filePath, row });
        }

        if (!archivos.length) {
            return res.status(404).json({
                success: false,
                message: 'Hay registros en la base de datos, pero los archivos no están en el servidor.'
            });
        }

        const fecha   = new Date().toISOString().split('T')[0];
        const zipName = `Fotos_Actas_Veedores_${fecha}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (err) => {
            console.error('❌ ZIP fotos actas:', err.message);
            if (!res.headersSent) res.status(500).end();
        });
        archive.pipe(res);

        const usados = new Set();
        for (const { filePath, row } of archivos) {
            const ext  = path.extname(row.foto) || '.jpg';
            const base = `${sanitizarNombreArchivo(row.parroquia)}_${sanitizarNombreArchivo(row.zona)}_Junta${sanitizarNombreArchivo(row.numero_junta)}`;
            let nombreEnZip = `${base}${ext}`;
            let n = 1;
            while (usados.has(nombreEnZip)) {
                nombreEnZip = `${base}_${n}${ext}`;
                n++;
            }
            usados.add(nombreEnZip);
            archive.file(filePath, { name: nombreEnZip });
        }

        await archive.finalize();
        console.log(`📦 ZIP fotos actas: ${archivos.length} archivo(s)`);
    } catch (err) {
        console.error('❌ descargar-fotos-actas:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Error al generar el archivo ZIP' });
        }
    }
});

// 404 y error handler
app.use((_, res) => res.status(404).json({ message: 'No encontrado' }));
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: err.message || 'Error interno' });
});

const PORT = process.env.PORT || 3011;
app.listen(PORT, () => console.log(`🚀 Servidor veedores en puerto ${PORT}`));
