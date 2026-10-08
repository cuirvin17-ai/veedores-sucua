const API = window.location.origin;

function getHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return { 'ngrok-skip-browser-warning': 'true', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const juntaId        = localStorage.getItem('juntaId');
const juntaParroquia = localStorage.getItem('juntaParroquia');
const juntaZona      = localStorage.getItem('juntaZona');
const juntaNombre    = localStorage.getItem('juntaNombre');
const yaRegistrada   = localStorage.getItem('juntaYaRegistrada') === 'true';
const idVeedor       = localStorage.getItem('idUsuario');
const nombreVeedor   = localStorage.getItem('nombreUsuarioActivo') || '';
const dignidad       = localStorage.getItem('dignidad') || 'ALCALDE';

const DIGNIDAD_NOMBRES = {
    ALCALDE: 'Alcalde o Alcaldesa',
    CONCEJALES_URBANOS: 'Concejales Urbanos',
    CONCEJALES_RURALES: 'Concejales Rurales',
    JUNTAS_PARROQUIALES: 'Juntas Parroquiales',
};

document.getElementById('infoJunta').textContent =
    `${juntaParroquia} · ${juntaZona} · ${juntaNombre}`;

const badgeDig = document.getElementById('dignidadTag');
if (badgeDig) badgeDig.textContent = DIGNIDAD_NOMBRES[dignidad] || dignidad;

const tituloCandidatos = document.getElementById('candidatosTitulo');
if (tituloCandidatos) tituloCandidatos.textContent = `Candidatos a ${DIGNIDAD_NOMBRES[dignidad] || dignidad}`;

const elNombre = document.getElementById('nombreVeedor');
if (elNombre) elNombre.textContent = nombreVeedor.charAt(0).toUpperCase() + nombreVeedor.slice(1);

if (yaRegistrada) {
    document.getElementById('bannerYaRegistrada').style.display = 'flex';
    const btn = document.getElementById('btnGuardar');
    if (btn) {
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-lock"></i> Acta bloqueada — solo el admin puede desbloquearla';
        btn.style.background = '#94a3b8';
        btn.style.cursor     = 'not-allowed';
    }
}

let archivoFoto = null;

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

window.addEventListener('online',  () => setTimeout(checkConexion, 500));
window.addEventListener('offline', () => setTimeout(checkConexion, 500));

async function verificarBloqueoSesion() {
    if (localStorage.getItem('rolUsuario') === 'superadmin') return true;

    if (localStorage.getItem('sistemaAccesoBloqueado') === '1') {
        alert(' El sistema está bloqueado. No puede registrar actas.');
        window.location.href = '../acceso/acceso.html';
        return false;
    }

    

    try {
        const res  = await fetch(`${API}/estado-acceso`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success && data.bloqueado) {
            localStorage.setItem('sistemaAccesoBloqueado', '1');
            alert(' El sistema fue bloqueado. Debe cerrar sesión.');
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
    const puedeContinuar = await verificarBloqueoSesion();
    if (!puedeContinuar) return;
});

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

window.addEventListener('DOMContentLoaded', async () => {
    checkConexion();
    actualizarBadgePendientes();
    await cargarCandidatos();
    await verificarFotoExistente();
    if (navigator.onLine && typeof intentarSincronizar === 'function') {
        await intentarSincronizar();
        actualizarBadgePendientes();
    }
});

function guardarCache(clave, datos) {
    localStorage.setItem('cache_' + clave, JSON.stringify(datos));
}
function leerCache(clave) {
    const raw = localStorage.getItem('cache_' + clave);
    return raw ? JSON.parse(raw) : null;
}

async function cargarCandidatos() {
    let datos = null;
    const cacheKey = 'candidatos_' + dignidad;

    if (navigator.onLine) {
        try {
            const res = await fetch(`${API}/candidatos?dignidad=${encodeURIComponent(dignidad)}`, { headers: getHeaders() });
            datos = await res.json();
            guardarCache(cacheKey, datos);
        } catch (e) {
            datos = leerCache(cacheKey);
        }
    } else {
        datos = leerCache(cacheKey);
    }

    const lista = document.getElementById('listaCandidatos');

    if (!datos || !datos.length) {
        lista.innerHTML = `<div class="cargando" style="color:#ef4444;">
            <i class="fas fa-exclamation-circle"></i> Sin candidatos disponibles offline.
        </div>`;
        return;
    }

    const colores = [
        { bg: '#dbeafe', color: '#1e40af' },
        { bg: '#fef3c7', color: '#92400e' },
        { bg: '#ede9fe', color: '#5b21b6' },
        { bg: '#fce7f3', color: '#9d174d' },
        { bg: '#e0f2fe', color: '#075985' },
        { bg: '#d1fae5', color: '#065f46' },
    ];

    lista.innerHTML = datos.map((c, i) => {
        const clr     = colores[i % colores.length];
        const safeKey = c.nombre.replace(/[^a-zA-Z0-9]/g, '_');
        return `
        <div class="voto-item">
            <div class="voto-info">
                <div class="voto-icono" style="background:${clr.bg};color:${clr.color};">${i + 1}</div>
                <div>
                    <div class="voto-nombre">${c.nombre}</div>
                    <div class="voto-partido">${c.partido || 'Sin partido'}</div>
                </div>
            </div>
            <div class="voto-input-wrap">
                <button onclick="ajustar('${safeKey}',-1)" class="btn-adj minus">
                    <i class="fas fa-minus"></i>
                </button>
                <input type="text"
                       id="input_${safeKey}"
                       data-candidato="${c.nombre}"
                       class="voto-input"
                       value="0"
                       inputmode="numeric" pattern="[0-9]*" maxlength="6"
                       oninput="actualizarTotal()">
                <button onclick="ajustar('${safeKey}',1)" class="btn-adj plus">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    ['NULO','BLANCO'].forEach(k => {
        document.getElementById(`input_${k}`)?.addEventListener('input', actualizarTotal);
    });
}

function ajustar(key, delta) {
    const inp = document.getElementById(`input_${key}`);
    if (!inp) return;
    inp.value = Math.max(0, (parseInt(inp.value) || 0) + delta);
    actualizarTotal();
}

function actualizarTotal() {
    let total = 0;
    document.querySelectorAll('.voto-input').forEach(inp => {
        const limpio = String(inp.value).replace(/[^0-9]/g, '');
        if (limpio !== inp.value) inp.value = limpio;
        const v = parseInt(limpio, 10);
        total += isNaN(v) ? 0 : v;
    });
    document.getElementById('totalVotos').textContent = total;
}

function triggerFileInput() {
    if (archivoFoto) return;
    document.getElementById('inputFoto').click();
}

function onFotoSeleccionada(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
        alert(' La imagen es demasiado grande. El límite es 15 MB.');
        event.target.value = '';
        return;
    }
    archivoFoto = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('fotoImg').src                   = e.target.result;
        document.getElementById('fotoPreview').style.display     = 'block';
        document.getElementById('fotoPlaceholder').style.display = 'none';
        document.getElementById('fotoUploadArea').style.cursor   = 'default';
        document.getElementById('fotoUploadArea').onclick        = null;
    };
    reader.readAsDataURL(file);
}

function quitarFoto(event) {
    event.stopPropagation();
    archivoFoto = null;
    document.getElementById('inputFoto').value                   = '';
    document.getElementById('fotoImg').src                       = '';
    document.getElementById('fotoPreview').style.display         = 'none';
    document.getElementById('fotoPlaceholder').style.display     = 'flex';
    document.getElementById('fotoUploadArea').style.cursor       = 'pointer';
    document.getElementById('fotoUploadArea').onclick            = triggerFileInput;
}

async function verificarFotoExistente() {
    if (!navigator.onLine) return;
    try {
        const res  = await fetch(`${API}/foto-acta/${juntaId}`, { headers: getHeaders() });
        const data = await res.json();
        if (data.tiene_foto)
            document.getElementById('infoFotoGuardada').style.display = 'flex';
    } catch (e) { /* silencioso */ }
}

async function guardarResultados() {
    const inputs = document.querySelectorAll('.voto-input');
    const votos  = [];
    inputs.forEach(inp => {
        const candidato = inp.dataset.candidato;
        if (candidato) votos.push({ candidato, votos: Math.max(0, parseInt(inp.value, 10) || 0) });
    });

    if (!votos.length) { mostrarError('No hay datos para guardar.'); return; }

    const btn = document.getElementById('btnGuardar');
    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';

    if (!navigator.onLine) {
        const cola = JSON.parse(localStorage.getItem('cola_votos') || '[]');

        const yaEnCola = cola.some(item => item.junta_id === juntaId && item.dignidad === dignidad);
        if (!yaEnCola) {
            cola.push({
                junta_id:  juntaId,
                id_veedor: idVeedor,
                votos,
                dignidad,
                sobreescribir: false,
                timestamp: new Date().toISOString(),
                _info: { parroquia: juntaParroquia, zona: juntaZona, junta: juntaNombre, dignidad }
            });
            localStorage.setItem('cola_votos', JSON.stringify(cola));
            actualizarBadgePendientes();
        }

        if (archivoFoto) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const fotasCola = JSON.parse(localStorage.getItem('cola_fotos') || '[]');
                fotasCola.push({ junta_id: juntaId, id_veedor: idVeedor, base64: e.target.result, nombre: archivoFoto.name });
                localStorage.setItem('cola_fotos', JSON.stringify(fotasCola));
                actualizarBadgePendientes();
            };
            reader.readAsDataURL(archivoFoto);
        }

        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Guardar Resultados del Acta';

        const total = votos.reduce((a, v) => a + v.votos, 0);
        document.getElementById('modalMensaje').textContent =
            ` Modo Offline: ${total} votos guardados localmente para ${juntaParroquia} · ${juntaZona} · ${juntaNombre}. Se enviarán al servidor al recuperar conexión.`;
        document.getElementById('modalFotoStatus').textContent = archivoFoto
            ? ' Foto guardada localmente, se subirá al reconectarse.'
            : '';
        document.getElementById('modalFotoStatus').style.color = '#d97706';
        document.getElementById('modalExito').style.display = 'flex';
        return;
    }

    const progreso = document.getElementById('progresoGuardado');
    progreso.style.display = 'block';
    setPaso('pasoVotos', 'activo');

    let fotoOk = false, fotoMsg = '';

    try {
        const resVotos = await fetch(`${API}/registrar-resultados`, {
            method: 'POST',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ junta_id: juntaId, id_veedor: idVeedor, votos, sobreescribir: yaRegistrada, dignidad })
        });
        const dataVotos = await resVotos.json();

        if (dataVotos.codigo === 'ACCESO_BLOQUEADO') {
            localStorage.setItem('sistemaAccesoBloqueado', '1');
            setPaso('pasoVotos', 'error');
            mostrarError(' El sistema está bloqueado. No se pueden registrar resultados.');
            return;
        }

        if (!dataVotos.success) {
            setPaso('pasoVotos', 'error');
            mostrarError(dataVotos.message || 'Error al guardar los votos');
            return;
        }

        setPaso('pasoVotos', 'ok');

        if (archivoFoto) {
            setPaso('pasoFoto', 'activo');
            const formData = new FormData();
            formData.append('foto',      archivoFoto);
            formData.append('junta_id',  juntaId);
            formData.append('id_veedor', idVeedor);

            const resFoto = await fetch(`${API}/subir-foto`, { method: 'POST', headers: getHeaders(), body: formData });
            const dataFoto = await resFoto.json();

            if (dataFoto.success) {
                fotoOk  = true;
                fotoMsg = ' Foto del acta guardada correctamente.';
                setPaso('pasoFoto', 'ok');
            } else {
                fotoMsg = ` Votos guardados, pero la foto no pudo subirse: ${dataFoto.message}`;
                setPaso('pasoFoto', 'error');
            }
        } else {
            setPaso('pasoFoto', 'skip');
        }

        const total = votos.reduce((a, v) => a + v.votos, 0);
        document.getElementById('modalMensaje').textContent =
            `Se registraron ${total} votos para ${juntaParroquia} · ${juntaZona} · ${juntaNombre}.`;

        const fotoStatus = document.getElementById('modalFotoStatus');
        if (fotoMsg) {
            fotoStatus.style.cssText = `font-size:0.83rem;color:${fotoOk ? '#059669' : '#d97706'};`;
            fotoStatus.textContent   = fotoMsg;
        }

        setTimeout(() => {
            progreso.style.display = 'none';
            document.getElementById('modalExito').style.display = 'flex';
        }, 600);

    } catch (err) {
        mostrarError('Error de conexión con el servidor.');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Guardar Resultados del Acta';
    }
}

function setPaso(id, estado) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    const iconos  = { activo: 'fa-circle-notch fa-spin', ok: 'fa-check-circle', error: 'fa-times-circle', skip: 'fa-minus-circle' };
    const colores = { activo: '#3b82f6', ok: '#10b981', error: '#ef4444', skip: '#94a3b8' };
    const i = el.querySelector('i');
    if (i) { i.className = `fas ${iconos[estado]}`; i.style.color = colores[estado]; }
}

function mostrarError(msg) {
    document.getElementById('progresoGuardado').style.display = 'none';
    document.getElementById('modalErrorMsg').textContent      = msg;
    document.getElementById('modalError').style.display       = 'flex';
}

function cerrarModalError() {
    document.getElementById('modalError').style.display = 'none';
}

function irASeleccion() {
    ['juntaId','juntaParroquia','juntaZona','juntaNombre','juntaYaRegistrada']
        .forEach(k => localStorage.removeItem(k));
    window.location.href = '../seleccion/seleccion.html';
}

function volverSeleccion() {
    window.location.href = '../seleccion/seleccion.html';
}

function abrirLightbox(src) {
    document.getElementById('lightboxImg').src        = src;
    document.getElementById('lightbox').style.display = 'flex';
}

function cerrarLightbox() {
    document.getElementById('lightbox').style.display = 'none';
}
