// js/sync-offline.js — Sincronización de cola offline (votos + fotos)
// Compartido por seleccion.html y votos.html.
// Envía cola_votos/cola_fotos al recuperar conexión, con reintentos automáticos.

(function () {
    const API = window.location.origin;

    function headersSync(extra = {}) {
        const token = localStorage.getItem('authToken');
        return { 'ngrok-skip-browser-warning': 'true', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    }

    let sincronizando = false;
    let avisoSesionExpirada = false;

    function leerCola(clave) {
        try { return JSON.parse(localStorage.getItem(clave) || '[]'); } catch { return []; }
    }

    function contarPendientes() {
        return leerCola('cola_votos').length + leerCola('cola_fotos').length;
    }

    function toast(html, color) {
        let el = document.getElementById('syncToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'syncToast';
            el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;'
                + 'background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:0.85rem;'
                + 'box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:92%;text-align:center;display:none;';
            document.body.appendChild(el);
        }
        el.innerHTML = html;
        el.style.borderLeft = `4px solid ${color || '#2563eb'}`;
        el.style.display = 'block';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.display = 'none'; }, 6000);
    }

    function avisarSesion() {
        if (!avisoSesionExpirada) {
            avisoSesionExpirada = true;
            toast('🔒 Sesión expirada: cierre sesión y vuelva a entrar para enviar las actas pendientes.', '#ef4444');
        }
    }

    async function sincronizarVotos() {
        const cola = leerCola('cola_votos');
        if (!cola.length) return { enviados: 0, yaRegistradas: 0 };

        const pendientes = [];
        let enviados = 0, yaRegistradas = 0, detener = false;

        for (const item of cola) {
            if (detener) { pendientes.push(item); continue; }
            try {
                const res = await fetch(`${API}/registrar-resultados`, {
                    method: 'POST',
                    headers: headersSync({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(item)
                });

                if (res.status === 401) {
                    pendientes.push(item);
                    avisarSesion();
                    detener = true;
                    continue;
                }

                const data = await res.json().catch(() => ({}));

                if (data.codigo === 'ACCESO_BLOQUEADO') {
                    localStorage.setItem('sistemaAccesoBloqueado', '1');
                    pendientes.push(item);
                    toast('🔒 El sistema está bloqueado. No se pueden sincronizar actas.', '#ef4444');
                    detener = true;
                    continue;
                }
                if (data.codigo === 'DIGNIDAD_DESHABILITADA') {
                    pendientes.push(item);
                    toast('⚠️ ' + (data.message || 'Dignidad deshabilitada.'), '#d97706');
                    detener = true;
                    continue;
                }

                const yaRegistrada = data.success === true || data.yaRegistrada === true ||
                    /ya tiene resultados|ya fue registrada/i.test(data.message || '');

                if (yaRegistrada) {
                    enviados++;
                    if (data.yaRegistrada === true && data.success !== true) yaRegistradas++;
                } else {
                    pendientes.push(item);
                }
            } catch (e) {
                pendientes.push(item);
            }
        }

        localStorage.setItem('cola_votos', JSON.stringify(pendientes));
        return { enviados, yaRegistradas };
    }

    async function sincronizarFotos() {
        const cola = leerCola('cola_fotos');
        if (!cola.length) return { enviadas: 0 };

        const pendientes = [];
        let enviadas = 0, detener = false;

        for (const item of cola) {
            if (detener) { pendientes.push(item); continue; }
            try {
                const res     = await fetch(item.base64);
                const blob    = await res.blob();
                const ext     = (item.nombre || '').split('.').pop() || 'jpg';
                const archivo = new File([blob], `acta_${item.junta_id}.${ext}`, { type: blob.type });

                const formData = new FormData();
                formData.append('foto',      archivo);
                formData.append('junta_id',  item.junta_id);
                formData.append('id_veedor', item.id_veedor);

                const resFoto = await fetch(`${API}/subir-foto`, {
                    method: 'POST',
                    headers: headersSync(),
                    body: formData
                });

                if (resFoto.status === 401) {
                    pendientes.push(item);
                    avisarSesion();
                    detener = true;
                    continue;
                }

                const dataFoto = await resFoto.json().catch(() => ({}));

                if (dataFoto.codigo === 'ACCESO_BLOQUEADO') {
                    localStorage.setItem('sistemaAccesoBloqueado', '1');
                    pendientes.push(item);
                    toast('🔒 El sistema está bloqueado. No se pueden subir fotos.', '#ef4444');
                    detener = true;
                    continue;
                }

                if (dataFoto.success) enviadas++;
                else pendientes.push(item);
            } catch (e) {
                pendientes.push(item);
            }
        }

        localStorage.setItem('cola_fotos', JSON.stringify(pendientes));
        return { enviadas };
    }

    async function sincronizarColaVotos() {
        const rVotos = await sincronizarVotos();
        const rFotos = await sincronizarFotos();
        return { ...rVotos, ...rFotos };
    }

    async function intentarSincronizar() {
        if (sincronizando || !navigator.onLine || contarPendientes() === 0)
            return { enviados: 0, yaRegistradas: 0, enviadas: 0 };

        sincronizando = true;
        let r = { enviados: 0, yaRegistradas: 0, enviadas: 0 };
        try {
            r = await sincronizarColaVotos();
        } finally {
            sincronizando = false;
        }

        const actas = r.enviados || 0;
        const fotos = r.enviadas || 0;
        if (actas > 0 || fotos > 0) {
            const partes = [];
            if (actas > 0) partes.push(`${actas} acta(s)`);
            if (fotos > 0) partes.push(`${fotos} foto(s)`);
            let extra = '';
            if (r.yaRegistradas > 0) extra = ` (${r.yaRegistradas} ya estaba(n) en el servidor)`;
            toast(`✅ Enviado: ${partes.join(' y ')}${extra}`, '#059669');
        }

        window.dispatchEvent(new CustomEvent('cola-sincronizada', { detail: r }));
        return r;
    }

    // API global (compatibilidad con el código existente)
    window.sincronizarColaVotos = sincronizarColaVotos;
    window.sincronizarVotos     = sincronizarVotos;
    window.sincronizarFotos     = sincronizarFotos;
    window.intentarSincronizar  = intentarSincronizar;

    // Disparadores: al recuperar conexión, al cargar la página y cada 30 s
    window.addEventListener('online',  () => setTimeout(intentarSincronizar, 800));
    window.addEventListener('offline', () => { avisoSesionExpirada = false; });
    window.addEventListener('DOMContentLoaded', () => setTimeout(intentarSincronizar, 1200));
    setInterval(() => { intentarSincronizar(); }, 30000);

    // Refrescar el badge de pendientes de la página actual
    window.addEventListener('cola-sincronizada', () => {
        if (typeof actualizarBadgePendientes === 'function') actualizarBadgePendientes();
    });
})();
