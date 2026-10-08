const API = window.location.origin;

function getHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return { 'ngrok-skip-browser-warning': 'true', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const REFRESH_INTERVAL_MS = 10000;

document.addEventListener('DOMContentLoaded', () => {
    const nombre = localStorage.getItem('nombreUsuarioActivo') || 'Admin';
    const el = document.getElementById('adminNombre');
    if (el) el.textContent = nombre.charAt(0).toUpperCase() + nombre.slice(1);

    sincronizarMenuResponsive();
    window.addEventListener('resize', sincronizarMenuResponsive);

    configurarUISuperadmin();
    verificarBloqueoPanelAdmin();

    cargarEstadoDignidades();

    inicializar();
    setInterval(() => {
        if (document.getElementById('seccionResultados')?.classList.contains('activa')) {
            cargarTodo();
        }
        verificarBloqueoPanelAdmin();
    }, REFRESH_INTERVAL_MS);
    async function inicializar() {
    await aplicarFiltrosDignidades();
    await cargarFiltroParroquias();
    await cargarTodo();
    const rol = localStorage.getItem('rolUsuario');
    if (rol === 'superadmin') {
        document.getElementById('menuCandidatos').style.display = 'flex';
        document.getElementById('menuConfiguracion').style.display = 'flex';
    }
    if (rol === 'superadmin' || rol === 'admin') {
        document.getElementById('menuCorreccion').style.display = 'flex';
        document.getElementById('menuAsignacion').style.display = 'flex';
    }
    }
});

function getRolAdmin() {
    return localStorage.getItem('rolUsuario') || '';
}

function esSuperadmin() {
    return getRolAdmin() === 'superadmin';
}

function configurarUISuperadmin() {
    const panel = document.getElementById('panelSuperadmin');
    if (panel) panel.style.display = esSuperadmin() ? 'block' : 'none';
    if (esSuperadmin()) cargarEstadoAcceso();
}

function actualizarUIBloqueoAcceso(bloqueado) {
    const btn   = document.getElementById('btnToggleAcceso');
    const texto = document.getElementById('estadoAccesoTexto');
    if (!btn || !texto) return;

    btn.dataset.bloqueado = bloqueado ? '1' : '0';

    if (bloqueado) {
        texto.textContent = 'BLOQUEADO: administradores y veedores no pueden ingresar ni registrar actas. Solo tú (superadmin) tiene acceso.';
        btn.className = 'btn-toggle-acceso desbloquear';
        btn.innerHTML = '<i class="fas fa-lock-open"></i> Desbloquear acceso';
    } else {
        texto.textContent = 'Acceso normal: admin y veedores pueden ingresar y trabajar.';
        btn.className = 'btn-toggle-acceso bloquear';
        btn.innerHTML = '<i class="fas fa-ban"></i> Bloquear acceso';
    }
}

async function verificarBloqueoPanelAdmin() {
    if (esSuperadmin()) return;
    try {
        const res  = await fetch(`${API}/estado-acceso`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success && data.bloqueado) {
            alert(' El sistema fue bloqueado por el superadministrador. Su sesión se cerrará.');
            localStorage.clear();
            window.location.href = '../acceso/acceso.html';
        }
    } catch (err) {
        /* sin conexión */
    }
}

async function cargarEstadoAcceso() {
    if (!esSuperadmin()) return;
    try {
        const res  = await fetch(`${API}/estado-acceso`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success) actualizarUIBloqueoAcceso(!!data.bloqueado);
    } catch (err) {
        const texto = document.getElementById('estadoAccesoTexto');
        if (texto) texto.textContent = 'No se pudo cargar el estado de acceso.';
    }
}

async function toggleBloqueoAcceso() {
    if (!esSuperadmin()) return;

    const btn       = document.getElementById('btnToggleAcceso');
    const bloqueado = btn?.dataset.bloqueado === '1';
    const nuevoEstado = !bloqueado;

    const msg = nuevoEstado
        ? '¿Bloquear el acceso?\n\nNingún administrador ni veedor podrá ingresar ni registrar actas hasta que lo desbloquees.'
        : '¿Desbloquear el acceso?\n\nAdmin y veedores podrán ingresar con normalidad.';
    if (!confirm(msg)) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando...';
    }

    try {
        const res = await fetch(`${API}/bloqueo-acceso`, {
            method: 'POST',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ bloquear: nuevoEstado })
        });
        const data = await res.json();

        if (data.success) {
            actualizarUIBloqueoAcceso(!!data.bloqueado);
            localStorage.setItem('sistemaAccesoBloqueado', data.bloqueado ? '1' : '0');
            alert(' ' + data.message);
        } else {
            alert(' ' + (data.message || 'No se pudo cambiar el bloqueo'));
        }
    } catch (err) {
        alert(' Error de conexión.');
    } finally {
        if (btn) btn.disabled = false;
        await cargarEstadoAcceso();
    }
}

// ── DIGNIDADES ────────────────────────────────────
const DIGNIDADES_LIST = [
    { clave: 'ALCALDE',              label: 'Alcalde o Alcaldesa',     icono: 'fa-user-tie' },
    { clave: 'CONCEJALES_URBANOS',   label: 'Concejales Urbanos',      icono: 'fa-city' },
    { clave: 'CONCEJALES_RURALES',   label: 'Concejales Rurales',      icono: 'fa-tree-city' },
    { clave: 'JUNTAS_PARROQUIALES',  label: 'Juntas Parroquiales',     icono: 'fa-people-group' },
];

// Set global de dignidades habilitadas (se actualiza en aplicarFiltrosDignidades)
let dignidadesHabilitadasSet = null;

async function aplicarFiltrosDignidades() {
    let habilitadas;
    try {
        const res  = await fetch(`${API}/dignidades-estado`, { headers: getHeaders() });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.dignidades)) return;
        habilitadas = new Set(data.dignidades.filter(d => Number(d.habilitada) === 1).map(d => d.clave));
    } catch (e) { return; }
    dignidadesHabilitadasSet = habilitadas;

    const LABELS = {
        ALCALDE: 'Alcalde',
        CONCEJALES_URBANOS: 'Concejales Urbanos',
        CONCEJALES_RURALES: 'Concejales Rurales',
        JUNTAS_PARROQUIALES: 'Juntas Parroquiales'
    };

    const reconstruir = (id, incluirTodas) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const actual = sel.value;
        const claves = DIGNIDADES_LIST.map(d => d.clave).filter(c => habilitadas.has(c));
        sel.innerHTML = '';
        if (incluirTodas) sel.appendChild(new Option('Todas las dignidades', ''));
        if (claves.length === 0) {
            sel.appendChild(new Option('Sin dignidades habilitadas', ''));
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        claves.forEach(c => sel.appendChild(new Option(LABELS[c] || c, c)));
        if (claves.includes(actual)) sel.value = actual;
    };

    reconstruir('filtroDignidad', false);
    reconstruir('filtroDignidadCandidatos', false);
    reconstruir('configDignidad', false);
    reconstruir('configFiltroDignidad', true);
}

