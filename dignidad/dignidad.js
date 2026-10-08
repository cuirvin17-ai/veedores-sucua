const API = window.location.origin;

function getHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return { 'ngrok-skip-browser-warning': 'true', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const nombre = localStorage.getItem('nombreUsuarioActivo') || '';
const elNombre = document.getElementById('nombreVeedor');
if (elNombre) elNombre.textContent = nombre.charAt(0).toUpperCase() + nombre.slice(1);

let dignidadSeleccionada = '';
let estadoDignidades = null;

const DIGNIDADES = [
    { clave: 'ALCALDE',              icono: 'fa-user-tie',   color: '#10b981', titulo: 'Alcalde o Alcaldesa',     desc: 'Votación para la alcaldía del cantón' },
    { clave: 'CONCEJALES_URBANOS',   icono: 'fa-city',      color: '#3b82f6', titulo: 'Concejales Urbanos',      desc: 'Votación para concejales del área urbana' },
    { clave: 'CONCEJALES_RURALES',   icono: 'fa-tree-city', color: '#f59e0b', titulo: 'Concejales Rurales',      desc: 'Votación para concejales del área rural' },
    { clave: 'JUNTAS_PARROQUIALES',  icono: 'fa-people-group', color: '#8b5cf6', titulo: 'Juntas Parroquiales',  desc: 'Votación para juntas parroquiales' },
];

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('../sw.js').catch(() => {});
}

async function checkConexion() {
    const msg = document.getElementById('offline-msg');
    if (!msg) return;
    try {
        await fetch(`${API}/dignidades-estado`, { method: 'HEAD', headers: { 'ngrok-skip-browser-warning': 'true' } });
        msg.style.display = 'none';
    } catch {
        msg.style.display = 'block';
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const idUsuario = localStorage.getItem('idUsuario');
    if (!idUsuario) {
        window.location.href = '../acceso/acceso.html';
        return;
    }
    checkConexion();
    await cargarEstadoDignidades();
    renderDignidades();
});

window.addEventListener('online', () => setTimeout(checkConexion, 500));
window.addEventListener('offline', () => setTimeout(checkConexion, 500));

async function cargarEstadoDignidades() {
    try {
        const res = await fetch(`${API}/dignidades-estado`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success && Array.isArray(data.dignidades)) {
            estadoDignidades = data.dignidades;
        }
    } catch (e) { /* sin servidor: se muestran todas */ }
}

function esDignidadHabilitada(clave) {
    const estado = (estadoDignidades || []).find(d => d.clave === clave);
    return estado ? Number(estado.habilitada) === 1 : true;
}

function renderDignidades() {
    const lista = document.getElementById('dignidadLista');
    const visibles = DIGNIDADES.filter(d => esDignidadHabilitada(d.clave));

    if (visibles.length === 0) {
        lista.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#64748b;font-weight:600;padding:24px;">No hay dignidades habilitadas en este momento. Contacte al administrador.</p>';
        const btn = document.getElementById('btnContinuar');
        if (btn) btn.disabled = true;
        return;
    }

    lista.innerHTML = visibles.map(d => `
        <button class="dignidad-btn" id="dignidad_${d.clave}" onclick="seleccionar('${d.clave}')">
            <span class="dignidad-btn-icon" style="background:linear-gradient(135deg, ${d.color}, ${d.color}dd);">
                <i class="fas ${d.icono}"></i>
            </span>
            <span class="dignidad-btn-text">
                <div class="dignidad-btn-titulo">${d.titulo}</div>
                <div class="dignidad-btn-desc">${d.desc}</div>
            </span>
            <span class="dignidad-btn-check"><i class="fas fa-check" style="font-size:0.7rem;"></i></span>
        </button>
    `).join('');
}

function seleccionar(clave) {
    const btn = document.getElementById(`dignidad_${clave}`);
    if (!btn || !esDignidadHabilitada(clave)) return;

    document.querySelectorAll('.dignidad-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    dignidadSeleccionada = clave;
    document.getElementById('btnContinuar').disabled = false;
}

function continuar() {
    if (!dignidadSeleccionada) return;
    localStorage.setItem('dignidad', dignidadSeleccionada);
    ['juntaId','juntaParroquia','juntaZona','juntaNombre','juntaYaRegistrada'].forEach(k => localStorage.removeItem(k));
    window.location.href = '../seleccion/seleccion.html';
}

function volver() {
    window.location.href = '../acceso/acceso.html';
}

function cerrarSesion() {
    ['idUsuario','nombreUsuarioActivo','rolUsuario','sesionActiva','authToken',
     'juntaId','juntaParroquia','juntaZona','juntaNombre','juntaYaRegistrada','dignidad']
        .forEach(k => localStorage.removeItem(k));
    window.location.href = '../acceso/acceso.html';
}
