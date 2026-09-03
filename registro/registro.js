const API = window.location.origin;

function getHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return { 'ngrok-skip-browser-warning': 'true', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

document.getElementById('formRegistro').addEventListener('submit', async (e) => {
    e.preventDefault();

    const cedula   = document.getElementById('cedula').value.trim();
    const usuario  = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value.trim();
    const rol      = document.getElementById('rol').value;
    const btn      = document.getElementById('btnRegistrar');
    const msgOk    = document.getElementById('mensajeOk');
    const msgErr   = document.getElementById('mensajeError');

    msgOk.style.display  = 'none';
    msgErr.style.display = 'none';

    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Registrando...';

    try {
        const res  = await fetch(`${API}/registrar`, {
            method: 'POST',
            headers: getHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ cedula, usuario, password, rol })
        });
        const data = await res.json();

        if (data.success) {
            msgOk.textContent   = ` Usuario "${usuario}" registrado correctamente como ${rol}.`;
            msgOk.style.display = 'block';
            document.getElementById('formRegistro').reset();
        } else {
            if (data.codigo === 'ACCESO_BLOQUEADO') {
                msgErr.textContent = ' ' + (data.message || 'El sistema está bloqueado. No se pueden crear usuarios.');
            } else {
                msgErr.textContent = data.message || 'Error al registrar';
            }
            msgErr.style.display = 'block';
        }
    } catch (err) {
        msgErr.textContent   = ' Error de conexión con el servidor.';
        msgErr.style.display = 'block';
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Crear Usuario';
    }
});