async function cargarEstadoDignidades() {
    if (!esSuperadmin()) return;
    const panel = document.getElementById('panelDignidades');
    if (panel) panel.style.display = 'block';

    const lista = document.getElementById('dignidadToggleList');
    if (!lista) return;

    try {
        const res  = await fetch(`${API}/dignidades-estado`, { headers: getHeaders() });
        const data = await res.json();

        if (!data.success) return;

        lista.innerHTML = DIGNIDADES_LIST.map(d => {
            const estado = data.dignidades.find(e => e.clave === d.clave);
            const habilitada = estado ? estado.habilitada : true;
            return `
            <div class="dignidad-toggle-item">
                <div>
                    <i class="fas ${d.icono}" style="color:#8b5cf6;width:20px;"></i>
                    <strong>${d.label}</strong>
                </div>
                <label class="switch">
                    <input type="checkbox"
                           ${habilitada ? 'checked' : ''}
                           onchange="toggleDignidad('${d.clave}', this.checked)">
                    <span class="slider round"></span>
                </label>
            </div>`;
        }).join('');

    } catch (e) {
        console.error('Error cargando estado dignidades:', e);
    }
}

async function toggleDignidad(clave, habilitada) {
    try {
        const res  = await fetch(`${API}/dignidades-estado/${clave}`, {
            method: 'POST',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ habilitada })
        });
        const data = await res.json();
        if (!data.success) {
            alert('Error: ' + (data.message || 'No se pudo cambiar el estado'));
            await cargarEstadoDignidades();
        } else {
            await aplicarFiltrosDignidades();
            refrescarSeccionActiva();
        }
    } catch (e) {
        alert('Error de conexión');
        await cargarEstadoDignidades();
    }
}

function esVistaMovil() {
    return window.matchMedia('(max-width: 900px)').matches;
}

function abrirMenu() {
    document.querySelector('.admin-container')?.classList.add('sidebar-is-open');
    if (esVistaMovil()) document.body.style.overflow = 'hidden';
}

function cerrarMenu() {
    document.querySelector('.admin-container')?.classList.remove('sidebar-is-open');
    document.body.style.overflow = '';
}

function toggleMenu() {
    const cont = document.querySelector('.admin-container');
    if (!cont) return;
    if (cont.classList.contains('sidebar-is-open')) cerrarMenu();
    else abrirMenu();
}

let _vistaMovilAnterior = null;

function sincronizarMenuResponsive() {
    const cont = document.querySelector('.admin-container');
    if (!cont) return;

    const movil = esVistaMovil();

    if (_vistaMovilAnterior === null) {
        _vistaMovilAnterior = movil;
        if (movil) cont.classList.remove('sidebar-is-open');
        return;
    }

    if (movil === _vistaMovilAnterior) return;
    _vistaMovilAnterior = movil;
    document.body.style.overflow = '';

    if (movil) cont.classList.remove('sidebar-is-open');
    else cont.classList.add('sidebar-is-open');
}

function mostrarSeccion(nombre) {
    document.querySelectorAll('.seccion-panel').forEach(el => el.classList.remove('activa'));
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    const n = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    document.getElementById('seccion' + n)?.classList.add('activa');
    document.getElementById('menu'    + n)?.classList.add('active');

    if (esVistaMovil()) cerrarMenu();

    if (nombre === 'resultados')   cargarTodo();
    if (nombre === 'juntas')       cargarEstadoJuntas();
    if (nombre === 'correccion')   cargarCorreccionJuntas();
    if (nombre === 'asignacion')   cargarAsignacionJuntas();
    if (nombre === 'actas')        cargarFotos();
    if (nombre === 'candidatos')   { if (esSuperadmin()) cargarCandidatosAdmin(); }
    if (nombre === 'configuracion') { if (esSuperadmin()) { cargarJuntasConfig(); cargarDatalists(); } }
    if (nombre === 'usuarios')     cargarUsuarios();
}

async function cargarFiltroParroquias() {
    try {
        const res   = await fetch(`${API}/parroquias-disponibles`, { headers: getHeaders() });
        const datos = await res.json();
        const sel   = document.getElementById('filtroParroquia');
        if (!sel) return;
        sel.innerHTML = '<option value="todas">Todas las Parroquias</option>';
        datos.forEach(p => {
            const o = document.createElement('option');
            o.value = o.textContent = p.parroquia;
            sel.appendChild(o);
        });
    } catch (e) { console.error('Filtro parroquias:', e); }
}

function refrescarSeccionActiva() {
    const activa = document.querySelector('.seccion-panel.activa');
    if (activa) {
        const id = activa.id;
        if (id === 'seccionResultados') cargarTodo();
        else if (id === 'seccionJuntas') cargarEstadoJuntas();
        else if (id === 'seccionCorreccion') cargarCorreccionJuntas();
        else if (id === 'seccionActas') cargarFotos();
    }
}

function onFiltroDignidadChange() { refrescarSeccionActiva(); }
function onFiltroZonaChange() { refrescarSeccionActiva(); }

async function onFiltroParroquiaChange() {
    const parroquia = document.getElementById('filtroParroquia').value;
    const selZona   = document.getElementById('filtroZona');
    selZona.innerHTML = '<option value="todas">Todas las Zonas</option>';

    if (parroquia !== 'todas') {
        try {
            const res   = await fetch(
                `${API}/zonas-disponibles?parroquia=${encodeURIComponent(parroquia)}`, { headers: getHeaders() }
            );
            const datos = await res.json();
            datos.forEach(z => {
                const o = document.createElement('option');
                o.value = o.textContent = z.zona;
                selZona.appendChild(o);
            });
        } catch (e) { console.error('Filtro zonas:', e); }
    }
    await refrescarSeccionActiva();
}

function getFiltros() {
    return {
        parroquia: document.getElementById('filtroParroquia')?.value || 'todas',
        zona:      document.getElementById('filtroZona')?.value      || 'todas',
        dignidad:  document.getElementById('filtroDignidad')?.value || 'ALCALDE'
    };
}

