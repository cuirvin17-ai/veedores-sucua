const API = window.location.origin;

function getHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return { 'ngrok-skip-browser-warning': 'true', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const nombre   = localStorage.getItem('nombreUsuarioActivo') || '';
const elNombre = document.getElementById('nombreVeedor');
if (elNombre) elNombre.textContent = `Veedor: ${nombre.charAt(0).toUpperCase() + nombre.slice(1)}`;

const dignidad = localStorage.getItem('dignidad');
if (!dignidad) {
    window.location.href = '../dignidad/dignidad.html';
}

const DIGNIDAD_NOMBRES = {
    ALCALDE: 'Alcalde o Alcaldesa',
    CONCEJALES_URBANOS: 'Concejales Urbanos',
    CONCEJALES_RURALES: 'Concejales Rurales',
    JUNTAS_PARROQUIALES: 'Juntas Parroquiales',
};

const badge = document.getElementById('dignidadBadgeText');
if (badge) badge.textContent = DIGNIDAD_NOMBRES[dignidad] || dignidad;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('../sw.js').catch(() => {});
}

async function checkConexion() {
    const msg = document.getElementById('offline-msg');
    if (!msg) return;
    try {
        await fetch(`${API}/estado-acceso`, { method: 'HEAD', headers: { 'ngrok-skip-browser-warning': 'true' } });
        msg.style.display = 'none';
        document.body.style.paddingTop = '0';
    } catch {
        msg.style.display = 'block';
        document.body.style.paddingTop = '32px';
    }
}

function actualizarBadgePendientes() {
    const votos = JSON.parse(localStorage.getItem('cola_votos') || '[]');
    const fotos = JSON.parse(localStorage.getItem('cola_fotos') || '[]');
    const badge = document.getElementById('badge-pendientes');
    const texto = document.getElementById('txt-pendientes');
    if (!badge || !texto) return;

    const totalActas = votos.length;
    const totalFotos = fotos.length;

    if (totalActas === 0 && totalFotos === 0) {
        badge.style.display = 'none';
        return;
    }

    const partes = [];
    if (totalActas > 0) partes.push(`${totalActas} acta(s) pendiente(s) de enviar`);
    if (totalFotos > 0) partes.push(`${totalFotos} foto(s) pendiente(s)`);
    texto.textContent = partes.join(' · ');
    badge.style.display = 'block';
}

window.addEventListener('online', () => setTimeout(checkConexion, 500));
window.addEventListener('offline', () => setTimeout(checkConexion, 500));

async function verificarBloqueoSesion() {
    if (localStorage.getItem('rolUsuario') === 'superadmin') return true;

    if (localStorage.getItem('sistemaAccesoBloqueado') === '1') {
        alert(' El sistema está bloqueado. No puede continuar.');
        window.location.href = '../acceso/acceso.html';
        return false;
    }

    try {
        const res  = await fetch(`${API}/estado-acceso`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success && data.bloqueado) {
            localStorage.setItem('sistemaAccesoBloqueado', '1');
            alert(' El sistema fue bloqueado por el superadministrador. Debe cerrar sesión.');
            window.location.href = '../acceso/acceso.html';
            return false;
        }
        localStorage.removeItem('sistemaAccesoBloqueado');
    } catch (err) {
        /* sin servidor */
    }
    return true;
}

window.addEventListener('DOMContentLoaded', async () => {
    const idUsuario = localStorage.getItem('idUsuario');
    if (!idUsuario) {
        window.location.href = '../acceso/acceso.html';
        return;
    }

    const puedeContinuar = await verificarBloqueoSesion();
    if (!puedeContinuar) return;

    checkConexion();
    actualizarBadgePendientes();
    await cargarParroquias();
    if (typeof intentarSincronizar === 'function') intentarSincronizar();
});

function guardarCache(clave, datos) {
    localStorage.setItem('cache_' + clave, JSON.stringify(datos));
}
function leerCache(clave) {
    const raw = localStorage.getItem('cache_' + clave);
    return raw ? JSON.parse(raw) : null;
}

async function cargarParroquias() {
    let datos = null;
    const cacheKey = 'parroquias_' + dignidad;

    if (navigator.onLine) {
        try {
            const res = await fetch(`${API}/parroquias?dignidad=${encodeURIComponent(dignidad)}`, { headers: getHeaders() });
            datos = await res.json();
            guardarCache(cacheKey, datos);
        } catch (e) {
            console.warn('Sin red, usando caché de parroquias');
            datos = leerCache(cacheKey);
        }
    } else {
        datos = leerCache(cacheKey);
    }

    const sel = document.getElementById('selectParroquia');
    sel.innerHTML = '<option value="">— Seleccione parroquia —</option>';

    if (!datos || !datos.length) {
        const online = navigator.onLine && datos !== null;
        sel.innerHTML += online
            ? '<option disabled>Sin juntas asignadas. Contacte al administrador</option>'
            : '<option disabled>Sin datos disponibles offline</option>';
        return;
    }

    datos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = p.parroquia;
        sel.appendChild(opt);
    });
}

async function onParroquiaChange() {
    const parroquia = document.getElementById('selectParroquia').value;
    resetDesde('zona');
    if (!parroquia) return;

    let datos = null;
    const cacheKey = 'zonas_' + parroquia;

    if (navigator.onLine) {
        try {
            const res = await fetch(`${API}/zonas?parroquia=${encodeURIComponent(parroquia)}&dignidad=${encodeURIComponent(dignidad)}`, { headers: getHeaders() });
            datos = await res.json();
            guardarCache(cacheKey, datos);
        } catch (e) {
            datos = leerCache(cacheKey);
        }
    } else {
        datos = leerCache(cacheKey);
    }

    const sel = document.getElementById('selectZona');
    sel.innerHTML = '<option value="">— Seleccione zona —</option>';

    if (!datos || !datos.length) {
        sel.innerHTML += '<option disabled>Sin zonas disponibles offline</option>';
    } else {
        datos.forEach(z => {
            const opt = document.createElement('option');
            opt.value = opt.textContent = z.zona;
            sel.appendChild(opt);
        });
    }

    document.getElementById('stepZona').style.display = 'block';
}

