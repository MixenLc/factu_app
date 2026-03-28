const { ipcRenderer } = require('electron');

// --- Variables globales ---
let currentFilePath = null;
let perfiles = JSON.parse(localStorage.getItem('factu_perfiles')) || [];

// --- LÓGICA DE NUMERACIÓN AUTOMÁTICA ---
function obtenerSiguienteNumero(tipo) {
    const anioActual = new Date().getFullYear();
    const ultimoNum = parseInt(localStorage.getItem(`last_num_${tipo}`)) || 0;
    const ultimoAnio = parseInt(localStorage.getItem(`last_anio_${tipo}`)) || anioActual;

    let siguienteCorrelativo;
    if (anioActual > ultimoAnio) {
        siguienteCorrelativo = 1; // Reiniciar si es un año nuevo
    } else {
        siguienteCorrelativo = ultimoNum + 1;
    }

    const pad = siguienteCorrelativo.toString().padStart(3, '0');
    return (tipo === 'FACTURA') ? `F-${anioActual}-${pad}` : `${anioActual}-${pad}`;
}

function registrarNumeroUsado() {
    const tipo = document.getElementById('tituloDoc').innerText; 
    const numeroStr = document.getElementById('numDoc').value;
    const anioActual = new Date().getFullYear();

    const partes = numeroStr.split('-');
    const ultimoId = parseInt(partes[partes.length - 1]);

    if (!isNaN(ultimoId)) {
        localStorage.setItem(`last_num_${tipo}`, ultimoId);
        localStorage.setItem(`last_anio_${tipo}`, anioActual);
    }
}

// --- GESTIÓN DE FOCO E INTERFAZ ---
function refreshEditableFocus() {
    ipcRenderer.send('request-focus');
    setTimeout(() => {
        const activeElement = document.activeElement;
        const temp = document.createElement('input');
        
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        temp.style.pointerEvents = 'none';
        
        document.body.appendChild(temp);
        temp.focus();

        setTimeout(() => {
            temp.remove();
            if (activeElement && (activeElement.isContentEditable || ['TEXTAREA', 'INPUT'].includes(activeElement.tagName))) {
                activeElement.focus();
            } else {
                const firstEditable = document.querySelector('[contenteditable="true"], textarea, input:not([type="hidden"])');
                if (firstEditable) firstEditable.focus();
            }
        }, 30);
    }, 150);
}

function showModal(message, type = 'input', defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modalOverlay');
        const messageEl = document.getElementById('modalMessage');
        const inputEl = document.getElementById('modalInput');
        const okBtn = document.getElementById('modalOk');
        const cancelBtn = document.getElementById('modalCancel');

        if (!overlay) {
            console.error('Error: modalOverlay no encontrado');
            resolve(null);
            return;
        }

        messageEl.innerText = message;
        inputEl.value = defaultValue;
        inputEl.style.display = (type === 'input') ? 'block' : 'none';
        cancelBtn.style.display = (type === 'alert') ? 'none' : 'inline-block';
        
        overlay.style.display = 'flex';
        
        if (type === 'input') {
            inputEl.focus();
            inputEl.select();
        } else {
            okBtn.focus();
        }

        const onOk = () => {
            const val = (type === 'input') ? inputEl.value : true;
            cleanup(val);
        };
        const onCancel = () => cleanup(type === 'input' ? null : false);
        const onEnter = (e) => { if (e.key === 'Enter') onOk(); };

        const cleanup = (result) => {
            overlay.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            inputEl.removeEventListener('keypress', onEnter);
            resolve(result);
            refreshEditableFocus();
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        inputEl.addEventListener('keypress', onEnter);
    });
}

// --- PERFILES ---
function actualizarSelector() {
    const select = document.getElementById('selectPerfil');
    if (!select) return;
    select.innerHTML = '<option value="">Seleccionar Perfil...</option>';
    perfiles.forEach((p, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.innerText = p.nombre;
        select.appendChild(opt);
    });
}