async function cargarTodo() {
    const { parroquia, zona, dignidad } = getFiltros();
    const qs = `parroquia=${encodeURIComponent(parroquia)}&zona=${encodeURIComponent(zona)}&dignidad=${encodeURIComponent(dignidad)}`;

    const digNombres = { ALCALDE:'Alcalde', CONCEJALES_URBANOS:'Concejales Urbanos', CONCEJALES_RURALES:'Concejales Rurales', JUNTAS_PARROQUIALES:'Juntas Parroquiales' };
    const headerDig = document.getElementById('headerDignidadNombre');
    if (headerDig) headerDig.textContent = digNombres[dignidad] || dignidad;

    const btn = document.querySelector('.btn-refresh');
    if (btn) { btn.disabled = true; }

    try {
        const [resStats, resEsp, resResumen, resPend] = await Promise.all([
            fetch(`${API}/estadisticas?${qs}`,            { headers: getHeaders() }),
            fetch(`${API}/estadisticas-especiales?${qs}`, { headers: getHeaders() }),
            fetch(`${API}/estadisticas-resumen?${qs}`,    { headers: getHeaders() }),
            fetch(`${API}/juntas-pendientes?${qs}`,       { headers: getHeaders() })
        ]);

        const stats   = await resStats.json();
        const esp     = await resEsp.json();
        const resumen = await resResumen.json();
        const pend    = await resPend.json();

        renderKPIs(stats, resumen, pend);
        renderGrafico(stats);
        renderTablaCandidatos(stats);
        renderEspeciales(esp);
        marcarUltimaActualizacion();

    } catch (e) {
        console.error('Error cargarTodo:', e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function marcarUltimaActualizacion() {
    const el = document.getElementById('lastUpdate');
    if (!el) return;
    const ahora = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `Actualizado ${ahora}`;
}

function renderKPIs(stats, resumen, pendientes) {
    const totalVotos    = Number(resumen.total_votos)     || 0;
    const juntasConActa = Number(resumen.juntas_con_acta) || 0;
    const totalJuntas   = Number(resumen.total_juntas)    || 0;

    animarContador('kpiTotalVotos',    totalVotos);
    animarContador('kpiJuntasConActa', juntasConActa);
    animarContador('kpiPendientes',    pendientes.length || 0);

    const pctActas = totalJuntas > 0
        ? ((juntasConActa / totalJuntas) * 100).toFixed(1)
        : 0;

    const elTotal = document.getElementById('kpiTotalJuntas');
    if (elTotal) elTotal.textContent = `de ${totalJuntas} juntas`;

    const elPct   = document.getElementById('kpiPctActas');
    const elBarra = document.getElementById('barraProgreso');
    if (elPct)   elPct.textContent = `${pctActas}%`;
    if (elBarra) {
        setTimeout(() => { elBarra.style.width = `${pctActas}%`; }, 100);
        if      (pctActas >= 80) elBarra.style.background = 'linear-gradient(90deg,#10b981,#059669)';
        else if (pctActas >= 50) elBarra.style.background = 'linear-gradient(90deg,#3b82f6,#10b981)';
        else if (pctActas >= 25) elBarra.style.background = 'linear-gradient(90deg,#f59e0b,#3b82f6)';
        else                     elBarra.style.background = 'linear-gradient(90deg,#ef4444,#f59e0b)';
    }

    const elLider = document.getElementById('kpiLider');
    if (elLider) elLider.textContent = stats.length > 0 ? stats[0].candidato : '—';
}

// Plugin: muestra el total de votos sobre cada barra del gráfico
const pluginVotosBarras = {
    id: 'etiquetasVotos',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((ds, i) => {
            const meta = chart.getDatasetMeta(i);
            if (meta.hidden) return;
            meta.data.forEach((bar, idx) => {
                const v = ds.data[idx];
                if (v === undefined || v === null) return;
                ctx.save();
                ctx.fillStyle = '#334155';
                ctx.font = "700 13px 'Plus Jakarta Sans', sans-serif";
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(Number(v).toLocaleString(), bar.x, bar.y - 8);
                ctx.restore();
            });
        });
    }
};

function renderGrafico(datos) {
    const canvas = document.getElementById('graficoCandidatos');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window._grafico) window._grafico.destroy();

    const paleta = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899','#14b8a6'];

    const labels = datos.map(d => d.candidato);
    const values = datos.map(d => d.total);
    const colors = datos.map((_, i) => paleta[i % paleta.length]);

    window._grafico = new Chart(ctx, {
        type: 'bar',
        plugins: [pluginVotosBarras],
        data: {
            labels,
            datasets: [{
                label: 'Votos',
                data: values,
                backgroundColor: colors.map(c => c + 'cc'),
                borderColor: colors,
                borderWidth: 2,
                borderRadius: 10,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a', titleColor: '#f8fafc',
                    bodyColor: '#94a3b8', padding: 14, cornerRadius: 12,
                    titleFont: { family: "'Plus Jakarta Sans', sans-serif", weight: '700' },
                    bodyFont: { family: "'Plus Jakarta Sans', sans-serif" },
                    callbacks: { label: ctx => `  ${ctx.parsed.y.toLocaleString()} votos` }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }, maxRotation: 35 }
                },
                y: {
                    beginAtZero: true,
                    grace: '8%',
                    grid: { color: '#f1f5f9' },
                    ticks: { precision: 0, color: '#94a3b8', font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 } }
                }
            }
        }
    });
}

function renderTablaCandidatos(datos) {
    const tbody = document.getElementById('tablaCandidatos');
    if (!tbody) return;

    const total = datos.reduce((a, c) => a + Number(c.total), 0);

    if (!datos.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px;">Sin resultados ingresados aún</td></tr>`;
        return;
    }

    const paleta = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899','#14b8a6'];
    tbody.innerHTML = datos.map((d, i) => {
        const dTotal = Number(d.total);
        const pct   = total > 0 ? ((dTotal / total) * 100).toFixed(1) : 0;
        const color = paleta[i % paleta.length];
        const rank = i === 0
            ? '<span class="rank-badge gold">🏆</span>'
            : `<span class="rank-badge">${i + 1}</span>`;
        return `<tr class="candidato-row">
            <td>${rank}</td>
            <td>
                <div class="candidato-nombre">
                    <span class="candidato-dot" style="background:${color};"></span>
                    ${d.candidato}
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${pct}%;background:${color};"></div>
                </div>
            </td>
            <td><span class="badge-votos">${dTotal.toLocaleString()}</span></td>
            <td style="font-weight:700;color:#334155;">${pct}%</td>
        </tr>`;
    }).join('');
}

function renderEspeciales(datos) {
    const el = document.getElementById('tablaEspeciales');
    if (!el) return;

    if (!datos.length) {
        el.innerHTML = `<span style="color:#94a3b8;font-size:0.85rem;">Sin datos</span>`;
        return;
    }

    el.innerHTML = datos.map(d => {
        const tipo  = d.candidato === 'NULO' ? 'nulo' : 'blanco';
        const icono = d.candidato === 'NULO' ? 'fa-ban' : 'fa-square';
        const label = d.candidato === 'NULO' ? 'Votos Nulos' : 'Votos Blancos';
        return `<div class="badge-especial ${tipo}">
            <i class="fas ${icono}"></i>
            <span>${label}: <strong>${d.total.toLocaleString()}</strong></span>
        </div>`;
    }).join('');
}

async function cargarEstadoJuntas() {
    try {
        const { parroquia, zona, dignidad } = getFiltros();
        const qs = `parroquia=${encodeURIComponent(parroquia)}&zona=${encodeURIComponent(zona)}&dignidad=${encodeURIComponent(dignidad)}`;

        const [resDetalle, resPend] = await Promise.all([
            fetch(`${API}/estadisticas-junta?${qs}`, { headers: getHeaders() }),
            fetch(`${API}/juntas-pendientes?${qs}`,  { headers: getHeaders() })
        ]);

        const detalle    = await resDetalle.json();
        const pendientes = await resPend.json();

        const juntas = {};
        detalle.forEach(r => {
            const key = `${r.parroquia} · ${r.zona} · ${r.numero_junta}`;
            if (!juntas[key]) juntas[key] = {
                veedor: r.veedor, fecha: r.fecha_registro,
                tiene_foto: !!r.foto_url, junta_id: r.junta_id
            };
        });

        const elReg = document.getElementById('listaJuntasRegistradas');
        if (elReg) {
            const keys = Object.keys(juntas);
            elReg.innerHTML = keys.length === 0
                ? `<p class="empty-state">Sin juntas registradas</p>`
                : keys.map(k => `
    <div class="junta-tag ok">
        <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0;">
            <i class="fas fa-check-circle"></i>
            <div>
                <div style="font-weight:700;">${k}</div>
                <div class="junta-tag-meta">
                    ${juntas[k].veedor}
                    ${juntas[k].tiene_foto
                        ? `<span style="color:#2563eb;margin-left:6px;"><i class="fas fa-camera"></i> con foto</span>`
                        : ''}
                </div>
            </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
            ${juntas[k].tiene_foto
                ? `<button onclick="eliminarFoto(${juntas[k].junta_id}, '${k.replace(/'/g, "\\'")}')"
                        class="btn-eliminar-foto" title="Eliminar solo la foto">
                    <i class="fas fa-camera-slash"></i>
                </button>`
                : ''}
            <button onclick="eliminarResultados(${juntas[k].junta_id}, '${k.replace(/'/g, "\\'")}')"
                    class="btn-eliminar-acta" title="Eliminar acta y votos">
                <i class="fas fa-trash"></i> Eliminar
            </button>
        </div>
    </div>`).join('');
        }

        const elPend = document.getElementById('listaJuntasPendientes');
        if (elPend) {
            elPend.innerHTML = pendientes.length === 0
                ? `<p class="empty-state success"> Todas las juntas tienen acta</p>`
                : pendientes.map(j => `
                    <div class="junta-tag pending">
                        <i class="fas fa-hourglass-half"></i>
                        ${j.parroquia} · ${j.zona} · ${j.numero_junta}
                    </div>`).join('');
        }

    } catch (e) { console.error('Estado juntas:', e); }
}

