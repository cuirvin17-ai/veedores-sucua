/**
 * server.js — Sistema de Veedores Electorales Sucúa 2026
 * Compatible con MySQL (local) y PostgreSQL (Render)
 */

const express   = require('express');
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
    limits: { fileSize: 15 * 1024 * 1024 },
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
app.use('/uploads', express.static(uploadsDir));

// ── BASE DE DATOS ─────────────────────────────────────────────────────
// Soporte para PostgreSQL (Render) y MySQL (local)
let db;
let pool;

const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL) {
    // PostgreSQL para Render
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    db = {
        execute: async (query, params = []) => {
            let pgQuery = query;
            let paramIndex = 1;
            pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
            return pool.query(pgQuery, params);
        },
        query: async (query, params = []) => {
            let pgQuery = query;
            let paramIndex = 1;
            pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
            return pool.query(pgQuery, params);
        }
    };
    console.log('✅ Conectado a PostgreSQL (Render)');
} else {
    // MySQL para local
    const mysql = require('mysql2');
    pool = mysql.createPool({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'Betoben1',
        database: process.env.DB_NAME     || 'veedores_sucua_bd',
        charset:  'utf8mb4',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    db = pool.promise();
    console.log('✅ Conectado a MySQL (local)');
}

// ── NO-CACHE PARA API ─────────────────────────────────────────────────
const apiNoStore = ['/login', '/registrar', '/usuarios', '/estado-acceso', '/bloqueo-acceso', '/dignidades-estado'];
app.use(apiNoStore, noStore);

// ── AUTENTICACIÓN ─────────────────────────────────────────────────────
const sesiones = new Map();

function autenticarSesion(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !sesiones.has(token)) {
        return res.status(401).json({ error: 'Sesión no válida' });
    }
    req.usuario = sesiones.get(token);
    next();
}

function requiereRol(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.usuario?.rol)) {
            return res.status(403).json({ error: 'Acceso no autorizado' });
        }
        next();
    };
}

// ── RUTAS PROTEGIDAS ──────────────────────────────────────────────────
const rutasProtegidas = [
    '/usuarios', '/candidatos', '/juntas',
    '/admin', '/registrar', '/registrar-resultados',
    '/estadisticas', '/estadisticas-especiales', '/descargar-excel',
    '/descargar-fotos-actas', '/parroquias', '/zonas'
];

app.use((req, res, next) => {
    if (rutasProtegidas.some(ruta => req.path.startsWith(ruta))) {
        return autenticarSesion(req, res, next);
    }
    next();
});

// ── LOGIN ─────────────────────────────────────────────────────────────
app.post('/login', loginLimiter, async (req, res) => {
    try {
        const { usuario, password } = req.body;
        const [rows] = await db.execute(
            "SELECT * FROM usuarios WHERE usuario = ? AND password = ?",
            [usuario, password]
        );
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        const user = rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        sesiones.set(token, { id: user.id, usuario: user.usuario, rol: user.rol });
        res.json({ token, usuario: user.usuario, rol: user.rol });
    } catch (err) {
        console.error('Error login:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ── HEALTH ────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 ───────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ message: 'No encontrado' }));

// ── ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: err.message || 'Error interno' });
});

// ── INICIAR ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3011;
app.listen(PORT, () => console.log(`🚀 Servidor veedores en puerto ${PORT}`));