function limpiarTelefono() {
    const span = document.getElementById('emisorTelefono');
    let value = span.innerText;
    const cleaned = value.replace(/[^\d+]/g, '');
    let hasPlus = cleaned.startsWith('+');
    let digits = cleaned.replace(/\+/g, '');
    let result = (hasPlus ? '+' : '') + digits;
    
    if (result !== value) {
        span.innerText = result;
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(span);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

window.crearNuevoPerfil = async function() {
    const nombre = await showModal("Nombre Empresa/Autónomo:", 'input');
    if (!nombre) return;
    const dni = await showModal("DNI/CIF:", 'input');
    if (!dni) return;
    const direccion = await showModal("Dirección:", 'input');
    if (!direccion) return;
    let telefono = await showModal("Teléfono (solo números y +):", 'input');
    if (!telefono) return;

    telefono = telefono.replace(/[^\d+]/g, '');
    if (telefono && !telefono.startsWith('+')) telefono = '+' + telefono;

    perfiles.push({ nombre, dni, direccion, telefono });
    localStorage.setItem('factu_perfiles', JSON.stringify(perfiles));
    actualizarSelector();
    
    const select = document.getElementById('selectPerfil');
    select.value = perfiles.length - 1;
    select.dispatchEvent(new Event('change'));
};

window.borrarPerfil = async function() {
    const select = document.getElementById('selectPerfil');
    const selectedIndex = select.value;
    if (selectedIndex === "") {
        await showModal("Selecciona un perfil para borrar.", 'alert');
        return;
    }
    const confirmar = await showModal(`¿Eliminar el perfil "${perfiles[selectedIndex].nombre}"?`, 'confirm');
    if (confirmar) {
        perfiles.splice(selectedIndex, 1);
        localStorage.setItem('factu_perfiles', JSON.stringify(perfiles));
        actualizarSelector();
        select.value = "";
    }
};

// --- TABLA Y CÁLCULOS ---
window.añadirFila = function(desc = "", precio = 0) {
    const tbody = document.getElementById('cuerpoTabla');
    const tr = document.createElement('tr');

    const tdDesc = document.createElement('td');
    const textarea = document.createElement('textarea');
    textarea.value = desc;
    textarea.style.overflow = 'hidden';
    textarea.style.resize = 'none';
    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });
    tdDesc.appendChild(textarea);

    const tdPrecio = document.createElement('td');
    const inputPrecio = document.createElement('input');
    inputPrecio.type = 'number';
    inputPrecio.className = 'monto';
    inputPrecio.value = precio;
    inputPrecio.step = '0.01';
    inputPrecio.addEventListener('input', () => calcularTotales());
    tdPrecio.appendChild(inputPrecio);

    const tdEliminar = document.createElement('td');
    tdEliminar.className = 'no-print';
    const btnEliminar = document.createElement('button');
    btnEliminar.textContent = '✕';
    btnEliminar.onclick = function() {
        tr.remove();
        calcularTotales();
        refreshEditableFocus();
    };
    tdEliminar.appendChild(btnEliminar);

    tr.appendChild(tdDesc);
    tr.appendChild(tdPrecio);
    tr.appendChild(tdEliminar);
    tbody.appendChild(tr);

    setTimeout(() => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }, 0);

    calcularTotales();
    refreshEditableFocus();
};

window.calcularTotales = function() {
    let sub = 0;
    document.querySelectorAll('.monto').forEach(i => sub += parseFloat(i.value) || 0);
    const ivaPct = parseFloat(document.getElementById('ivaSelect').value);
    const ivaCuota = sub * (ivaPct / 100);
    
    document.getElementById('subtotal').innerText = sub.toFixed(2);
    document.getElementById('ivaCuota').innerText = ivaCuota.toFixed(2);
    document.getElementById('totalFinal').innerText = (sub + ivaCuota).toFixed(2);
};

// --- PROYECTO ---
window.nuevoProyecto = async function(arranqueSilencioso = false) {
    // Si NO es un arranque silencioso, preguntamos. Si lo es, pasamos directo.
    let confirmar = arranqueSilencioso ? true : await showModal('¿Crear un nuevo proyecto? Se perderán los cambios no guardados.', 'confirm');
    
    if (confirmar) {
        document.getElementById('tituloDoc').innerText = "PRESUPUESTO";
        document.getElementById('emisorNombre').innerText = "NOMBRE EMPRESA";
        document.getElementById('emisorDNI').innerText = "00000000X";
        document.getElementById('emisorDireccion').innerText = "Calle Falsa 123, Ciudad";
        document.getElementById('emisorTelefono').innerText = "+34 600 000 000";
        document.getElementById('datosCliente').innerHTML = "Nombre y datos del cliente...";
        document.getElementById('obsText').value = "";
        document.getElementById('ivaSelect').value = "21";
        
        const tbody = document.getElementById('cuerpoTabla');
        tbody.innerHTML = "";
        añadirFila();
        
        const hoy = new Date().toISOString().split('T')[0];
        document.getElementById('fechaDoc').value = hoy;
        
        // El autoincremento funciona aquí
        document.getElementById('numDoc').value = obtenerSiguienteNumero('PRESUPUESTO');
        
        currentFilePath = null;
        calcularTotales();
        limpiarTelefono();
        
        // Solo robamos el foco si el usuario hizo clic en el botón, 
        // no queremos que salte al arrancar la app
        if (!arranqueSilencioso) {
            refreshEditableFocus();
        }
    }
};