async function cargarFotos() {
    const galeria = document.getElementById('galeria-fotos');
    if (!galeria) return;

    galeria.innerHTML = `<div class="loading-block">
        <i class="fas fa-circle-notch fa-spin"></i>
        <p>Cargando fotos...</p>
    </div>`;

    const { parroquia, zona, dignidad } = getFiltros();
    const qs = `parroquia=${encodeURIComponent(parroquia)}&zona=${encodeURIComponent(zona)}&dignidad=${encodeURIComponent(dignidad)}`;

    try {
        const res   = await fetch(`${API}/todas-fotos?${qs}`, { headers: getHeaders() });
        const datos = await res.json();

        if (!datos.length) {
            galeria.innerHTML = `<div class="foto-sin-foto">
                <i class="fas fa-camera-slash"></i>
                <strong>Sin fotos de actas aún</strong>
                <p style="margin-top:6px;">Los veedores aún no han subido fotos</p>
            </div>`;
            return;
        }

        galeria.innerHTML = datos.map(f => {
            const fecha = f.fecha_subida
                ? new Date(f.fecha_subida).toLocaleDateString('es-EC', {
                      day:'2-digit', month:'short', year:'numeric',
                      hour:'2-digit', minute:'2-digit'
                  })
                : '—';
            return `<div class="foto-card">
                <img class="foto-card-img"
                     src="${API}${f.url}"
                     alt="Acta ${f.numero_junta}"
                     loading="lazy"
                     onclick="abrirLightbox('${API}${f.url}','${f.parroquia} · ${f.zona} · ${f.numero_junta}','${f.veedor || '—'}','${fecha}')"
                     onerror="this.src='data:image/svg+xml,%3Csvg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 200 150&quot;%3E%3Crect fill=&quot;%23f1f5f9&quot; width=&quot;200&quot; height=&quot;150&quot;/%3E%3Ctext x=&quot;50%25&quot; y=&quot;50%25&quot; text-anchor=&quot;middle&quot; fill=&quot;%2394a3b8&quot; font-size=&quot;13&quot; dy=&quot;.3em&quot;%3ESin imagen%3C/text%3E%3C/svg%3E'">
                <div class="foto-card-body">
                    <div class="foto-card-titulo">
                        ${f.parroquia} · ${f.numero_junta}
                    </div>
                    <div class="foto-card-meta">
                        <span><i class="fas fa-layer-group"></i> Zona: ${f.zona}</span>
                        <span><i class="fas fa-user"></i> Veedor: ${f.veedor || '—'}</span>
                        <span><i class="fas fa-clock"></i> ${fecha}</span>
                    </div>
                </div>
                <div class="foto-card-actions">
                    <button class="btn-ver-foto"
                            onclick="abrirLightbox('${API}${f.url}','${f.parroquia} · ${f.zona} · ${f.numero_junta}','${f.veedor || '—'}','${fecha}')">
                        <i class="fas fa-expand"></i> Ver completa
                    </button>
                    <button class="btn-eliminar-foto"
                            onclick="eliminarFoto(${f.junta_id},'${f.parroquia} · ${f.numero_junta}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

    } catch (e) {
        galeria.innerHTML = `<div class="foto-sin-foto" style="grid-column:1/-1;">
            <i class="fas fa-exclamation-circle" style="color:#ef4444;"></i>
            <strong>Error cargando fotos</strong>
            <p>Verifica la conexión con el servidor</p>
        </div>`;
    }
}

function abrirLightbox(url, titulo, veedor, fecha) {
    document.getElementById('lightboxAdminImg').src = url;
    document.getElementById('lightboxAdminInfo').innerHTML =
        `<strong>${titulo}</strong> · Veedor: ${veedor} · ${fecha}`;
    document.getElementById('lightboxAdmin').style.display = 'flex';
}

function cerrarLightboxAdmin() {
    document.getElementById('lightboxAdmin').style.display = 'none';
    document.getElementById('lightboxAdminImg').src = '';
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarLightboxAdmin();
});

async function eliminarFoto(juntaId, nombre) {
    if (!confirm(`¿Eliminar la foto de "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
        const res  = await fetch(`${API}/foto-acta/${juntaId}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) cargarFotos();
        else alert('No se pudo eliminar: ' + data.message);
    } catch (e) { alert('Error de red al eliminar la foto.'); }
}

let candidatosCacheAdmin = [];
let editandoCandidato = null;   // id del candidato en edición
let fotoEditTmp = undefined;    // undefined = sin cambio | null = quitar | string = nueva foto

async function cargarCandidatosAdmin() {
    const tbody = document.getElementById('tablaCandidatosAdmin');
    if (!tbody) return;
    const dignidadFiltro = document.getElementById('filtroDignidadCandidatos')?.value || 'ALCALDE';

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">
        <i class="fas fa-circle-notch fa-spin"></i> Cargando...
    </td></tr>`;

    try {
        const res   = await fetch(`${API}/candidatos?dignidad=${encodeURIComponent(dignidadFiltro)}`, { headers: getHeaders() });
        const datos = await res.json();
        candidatosCacheAdmin = Array.isArray(datos) ? datos : [];
        renderCandidatosTabla();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:20px;"> Error de conexión</td></tr>`;
    }
}

const DIGNIDAD_NOMBRES_CAND = {
    ALCALDE: 'Alcalde',
    CONCEJALES_URBANOS: 'Concejales Urbanos',
    CONCEJALES_RURALES: 'Concejales Rurales',
    JUNTAS_PARROQUIALES: 'Juntas Parroquiales',
};

function renderCandidatosTabla() {
    const tbody = document.getElementById('tablaCandidatosAdmin');
    if (!tbody) return;
    const datos = candidatosCacheAdmin;

    tbody.innerHTML = datos.length === 0
        ? `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">No hay candidatos</td></tr>`
        : datos.map(c => Number(editandoCandidato) === Number(c.id)
            ? filaEdicionCandidato(c)
            : filaCandidato(c)).join('');
}

function filaCandidato(c) {
    const dn = DIGNIDAD_NOMBRES_CAND;
    return `<tr>
        <td style="color:#94a3b8;">${c.orden || '—'}</td>
        <td><strong>${c.nombre}</strong></td>
        <td style="color:#64748b;">${c.partido || '—'}</td>
        <td style="color:#64748b;font-size:0.82rem;">${dn[c.dignidad] || c.dignidad || '—'}</td>
        <td>${c.foto
            ? `<img class="cand-foto" src="${c.foto}" alt="Foto de ${escAtr(c.nombre)}">`
            : '<span class="cand-sin-foto">Sin foto</span>'}</td>
        <td>
            <button class="btn-agregar" onclick="editarCandidato(${Number(c.id)})">
                <i class="fas fa-pen"></i> Editar
            </button>
            <button class="btn-eliminar" onclick="eliminarCandidato(${c.id},'${c.nombre.replace(/'/g, "\\'")}')">
                <i class="fas fa-trash-alt"></i> Eliminar
            </button>
        </td>
    </tr>`;
}

function filaEdicionCandidato(c) {
    const dn = DIGNIDAD_NOMBRES_CAND;
    const fotoActual = fotoEditTmp !== undefined ? fotoEditTmp : (c.foto || null);
    return `<tr class="cand-edit-row">
        <td><input type="number" id="editOrdenCand" min="0" max="9999" value="${c.orden || 0}" class="cand-input"></td>
        <td><input type="text" id="editNombreCand" value="${escAtr(c.nombre)}" maxlength="150" class="cand-input cand-input--ancho"></td>
        <td><input type="text" id="editPartidoCand" value="${escAtr(c.partido || '')}" maxlength="150" class="cand-input"></td>
        <td style="color:#64748b;font-size:0.82rem;">${dn[c.dignidad] || c.dignidad || '—'}</td>
        <td>
            <div class="cand-foto-edit">
                <div id="editFotoPreview">${fotoActual
                    ? `<img class="cand-foto" src="${fotoActual}">`
                    : '<span class="cand-sin-foto">Sin foto</span>'}</div>
                <label class="btn-mini-foto" title="Subir foto">
                    <i class="fas fa-camera"></i> Foto
                    <input type="file" accept="image/*" style="display:none;"
                           onchange="seleccionarFotoCandidato(this)">
                </label>
                <button type="button" class="btn-mini-foto btn-mini-quitar" onclick="quitarFotoCandidato()"
                        title="Quitar foto"><i class="fas fa-times"></i></button>
            </div>
        </td>
        <td>
            <button class="btn-agregar" onclick="guardarCandidato()">
                <i class="fas fa-save"></i> Guardar
            </button>
            <button class="btn-refresh" onclick="cancelarEdicionCandidato()">Cancelar</button>
        </td>
    </tr>`;
}

function editarCandidato(id) {
    editandoCandidato = Number(id);
    fotoEditTmp = undefined;
    renderCandidatosTabla();
    document.getElementById('editNombreCand')?.focus();
}

function cancelarEdicionCandidato() {
    editandoCandidato = null;
    fotoEditTmp = undefined;
    renderCandidatosTabla();
}

function redimensionarFoto(file, maxLado = 240) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let w = img.naturalWidth, h = img.naturalHeight;
            const escala = Math.min(1, maxLado / Math.max(w, h));
            w = Math.max(1, Math.round(w * escala));
            h = Math.max(1, Math.round(h * escala));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
        img.src = url;
    });
}

async function seleccionarFotoCandidato(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { alert('Seleccione un archivo de imagen'); return; }
    try {
        fotoEditTmp = await redimensionarFoto(f);
        pintarPreviewFotoEdit();
    } catch (e) { alert('❌ ' + e.message); }
    input.value = '';
}

function quitarFotoCandidato() {
    fotoEditTmp = null;
    pintarPreviewFotoEdit();
}

function pintarPreviewFotoEdit() {
    const el = document.getElementById('editFotoPreview');
    if (!el) return;
    const c = candidatosCacheAdmin.find(x => Number(x.id) === Number(editandoCandidato));
    const fotoActual = fotoEditTmp !== undefined ? fotoEditTmp : (c ? c.foto : null);
    el.innerHTML = fotoActual
        ? `<img class="cand-foto" src="${fotoActual}">`
        : '<span class="cand-sin-foto">Sin foto</span>';
}

async function guardarCandidato() {
    if (!editandoCandidato) return;
    const nombre  = (document.getElementById('editNombreCand')?.value || '').trim();
    const partido = (document.getElementById('editPartidoCand')?.value || '').trim();
    const orden   = document.getElementById('editOrdenCand')?.value;
    if (!nombre) { alert('El nombre del candidato es requerido.'); return; }

    const body = { nombre, partido, orden: parseInt(orden, 10) || 0 };
    if (fotoEditTmp !== undefined) body.foto = fotoEditTmp;

    try {
        const res  = await fetch(`${API}/candidatos/${editandoCandidato}`, {
            method: 'PUT',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'No se pudo guardar');
        editandoCandidato = null;
        fotoEditTmp = undefined;
        await cargarCandidatosAdmin();
    } catch (e) {
        alert('❌ ' + e.message);
    }
}

async function agregarCandidato() {
    const nombre   = document.getElementById('inputNombreCandidato').value.trim();
    const partido  = document.getElementById('inputPartidoCandidato').value.trim();
    const orden    = document.getElementById('inputOrdenCandidato').value;
    const dignidad = document.getElementById('filtroDignidadCandidatos')?.value || 'ALCALDE';
    const msg      = document.getElementById('msgCandidato');

    msg.style.display = 'none';
    if (!nombre) {
        msg.style.cssText = 'display:block;color:#b91c1c;';
        msg.textContent   = 'El nombre del candidato es requerido.';
        return;
    }

    try {
        const res  = await fetch(`${API}/candidatos`, {
            method: 'POST',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ dignidad, nombre, partido, orden: parseInt(orden) || 0 })
        });
        const data = await res.json();

        if (data.success) {
            msg.style.cssText = 'display:block;color:#065f46;';
            msg.textContent   = ` "${nombre}" agregado.`;
            document.getElementById('inputNombreCandidato').value  = '';
            document.getElementById('inputPartidoCandidato').value = '';
            document.getElementById('inputOrdenCandidato').value   = '';
            cargarCandidatosAdmin();
        } else {
            msg.style.cssText = 'display:block;color:#b91c1c;';
            msg.textContent   = data.message || 'Error al agregar';
        }
    } catch (e) {
        msg.style.cssText = 'display:block;color:#b91c1c;';
        msg.textContent   = ' Error de conexión.';
    }
}

