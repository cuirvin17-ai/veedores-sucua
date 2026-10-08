const API = window.location.origin;
let deferredPrompt = null;

function getHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return {
        'ngrok-skip-browser-warning': 'true',
        ...extra,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('../sw.js');
            console.log(' Service Worker activo:', reg.scope);
            reg.update();
        } catch (err) {
            console.error(' Error SW:', err);
        }
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
    localStorage.setItem('pwaInstalada', 'true');
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'none';
});

async function checkConexion() {
    const msg = document.getElementById('offline-msg');
    if (!msg) return;
    try {
        await fetch(`${API}/estado-acceso`, { method: 'HEAD', headers: { 'ngrok-skip-browser-warning': 'true' } });
        msg.style.display = 'none';
    } catch {
        msg.style.display = 'block';
    }
}
window.addEventListener('online',  () => setTimeout(checkConexion, 500));
window.addEventListener('offline', () => setTimeout(checkConexion, 500));

document.addEventListener('DOMContentLoaded', () => {
    checkConexion();
    verificarAvisoAccesoBloqueado();

    document.getElementById('formLogin')
        .addEventListener('submit', validarIngreso);

    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted')
                alert(' App instalada! Puedes usarla sin conexión.');
            deferredPrompt = null;
            installBtn.style.display = 'none';
        });
    }
});

function codificar(pass) {
    return btoa(unescape(encodeURIComponent(pass)));
}

async function validarIngreso(e) {
    e.preventDefault();

    const usuario  = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value.trim();
    const btn      = document.getElementById('btnLogin');
    const msgError = document.getElementById('mensajeError');

    msgError.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verificando...';

    if (navigator.onLine) {
        try {
            const res  = await fetch(`${API}/login`, {
                method: 'POST',
                headers: getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ usuario, password })
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (data.codigo === 'ACCESO_BLOQUEADO') {
                    localStorage.setItem('sistemaAccesoBloqueado', '1');
                    mostrarAvisoBloqueo(true);
                }
                mostrarError(data.message || 'Usuario o contraseña incorrectos');
                return;
            }

            if (data.success) {
                localStorage.setItem('idUsuario',           data.user.id);
                localStorage.setItem('nombreUsuarioActivo', data.user.usuario);
                localStorage.setItem('rolUsuario',          data.user.rol);
                localStorage.setItem('cedulaUsuario',       data.user.cedula || '');
                localStorage.setItem('sesionActiva',        'true');
                if (data.token) localStorage.setItem('authToken', data.token);
                else localStorage.removeItem('authToken');
                localStorage.removeItem('sistemaAccesoBloqueado');

                guardarCredencialesOffline(usuario, password, data.user);
                console.log(' Login online exitoso — token guardado');

                // Enviar actas pendientes al momento de ingresar
                if (typeof intentarSincronizar === 'function') {
                    if (typeof resetAvisoSesion === 'function') resetAvisoSesion();
                    if (typeof colaPendientes === 'function' && colaPendientes() > 0) {
                        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Enviando actas pendientes...';
                        await Promise.race([
                            intentarSincronizar(),
                            new Promise(r => setTimeout(r, 8000))
                        ]);
                    }
                }

                redirigir(data.user.rol);
            } else {
                mostrarError(data.message || 'Usuario o contraseña incorrectos');
            }
        } catch (err) {
            console.warn('Red falló, intentando offline...', err.message);
            await loginOffline(usuario, password, msgError);
        }
    } else {
        await loginOffline(usuario, password, msgError);
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Ingresar';
}

function guardarCredencialesOffline(usuario, password, user) {
    const key = `veedor_${usuario.trim().toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify({
        passEncoded: codificar(password),
        id:     user.id,
        rol:    user.rol,
        cedula: user.cedula || '',
        guardadoEn: new Date().toISOString()
    }));
}

async function loginOffline(usuario, password, msgError) {
    const key    = `veedor_${usuario.trim().toLowerCase()}`;
    const stored = localStorage.getItem(key);

    if (!stored) {
        mostrarError('Sin conexión y sin sesión guardada. Necesitas internet para el primer ingreso.');
        return;
    }

    const datos = JSON.parse(stored);
    if (localStorage.getItem('sistemaAccesoBloqueado') === '1' && datos.rol !== 'superadmin') {
        mostrarError(' El sistema está bloqueado. No puede ingresar en este momento.');
        return;
    }
    if (codificar(password) !== datos.passEncoded) {
        mostrarError('Contraseña incorrecta.');
        return;
    }

    localStorage.setItem('idUsuario',           datos.id);
    localStorage.setItem('nombreUsuarioActivo', usuario);
    localStorage.setItem('rolUsuario',          datos.rol);
    localStorage.setItem('cedulaUsuario',       datos.cedula || '');
    localStorage.setItem('sesionActiva',        'true');

    console.log(' Login OFFLINE exitoso:', usuario);

    const msg = document.getElementById('offline-msg');
    if (msg) { msg.style.display = 'block'; msg.textContent = ' Modo Offline — Trabajando con datos guardados'; }

    setTimeout(() => redirigir(datos.rol), 800);
}

function redirigir(rol) {
    if (rol === 'admin' || rol === 'superadmin') {
        window.location.href = '../administrador/admin.html';
    } else {
        window.location.href = '../dignidad/dignidad.html';
    }
}

function mostrarError(msg) {
    const el = document.getElementById('mensajeError');
    el.textContent    = msg;
    el.style.display  = 'block';
}

async function verificarAvisoAccesoBloqueado() {
    if (!navigator.onLine) {
        mostrarAvisoBloqueo(localStorage.getItem('sistemaAccesoBloqueado') === '1');
        return;
    }
    try {
        const res  = await fetch(`${API}/estado-acceso`, {
            headers: getHeaders()
        });
        const data = await res.json();
        if (data.success) {
            if (data.bloqueado) localStorage.setItem('sistemaAccesoBloqueado', '1');
            else localStorage.removeItem('sistemaAccesoBloqueado');
            mostrarAvisoBloqueo(!!data.bloqueado);
        }
    } catch (e) {
        /* sin conexión al servidor */
    }
}

function mostrarAvisoBloqueo(activo) {
    let el = document.getElementById('aviso-acceso-bloqueado');
    if (!el) {
        el = document.createElement('div');
        el.id = 'aviso-acceso-bloqueado';
        el.style.cssText = 'display:none;margin-bottom:14px;padding:12px 14px;background:#fef3c7;border:1.5px solid #f59e0b;border-radius:12px;color:#92400e;font-size:0.85rem;font-weight:600;text-align:center;line-height:1.4;';
        const card = document.querySelector('.login-card');
        if (card) card.insertBefore(el, card.firstChild);
    }
    el.style.display = activo ? 'block' : 'none';
    if (activo) {
        el.innerHTML = ' Sistema bloqueado temporalmente. Solo el superadministrador puede ingresar.';
    }
}

function togglePass() {
    const inp  = document.getElementById('password');
    const icon = document.getElementById('iconoOjo');
    if (inp.type === 'password') {
        inp.type = 'text'; icon.className = 'fas fa-eye-slash';
    } else {
        inp.type = 'password'; icon.className = 'fas fa-eye';
    }
}