window.convertirAFactura = async function() {
    const confirmar = await showModal('¿Convertir a factura? Se creará un documento nuevo.', 'confirm');
    if (!confirmar) return;

    document.getElementById('tituloDoc').innerText = "FACTURA";
    
    // --- AQUÍ ESTÁ EL AUTOINCREMENTO ---
    document.getElementById('numDoc').value = obtenerSiguienteNumero('FACTURA');
    
    currentFilePath = null;
    calcularTotales();
    refreshEditableFocus();
};

// --- GUARDAR Y CARGAR ---
window.guardarEditable = function() {
    const items = [];
    document.querySelectorAll('#cuerpoTabla tr').forEach(tr => {
        const textarea = tr.querySelector('textarea');
        const input = tr.querySelector('input');
        if (textarea && input) {
            items.push({ d: textarea.value, p: input.value });
        }
    });
    
    const data = {
        tipo: document.getElementById('tituloDoc').innerText,
        nombre: document.getElementById('emisorNombre').innerText,
        dni: document.getElementById('emisorDNI').innerText,
        direccion: document.getElementById('emisorDireccion').innerText,
        telefono: document.getElementById('emisorTelefono').innerText,
        num: document.getElementById('numDoc').value,
        fecha: document.getElementById('fechaDoc').value,
        cliente: document.getElementById('datosCliente').innerHTML,
        iva: document.getElementById('ivaSelect').value,
        obs: document.getElementById('obsText').value,
        items: items
    };
    
    let defaultPath = currentFilePath || 'proyecto.json';
    ipcRenderer.send('guardar-json', { data, defaultPath });
    
    // Guardamos el número en el historial
    registrarNumeroUsado();
    setTimeout(refreshEditableFocus, 500);
};

window.dispararCarga = function() {
    document.getElementById('fileInput').click();
};

document.getElementById('fileInput').onchange = function(e) {
    const file = e.target.files[0];
    if (!file) {
        refreshEditableFocus();
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(ev) {
        try {
            const d = JSON.parse(ev.target.result);
            document.getElementById('tituloDoc').innerText = d.tipo || "PRESUPUESTO";
            document.getElementById('emisorNombre').innerText = d.nombre || "NOMBRE EMPRESA";
            document.getElementById('emisorDNI').innerText = d.dni || "00000000X";
            document.getElementById('emisorDireccion').innerText = d.direccion || "";
            document.getElementById('emisorTelefono').innerText = d.telefono || "";
            
            document.getElementById('numDoc').value = d.num || "";
            document.getElementById('fechaDoc').value = d.fecha || "";
            document.getElementById('datosCliente').innerHTML = d.cliente || "...";
            document.getElementById('ivaSelect').value = d.iva || "21";
            document.getElementById('obsText').value = d.obs || "";
            
            const tbody = document.getElementById('cuerpoTabla');
            tbody.innerHTML = "";
            if (d.items && d.items.length > 0) {
                d.items.forEach(item => añadirFila(item.d, parseFloat(item.p) || 0));
            } else {
                añadirFila();
            }
            
            calcularTotales();
            currentFilePath = file.path;
            limpiarTelefono();
            await showModal('Proyecto cargado correctamente', 'alert');
        } catch (error) {
            console.error('Error:', error);
            await showModal('Error al cargar el archivo.', 'alert');
        }
    };
    reader.readAsText(file);
};

window.exportarPDF = function() {
    let suggestedName = currentFilePath ? currentFilePath.replace(/\.json$/i, '.pdf') : 'documento.pdf';
    ipcRenderer.send('exportar-pdf', suggestedName);
    
    // Guardamos el número en el historial
    registrarNumeroUsado();
    setTimeout(refreshEditableFocus, 1000);
};

// --- EVENTOS E INICIALIZACIÓN ---
document.getElementById('selectPerfil').onchange = function(e) {
    const p = perfiles[e.target.value];
    if (p) {
        document.getElementById('emisorNombre').innerText = p.nombre;
        document.getElementById('emisorDNI').innerText = p.dni;
        document.getElementById('emisorDireccion').innerText = p.direccion;
        document.getElementById('emisorTelefono').innerText = p.telefono;
        limpiarTelefono();
        refreshEditableFocus();
    }
};

document.getElementById('emisorTelefono').addEventListener('input', limpiarTelefono);

// Autoajuste inicial de textareas
document.querySelectorAll('textarea').forEach(textarea => {
    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });
});

// Arrancar
actualizarSelector();
nuevoProyecto(true); // true para arranque silencioso sin preguntar