async function eliminarCandidato(id, nombre) {
    if (!confirm(`¿Eliminar al candidato "${nombre}"?`)) return;
    try {
        const res  = await fetch(`${API}/candidatos/${id}`, {
            method: 'DELETE',
            headers: getHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) cargarCandidatosAdmin();
        else alert(' ' + (data.message || 'No se pudo eliminar'));
    } catch (e) { alert('Error al eliminar'); }
}

async function cargarUsuarios() {
    const tbody = document.getElementById('cuerpoTablaUsuarios');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">
        <i class="fas fa-circle-notch fa-spin"></i> Cargando...
    </td></tr>`;

    try {
        const res  = await fetch(`${API}/usuarios`, { headers: getHeaders() });
        const data = await res.json();

        if (!data.success || !data.usuarios.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">Sin usuarios</td></tr>`;
            return;
        }

        const miId = localStorage.getItem('idUsuario');

        tbody.innerHTML = data.usuarios.map((u, i) => {
            const fecha      = u.fecha_creacion
                ? new Date(u.fecha_creacion).toLocaleDateString('es-EC') : '—';
            const esMiCuenta = String(u.id) === String(miId);
            const btn = esMiCuenta
                ? `<span style="color:#94a3b8;font-size:0.8rem;font-style:italic;">Cuenta activa</span>`
                : `<button class="btn-eliminar" onclick="eliminarUsuario(${u.id},'${u.usuario}')">
                       <i class="fas fa-trash-alt"></i> Eliminar
                   </button>`;
            return `<tr>
                <td style="color:#94a3b8;font-size:0.82rem;">${i+1}</td>
                <td>
                    <strong>${u.usuario}</strong>
                    ${esMiCuenta ? `<span style="font-size:0.72rem;color:#10b981;margin-left:6px;background:#dcfce7;padding:2px 7px;border-radius:10px;">tú</span>` : ''}
                </td>
                <td style="font-family:monospace;color:#475569;">${u.cedula || '—'}</td>
                <td><span class="badge-rol ${u.rol}">${u.rol}</span></td>
                <td style="color:#64748b;">${fecha}</td>
                <td>${btn}</td>
            </tr>`;
        }).join('');

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:20px;"> Error de conexión</td></tr>`;
    }
}