async function onZonaChange() {
    const parroquia = document.getElementById('selectParroquia').value;
    const zona      = document.getElementById('selectZona').value;
    resetDesde('junta');
    if (!zona) return;

    let datos = null;
    const cacheKey = 'juntas_' + parroquia + '_' + zona;

    if (navigator.onLine) {
        try {
            const res = await fetch(
                `${API}/juntas?parroquia=${encodeURIComponent(parroquia)}&zona=${encodeURIComponent(zona)}&dignidad=${encodeURIComponent(dignidad)}`,
                { headers: getHeaders() }
            );
            datos = await res.json();
            guardarCache(cacheKey, datos);
        } catch (e) {
            datos = leerCache(cacheKey);
        }
    } else {
        datos = leerCache(cacheKey);
    }

    const sel = document.getElementById('selectJunta');
    sel.innerHTML = '<option value="">— Seleccione junta —</option>';

    if (!datos || !datos.length) {
        sel.innerHTML += '<option disabled>Sin juntas disponibles offline</option>';
    } else {
        datos.forEach(j => {
            const opt = document.createElement('option');
            opt.value = j.id;
            opt.textContent = j.numero_junta;
            sel.appendChild(opt);
        });
    }

    document.getElementById('stepJunta').style.display = 'block';
    sel.addEventListener('change', onJuntaChange);
}

async function onJuntaChange() {
    const juntaId   = document.getElementById('selectJunta').value;
    const parroquia = document.getElementById('selectParroquia').value;
    const zona      = document.getElementById('selectZona').value;
    const juntaText = document.getElementById('selectJunta').selectedOptions[0]?.text || '';

    document.getElementById('avisoRegistrada').style.display  = 'none';
    document.getElementById('resumenSeleccion').style.display = 'none';
    document.getElementById('btnContinuar').disabled           = true;

    if (!juntaId) return;

    if (!navigator.onLine) {
        const resumen = document.getElementById('resumenSeleccion');
        resumen.style.display = 'flex';
        document.getElementById('textoResumen').textContent = `${parroquia} · ${zona} · ${juntaText}`;

        localStorage.setItem('juntaId',           juntaId);
        localStorage.setItem('juntaParroquia',    parroquia);
        localStorage.setItem('juntaZona',         zona);
        localStorage.setItem('juntaNombre',       juntaText);
        localStorage.setItem('juntaYaRegistrada', 'false');
        localStorage.setItem('dignidad',          dignidad);

        document.getElementById('btnContinuar').disabled = false;
        return;
    }

    try {
        const res  = await fetch(`${API}/junta-registrada?junta_id=${juntaId}&dignidad=${encodeURIComponent(dignidad)}`, { headers: getHeaders() });
        const data = await res.json();

        if (data.registrada) {
            const aviso = document.getElementById('avisoRegistrada');
            aviso.style.display = 'flex';
            document.getElementById('textoAvisoRegistrada').textContent =
                `Esta junta ya tiene resultados ingresados por "${data.info.veedor}". Contáctese con el administrador.`;
        }

        const resumen = document.getElementById('resumenSeleccion');
        resumen.style.display = 'flex';
        document.getElementById('textoResumen').textContent = `${parroquia} · ${zona} · ${juntaText}`;

        localStorage.setItem('juntaId',           juntaId);
        localStorage.setItem('juntaParroquia',    parroquia);
        localStorage.setItem('juntaZona',         zona);
        localStorage.setItem('juntaNombre',       juntaText);
        localStorage.setItem('juntaYaRegistrada', data.registrada ? 'true' : 'false');
        localStorage.setItem('dignidad',          dignidad);

        document.getElementById('btnContinuar').disabled = false;

    } catch (e) {
        console.error('Error verificando junta:', e);
    }
}

function continuar() {
    window.location.href = '../votos/votos.html';
}

function resetDesde(nivel) {
    if (nivel === 'zona') {
        document.getElementById('stepZona').style.display  = 'none';
        document.getElementById('selectZona').value        = '';
        document.getElementById('stepJunta').style.display = 'none';
        document.getElementById('selectJunta').value       = '';
    }
    if (nivel === 'junta') {
        document.getElementById('stepJunta').style.display = 'none';
        document.getElementById('selectJunta').value       = '';
    }
    document.getElementById('avisoRegistrada').style.display  = 'none';
    document.getElementById('resumenSeleccion').style.display = 'none';
    document.getElementById('btnContinuar').disabled           = true;
    localStorage.removeItem('juntaId');
}

function cambiarDignidad() {
    ['juntaId','juntaParroquia','juntaZona','juntaNombre','juntaYaRegistrada','dignidad']
        .forEach(k => localStorage.removeItem(k));
    window.location.href = '../dignidad/dignidad.html';
}

function cerrarSesion() {
    ['idUsuario','nombreUsuarioActivo','rolUsuario','sesionActiva',
     'juntaId','juntaParroquia','juntaZona','juntaNombre','juntaYaRegistrada','dignidad']
        .forEach(k => localStorage.removeItem(k));
    window.location.href = '../acceso/acceso.html';
}