async function eliminarUsuario(id, nombre) {
    if (!confirm(`¿Eliminar al usuario "${nombre}"?`)) return;
    try {
        const res  = await fetch(`${API}/usuarios/${id}`, {
            method: 'DELETE',
            headers: getHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) cargarUsuarios();
        else alert(' ' + (data.message || 'No se pudo eliminar'));
    } catch (e) { alert(' Error de red.'); }
}

async function descargarFotosActas() {
    const parroquia = document.getElementById('filtroParroquia')?.value || 'todas';
    const zona      = document.getElementById('filtroZona')?.value || 'todas';

    let msg = '¿Descargar todas las fotos de actas en un archivo ZIP?';
    if (parroquia !== 'todas' || zona !== 'todas') {
        const partes = [];
        if (parroquia !== 'todas') partes.push(`parroquia: ${parroquia}`);
        if (zona !== 'todas') partes.push(`zona: ${zona}`);
        msg += `\n\nSe usarán los filtros actuales (${partes.join(', ')}).`;
    } else {
        msg += '\n\nSe incluirán todas las fotos registradas en el sistema.';
    }
    if (!confirm(msg)) return;

    const btn = document.getElementById('btnFotosZip');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span>Preparando ZIP...</span>';
    }

    try {
        const params = new URLSearchParams();
        if (parroquia && parroquia !== 'todas') params.set('parroquia', parroquia);
        if (zona && zona !== 'todas') params.set('zona', zona);

        const qs  = params.toString();
        const url = `${API}/descargar-fotos-actas${qs ? `?${qs}` : ''}`;
        const res = await fetch(url, { headers: getHeaders() });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'No se pudo generar el ZIP');
        }

        const blob  = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const link   = document.createElement('a');
        const fecha  = new Date().toISOString().split('T')[0];
        link.href = objUrl;
        link.download = `Fotos_Actas_Veedores_${fecha}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objUrl);
    } catch (e) {
        alert(' ' + (e.message || 'No se pudo descargar las fotos'));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-images"></i> <span>Descargar fotos actas</span>';
        }
    }
}

async function descargarExcel() {
    if (!confirm('¿Descargar reporte completo en Excel?')) return;
    const btn = document.getElementById('btnExcel');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generando...'; }
    try {
        const res = await fetch(`${API}/descargar-excel`, { headers: getHeaders() });
        if (!res.ok) throw new Error('Error del servidor');
        const blob  = await res.blob();
        const url   = URL.createObjectURL(blob);
        const link  = document.createElement('a');
        const fecha = new Date().toISOString().split('T')[0];
        link.href = url; link.download = `Resultados_Veedores_${fecha}.xlsx`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); URL.revokeObjectURL(url);
    } catch (e) { alert(' No se pudo descargar: ' + e.message); }
    finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-excel"></i> <span>Descargar Excel</span>'; }
    }
}

// ── CONFIGURACIÓN: JUNTAS CRUD ────────────────────
async function cargarJuntasConfig() {
    const tbody = document.getElementById('tablaJuntasConfig');
    if (!tbody) return;
    const dig = document.getElementById('configFiltroDignidad')?.value || '';

    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px;">
        <i class="fas fa-circle-notch fa-spin"></i> Cargando...
    </td></tr>`;

    try {
        let url = `${API}/admin/juntas`;
        if (dig) url += `?dignidad=${encodeURIComponent(dig)}`;
        const res  = await fetch(url, { headers: getHeaders() });
        const data = await res.json();

        tbody.innerHTML = data.length === 0
            ? `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px;">No hay juntas registradas</td></tr>`
            : data.map(j => {
                const digLabel = ({ALCALDE:'Alcalde',CONCEJALES_URBANOS:'Conc. Urbanos',CONCEJALES_RURALES:'Conc. Rurales',JUNTAS_PARROQUIALES:'Juntas Parroquiales'})[j.dignidad] || j.dignidad || 'Todas';
                return `<tr>
                    <td><strong>${j.parroquia}</strong></td>
                    <td>${j.zona}</td>
                    <td>${j.numero_junta}</td>
                    <td><span style="background:#ede9fe;color:#6d28d9;padding:2px 10px;border-radius:999px;font-size:0.75rem;font-weight:600;">${digLabel}</span></td>
                    <td>
                        <button class="btn-eliminar" onclick="eliminarJuntaConfig(${j.id},'${j.parroquia} ${j.zona} ${j.numero_junta}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:20px;"> Error de conexión</td></tr>`;
    }
}

async function agregarJuntaConfig() {
    const dignidad    = document.getElementById('configDignidad').value;
    const parroquia   = document.getElementById('configParroquia').value.trim();
    const zona        = document.getElementById('configZona').value.trim();
    const numeroJunta = document.getElementById('configNumeroJunta').value.trim();
    const msg         = document.getElementById('msgConfigJunta');

    msg.style.display = 'none';
    if (!parroquia || !zona || !numeroJunta) {
        msg.style.cssText = 'display:block;color:#b91c1c;';
        msg.textContent = 'Parroquia, zona y número de junta son requeridos.';
        return;
    }

    try {
        const res = await fetch(`${API}/admin/juntas`, {
            method: 'POST',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ parroquia, zona, numero_junta: numeroJunta, dignidad })
        });
        const data = await res.json();

        if (data.success) {
            msg.style.cssText = 'display:block;color:#065f46;';
            msg.textContent = ` Junta "${parroquia} · ${zona} · ${numeroJunta}" agregada.`;
            document.getElementById('configParroquia').value = '';
            document.getElementById('configZona').value = '';
            document.getElementById('configNumeroJunta').value = '';
            cargarJuntasConfig();
            cargarDatalists();
        } else {
            msg.style.cssText = 'display:block;color:#b91c1c;';
            msg.textContent = data.message || 'Error al agregar';
        }
    } catch (e) {
        msg.style.cssText = 'display:block;color:#b91c1c;';
        msg.textContent = ' Error de conexión.';
    }
}

async function eliminarJuntaConfig(id, nombre) {
    if (!confirm(`¿Eliminar la junta "${nombre}"?`)) return;
    try {
        const res  = await fetch(`${API}/admin/juntas/${id}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            cargarJuntasConfig();
            cargarDatalists();
        } else alert(' ' + (data.message || 'No se pudo eliminar'));
    } catch (e) { alert(' Error de red.'); }
}

async function cargarDatalists() {
    try {
        const res = await fetch(`${API}/admin/juntas`, { headers: getHeaders() });
        const data = await res.json();
        const parroquiasSet = new Set(data.map(j => j.parroquia));
        const zonasSet = new Set(data.map(j => j.zona));
        document.getElementById('listaParroquias').innerHTML = [...parroquiasSet].map(p => `<option value="${p}">`).join('');
        document.getElementById('listaZonas').innerHTML = [...zonasSet].map(z => `<option value="${z}">`).join('');
    } catch (e) { /* silencioso */ }
}

function animarContador(id, valorFinal) {
    const el = document.getElementById(id);
    if (!el) return;

    const target = Number(valorFinal) || 0;
    let inicio = 0;
    const timer = setInterval(() => {
        inicio += target / 50;
        if (inicio >= target) { el.textContent = target.toLocaleString(); clearInterval(timer); }
        else el.textContent = Math.floor(inicio).toLocaleString();
    }, 16);
}

function cerrarSesion() {
    if (!confirm('¿Desea cerrar la sesión?')) return;
    ['idUsuario','nombreUsuarioActivo','rolUsuario','sesionActiva'].forEach(k => localStorage.removeItem(k));
    window.location.href = '../acceso/acceso.html';
}

async function eliminarResultados(juntaId, nombre) {
    if (!confirm(`¿Seguro que deseas eliminar los resultados de:\n"${nombre}"?\n\nEsto permitirá que el veedor vuelva a ingresar los votos.`)) return;
    try {
        const res  = await fetch(`${API}/resultados/${juntaId}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            alert(' Resultados eliminados. El veedor puede volver a ingresar el acta.');
            cargarEstadoJuntas();
        } else {
            alert(' Error: ' + (data.message || 'No se pudo eliminar'));
        }
    } catch (e) {
        alert(' Error de conexión al eliminar resultados.');
    }
}

// ── CORRECCIÓN DE JUNTAS (superadmin) ─────────────────────────────────
const DIG_NOMBRES = {
    ALCALDE: 'Alcalde',
    CONCEJALES_URBANOS: 'Concejales Urbanos',
    CONCEJALES_RURALES: 'Concejales Rurales',
    JUNTAS_PARROQUIALES: 'Juntas Parroquiales'
};
let correccionActual = null;

function escAtr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

async function cargarCorreccionJuntas() {
    const tbody = document.getElementById('tablaCorreccion');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">'
        + '<i class="fas fa-circle-notch fa-spin"></i> Cargando...</td></tr>';
    cerrarCorreccion();

    try {
        const { parroquia, zona, dignidad } = getFiltros();
        const qs = `parroquia=${encodeURIComponent(parroquia)}&zona=${encodeURIComponent(zona)}&dignidad=${encodeURIComponent(dignidad)}`;
        const res = await fetch(`${API}/juntas-correccion?${qs}`, { headers: getHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'No se pudo cargar');

        tbody.innerHTML = data.juntas.length === 0
            ? '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">Sin juntas con acta para este filtro</td></tr>'
            : data.juntas.map(j => `
    <tr>
        <td style="font-weight:700;">${j.numero_junta}</td>
        <td>${j.parroquia}</td>
        <td>${j.zona}</td>
        <td>${DIG_NOMBRES[j.dignidad] || j.dignidad}</td>
        <td style="font-weight:700;">${Number(j.total_votos) || 0}</td>
        <td>${j.veedor || '—'}</td>
        <td style="text-align:center;">${j.foto
            ? '<i class="fas fa-camera" style="color:#2563eb;" title="Con foto"></i>'
            : '<i class="fas fa-camera" style="color:#cbd5e1;" title="Sin foto"></i>'}</td>
        <td><button class="btn-agregar" onclick="abrirCorreccion(${j.junta_id}, '${j.dignidad}')">
                <i class="fas fa-file-pen"></i> Revisar
            </button></td>
    </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ef4444;">'
            + 'Error al cargar: ' + escAtr(e.message) + '</td></tr>';
    }
}

async function abrirCorreccion(juntaId, dignidad) {
    try {
        const res = await fetch(
            `${API}/juntas-correccion/${juntaId}?dignidad=${encodeURIComponent(dignidad)}`,
            { headers: getHeaders() }
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'No se pudo cargar el acta');

        correccionActual = {
            junta_id: juntaId,
            dignidad,
            totalAnterior: data.filas.reduce((a, f) => a + (Number(f.votos) || 0), 0)
        };

        const wrap = document.getElementById('correccionFotoWrap');
        if (data.foto && data.foto.url) {
            wrap.innerHTML = `<img class="correccion-foto" src="${escAtr(data.foto.url)}?v=${Date.now()}"
                alt="Foto del acta" title="Clic para ver en tamaño completo"
                onclick="window.open(this.src, '_blank')">`;
            document.getElementById('correccionMeta').innerHTML =
                `Foto subida por <b>${escAtr(data.foto.veedor || '—')}</b> el ${data.foto.fecha_subida || ''}`;
        } else {
            wrap.innerHTML = `<div class="correccion-foto-sin"><i class="fas fa-camera"></i>Sin foto del acta</div>`;
            document.getElementById('correccionMeta').textContent =
                'Esta junta no tiene foto del acta registrada.';
        }

        const j = data.junta;
        document.getElementById('tituloCorreccion').innerHTML =
            `<i class="fas fa-file-pen"></i> ${j.parroquia} · ${j.zona} · Junta ${j.numero_junta} — ${DIG_NOMBRES[dignidad] || dignidad}`;

        const existentes = new Map(data.filas.map(f => [f.candidato, f]));
        const nombres = [];
        (data.candidatos || []).forEach(n => nombres.push(n));
        ['NULO', 'BLANCO'].forEach(n => { if (!nombres.includes(n)) nombres.push(n); });
        existentes.forEach((v, n) => { if (!nombres.includes(n)) nombres.push(n); });

        document.getElementById('tablaCorreccionForm').innerHTML = nombres.map(n => {
            const val = existentes.get(n);
            const etiqueta = n === 'NULO' ? '<b style="color:#dc2626;">Voto Nulo</b>'
                          : n === 'BLANCO' ? '<b style="color:#64748b;">Voto Blanco</b>'
                          : escAtr(n);
            return `
    <tr>
        <td>${etiqueta}</td>
        <td style="text-align:right;">
            <input type="text" class="votos-input"
                   data-candidato="${escAtr(n)}"
                   value="${val ? Math.max(0, Number(val.votos) || 0) : 0}"
                   inputmode="numeric" pattern="[0-9]*" maxlength="6"
                   oninput="actualizarTotalCorreccion()">
        </td>
    </tr>`;
        }).join('');

        actualizarTotalCorreccion();
        const panel = document.getElementById('panelCorreccionDetalle');
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        alert('❌ No se pudo abrir el acta: ' + e.message);
    }
}

function actualizarTotalCorreccion() {
    let t = 0;
    document.querySelectorAll('#tablaCorreccionForm .votos-input').forEach(i => {
        const limpio = String(i.value).replace(/[^0-9]/g, '');
        if (limpio !== i.value) i.value = limpio;
        const v = parseInt(limpio, 10);
        t += isNaN(v) ? 0 : v;
    });
    const el = document.getElementById('correccionTotal');
    if (el) el.textContent = t;
}

function cerrarCorreccion() {
    const panel = document.getElementById('panelCorreccionDetalle');
    if (panel) panel.style.display = 'none';
    correccionActual = null;
}

async function guardarCorreccion() {
    if (!correccionActual) return;

    const votos = [];
    document.querySelectorAll('#tablaCorreccionForm .votos-input').forEach(i => {
        votos.push({
            candidato: i.dataset.candidato,
            votos: Math.max(0, parseInt(i.value, 10) || 0)
        });
    });
    if (votos.length === 0) return;

    const nuevoTotal = votos.reduce((a, v) => a + v.votos, 0);
    if (!confirm(`¿Guardar la corrección del acta?\n\nTotal anterior: ${correccionActual.totalAnterior} votos\nTotal nuevo: ${nuevoTotal} votos`)) return;

    const btn = document.getElementById('btnGuardarCorreccion');
    btn.disabled = true;
    const { junta_id, dignidad } = correccionActual;
    try {
        const res = await fetch(`${API}/juntas-correccion/${junta_id}`, {
            method: 'PUT',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ dignidad, votos })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'No se pudo guardar');

        alert('✅ ' + (data.message || 'Acta corregida correctamente'));
        await cargarCorreccionJuntas();
        await abrirCorreccion(junta_id, dignidad);
    } catch (e) {
        alert('❌ ' + e.message);
    } finally {
        btn.disabled = false;
    }
}

// ── ASIGNACIÓN DE JUNTAS A VEEDORES ────────────────────────────────────
let asignVeedores = [], asignJuntas = [], asignActual = null;
let asignSel = new Set();

async function cargarAsignacionJuntas() {
    const tbody = document.getElementById('tablaAsignacion');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">'
        + '<i class="fas fa-circle-notch fa-spin"></i> Cargando...</td></tr>';
    cerrarAsignacion();

    try {
        const res = await fetch(`${API}/asignaciones`, { headers: getHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'No se pudo cargar');

        asignVeedores = data.veedores || [];
        asignJuntas   = data.juntas   || [];
        renderTablaAsignacion();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#ef4444;">'
            + 'Error al cargar: ' + escAtr(e.message) + '</td></tr>';
    }
}

function renderTablaAsignacion() {
    const tbody = document.getElementById('tablaAsignacion');
    if (!tbody) return;
    tbody.innerHTML = asignVeedores.length === 0
        ? '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Sin veedores registrados</td></tr>'
        : asignVeedores.map(v => `
    <tr>
        <td style="font-weight:700;">${escAtr(v.usuario)}</td>
        <td>${escAtr(v.cedula || '—')}</td>
        <td>${v.juntas.length === 0
            ? '<span class="asign-badge asign-badge--vacia">Sin asignar</span>'
            : `<span class="asign-badge">${v.juntas.length} junta(s)</span>`}</td>
        <td><button class="btn-agregar" onclick="abrirAsignacion(${Number(v.id)})">
                <i class="fas fa-user-check"></i> Asignar
            </button></td>
    </tr>`).join('');
}

function juntaEtiqueta(j) {
    const dig = j.dignidad ? ` — ${DIG_NOMBRES[j.dignidad] || j.dignidad}` : '';
    return `${j.parroquia} · ${j.zona} · Junta ${j.numero_junta}${dig}`;
}

function cargarOpcionesFiltrosAsign() {
    const dignidades = [...new Set(asignJuntas.map(j => j.dignidad).filter(Boolean))]
        .filter(d => !dignidadesHabilitadasSet || dignidadesHabilitadasSet.has(d))
        .sort((a, b) => (DIG_NOMBRES[a] || a).localeCompare(DIG_NOMBRES[b] || b));
    const parroquias = [...new Set(asignJuntas.map(j => j.parroquia))].sort();
    const zonas      = [...new Set(asignJuntas.map(j => j.zona))].sort();
    const selD = document.getElementById('asignFiltroDignidad');
    const selP = document.getElementById('asignFiltroParroquia');
    const selZ = document.getElementById('asignFiltroZona');
    const prevD = selD.value, prevP = selP.value, prevZ = selZ.value;
    selD.innerHTML = '<option value="todas">Todas las dignidades</option>'
        + dignidades.map(d => `<option value="${escAtr(d)}">${escAtr(DIG_NOMBRES[d] || d)}</option>`).join('');
    selP.innerHTML = '<option value="todas">Todas las parroquias</option>'
        + parroquias.map(p => `<option value="${escAtr(p)}">${escAtr(p)}</option>`).join('');
    selZ.innerHTML = '<option value="todas">Todas las zonas</option>'
        + zonas.map(z => `<option value="${escAtr(z)}">${escAtr(z)}</option>`).join('');
    if (dignidades.includes(prevD)) selD.value = prevD;
    if (parroquias.includes(prevP)) selP.value = prevP;
    if (zonas.includes(prevZ)) selZ.value = prevZ;
}

function juntasFiltradasAsign() {
    const d = document.getElementById('asignFiltroDignidad').value;
    const p = document.getElementById('asignFiltroParroquia').value;
    const z = document.getElementById('asignFiltroZona').value;
    return asignJuntas.filter(j =>
        (d === 'todas' || j.dignidad === d) &&
        (p === 'todas' || j.parroquia === p) &&
        (z === 'todas' || j.zona === z));
}

function abrirAsignacion(id) {
    const v = asignVeedores.find(x => Number(x.id) === Number(id));
    if (!v) return;
    asignActual = { id: v.id, usuario: v.usuario };
    asignSel = new Set((v.juntas || []).map(Number));

    document.getElementById('tituloAsignacion').innerHTML =
        `<i class="fas fa-user-check"></i> ${escAtr(v.usuario)} — seleccione la(s) junta(s) que registrará`;
    cargarOpcionesFiltrosAsign();
    renderJuntasAsignacion();

    const panel = document.getElementById('panelAsignacionDetalle');
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderJuntasAsignacion() {
    const cont = document.getElementById('listaJuntasAsignacion');
    if (!cont) return;
    const lista = juntasFiltradasAsign();
    cont.innerHTML = lista.length === 0
        ? '<p class="asign-vacio">Sin juntas para este filtro</p>'
        : lista.map(j => {
            const marcada = asignSel.has(Number(j.id));
            return `
        <label class="asign-junta-item${marcada ? ' seleccionada' : ''}" data-junta="${Number(j.id)}">
            <input type="checkbox" ${marcada ? 'checked' : ''}
                   onchange="toggleAsignJunta(${Number(j.id)}, this.checked)">
            <span class="asign-junta-text">
                <b>Junta ${escAtr(j.numero_junta)}</b>
                <span>${escAtr(j.parroquia)} · ${escAtr(j.zona)}</span>
                ${j.dignidad ? `<small>${DIG_NOMBRES[j.dignidad] || escAtr(j.dignidad)}</small>` : ''}
            </span>
        </label>`;
        }).join('');
    actualizarContadorAsign();
}

function toggleAsignJunta(juntaId, marcada) {
    if (marcada) asignSel.add(Number(juntaId));
    else asignSel.delete(Number(juntaId));
    const item = document.querySelector(`#listaJuntasAsignacion .asign-junta-item[data-junta="${juntaId}"]`);
    if (item) item.classList.toggle('seleccionada', marcada);
    actualizarContadorAsign();
}

function seleccionarJuntasFiltradas(marcar) {
    juntasFiltradasAsign().forEach(j => {
        if (marcar) asignSel.add(Number(j.id));
        else asignSel.delete(Number(j.id));
    });
    renderJuntasAsignacion();
}

function actualizarContadorAsign() {
    const el = document.getElementById('asignContador');
    if (el) el.textContent = `${asignSel.size} seleccionada(s)`;
}

function cerrarAsignacion() {
    const panel = document.getElementById('panelAsignacionDetalle');
    if (panel) panel.style.display = 'none';
    asignActual = null;
    asignSel = new Set();
}

async function guardarAsignacion() {
    if (!asignActual) return;
    const ids = [...asignSel];
    const donde = `¿Guardar la asignación de ${ids.length} junta(s) para "${asignActual.usuario}"?\n\n`
        + (ids.length
            ? ids.map(id => {
                const j = asignJuntas.find(x => Number(x.id) === Number(id));
                return j ? '• ' + juntaEtiqueta(j) : '';
              }).filter(Boolean).join('\n')
            : 'Sin juntas: el veedor no verá ninguna junta hasta que se le asigne.');
    if (!confirm(donde)) return;

    const btn = document.getElementById('btnGuardarAsignacion');
    btn.disabled = true;
    const { id } = asignActual;
    try {
        const res = await fetch(`${API}/asignaciones/${id}`, {
            method: 'PUT',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ juntas: ids })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'No se pudo guardar');
        alert('✅ ' + (data.message || 'Asignación guardada'));
        await cargarAsignacionJuntas();
    } catch (e) {
        alert('❌ ' + e.message);
    } finally {
        btn.disabled = false;
    }
}
