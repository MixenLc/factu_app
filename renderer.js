const { ipcRenderer } = require('electron');

// --- Variables globales ---
let currentFilePath = null;
let perfiles = JSON.parse(localStorage.getItem('factu_perfiles')) || [];

// --- 1. LÓGICA DE NUMERACIÓN INTELIGENTE (Año + Correlativo) ---
function obtenerSiguienteNumero(tipo) {
    const anioActual = new Date().getFullYear();
    // Claves: last_num_PRESUPUESTO, last_num_FACTURA
    const ultimoNum = parseInt(localStorage.getItem(`last_num_${tipo}`)) || 0;
    const ultimoAnio = parseInt(localStorage.getItem(`last_anio_${tipo}`)) || anioActual;

    let siguienteCorrelativo;
    if (anioActual > ultimoAnio) {
        siguienteCorrelativo = 1; // Reiniciar si ha cambiado el año
    } else {
        siguienteCorrelativo = ultimoNum + 1;
    }

    // Formateamos a 4 dígitos (0001)
    const pad = siguienteCorrelativo.toString().padStart(4, '0');
    return (tipo === 'FACTURA') ? `F-${anioActual}-${pad}` : `${anioActual}-${pad}`;
}

// Guarda el número en el historial solo cuando se confirma el documento
function registrarNumeroUsado() {
    const tipo = document.getElementById('tituloDoc').innerText; // "PRESUPUESTO" o "FACTURA"
    const numeroStr = document.getElementById('numDoc').value;
    const anioActual = new Date().getFullYear();

    // Extraemos el último bloque numérico (el correlativo)
    const partes = numeroStr.split('-');
    const ultimoId = parseInt(partes[partes.length - 1]);

    if (!isNaN(ultimoId)) {
        const guardado = parseInt(localStorage.getItem(`last_num_${tipo}`)) || 0;
        // Solo actualizamos si el número usado es igual o mayor al actual
        if (ultimoId >= guardado) {
            localStorage.setItem(`last_num_${tipo}`, ultimoId);
            localStorage.setItem(`last_anio_${tipo}`, anioActual);
        }
    }
}

// --- 2. VALIDACIONES Y FORMATO ---
function validarTelefono(e) {
    const el = e.target;
    let value = el.innerText;
    // Permite solo números, espacios y comas (Punto 1 de tus cambios)
    const cleaned = value.replace(/[^\d\s,]/g, '');
    
    if (cleaned !== value) {
        el.innerText = cleaned;
        // Reposicionar el cursor al final
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function ajustarTextArea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

// --- 3. GESTIÓN DE INTERFAZ (Modales y Foco) ---
function refreshEditableFocus() {
    ipcRenderer.send('request-focus');
    setTimeout(() => {
        const activeElement = document.activeElement;
        const temp = document.createElement('input');
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.focus();

        setTimeout(() => {
            temp.remove();
            if (activeElement && (activeElement.isContentEditable || ['TEXTAREA', 'INPUT'].includes(activeElement.tagName))) {
                activeElement.focus();
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

        messageEl.innerText = message;
        inputEl.value = defaultValue;
        inputEl.style.display = (type === 'input') ? 'block' : 'none';
        cancelBtn.style.display = (type === 'alert') ? 'none' : 'inline-block';
        overlay.style.display = 'flex';
        
        if (type === 'input') { inputEl.focus(); inputEl.select(); } else { okBtn.focus(); }

        const onOk = () => { const val = (type === 'input') ? inputEl.value : true; cleanup(val); };
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

// --- 4. PERFILES DE EMPRESA ---
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

window.crearNuevoPerfil = async function() {
    const nombre = await showModal("Nombre Empresa/Autónomo:", 'input');
    if (!nombre) return;
    const dni = await showModal("DNI/CIF:", 'input');
    if (!dni) return;
    const direccion = await showModal("Dirección:", 'input');
    if (!direccion) return;
    const telefono = await showModal("Teléfono:", 'input');

    perfiles.push({ nombre, dni, direccion, telefono });
    localStorage.setItem('factu_perfiles', JSON.stringify(perfiles));
    actualizarSelector();
    
    const select = document.getElementById('selectPerfil');
    select.value = perfiles.length - 1;
    select.dispatchEvent(new Event('change'));
};

window.borrarPerfil = async function() {
    const select = document.getElementById('selectPerfil');
    const index = select.value;
    if (index === "") return;
    const confirmar = await showModal(`¿Eliminar el perfil "${perfiles[index].nombre}"?`, 'confirm');
    if (confirmar) {
        perfiles.splice(index, 1);
        localStorage.setItem('factu_perfiles', JSON.stringify(perfiles));
        actualizarSelector();
    }
};

// --- 5. TABLA DE CONCEPTOS ---
window.añadirFila = function(desc = "", precio = 0) {
    const tbody = document.getElementById('cuerpoTabla');
    const tr = document.createElement('tr');

    const tdDesc = document.createElement('td');
    const textarea = document.createElement('textarea');
    textarea.value = desc;
    textarea.placeholder = "Descripción del servicio...";
    textarea.style.resize = 'none';
    textarea.style.overflow = 'hidden';
    textarea.addEventListener('input', function() { ajustarTextArea(this); });
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
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.onclick = () => { tr.remove(); calcularTotales(); refreshEditableFocus(); };
    tdEliminar.appendChild(btn);

    tr.appendChild(tdDesc); tr.appendChild(tdPrecio); tr.appendChild(tdEliminar);
    tbody.appendChild(tr);

    setTimeout(() => ajustarTextArea(textarea), 0);
    calcularTotales();
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

// --- 6. CICLO DE VIDA DEL PROYECTO ---
window.nuevoProyecto = async function(arranqueSilencioso = false) {
    let confirmar = arranqueSilencioso ? true : await showModal('¿Nuevo proyecto? Se vaciarán los datos actuales.', 'confirm');
    
    if (confirmar) {
        document.getElementById('tituloDoc').innerText = "PRESUPUESTO";
        
        // Limpiamos campos de cliente (Punto 2 de tus cambios)
        document.getElementById('clienteNombre').innerText = "";
        document.getElementById('clienteDNI').innerText = "";
        document.getElementById('clienteDireccion').innerText = "";
        document.getElementById('clienteTelefono').innerText = "";
        
        document.getElementById('obsText').value = "";
        ajustarTextArea(document.getElementById('obsText'));

        const tbody = document.getElementById('cuerpoTabla');
        tbody.innerHTML = "";
        añadirFila();
        
        document.getElementById('fechaDoc').value = new Date().toISOString().split('T')[0];
        document.getElementById('numDoc').value = obtenerSiguienteNumero('PRESUPUESTO');
        
        currentFilePath = null;
        calcularTotales();
        if (!arranqueSilencioso) refreshEditableFocus();
    }
};

window.convertirAFactura = async function() {
    const confirmar = await showModal('¿Convertir en Factura?', 'confirm');
    if (confirmar) {
        document.getElementById('tituloDoc').innerText = "FACTURA";
        document.getElementById('numDoc').value = obtenerSiguienteNumero('FACTURA');
        refreshEditableFocus();
    }
};

// --- 7. GUARDAR Y EXPORTAR ---
window.guardarEditable = function() {
    const items = [];
    document.querySelectorAll('#cuerpoTabla tr').forEach(tr => {
        const t = tr.querySelector('textarea');
        const i = tr.querySelector('input');
        if (t && i) items.push({ d: t.value, p: i.value });
    });

    const data = {
        tipo: document.getElementById('tituloDoc').innerText,
        nombre: document.getElementById('emisorNombre').innerText,
        dni: document.getElementById('emisorDNI').innerText,
        direccion: document.getElementById('emisorDireccion').innerText,
        telefono: document.getElementById('emisorTelefono').innerText,
        num: document.getElementById('numDoc').value,
        fecha: document.getElementById('fechaDoc').value,
        cNombre: document.getElementById('clienteNombre').innerText,
        cDni: document.getElementById('clienteDNI').innerText,
        cDir: document.getElementById('clienteDireccion').innerText,
        cTel: document.getElementById('clienteTelefono').innerText,
        iva: document.getElementById('ivaSelect').value,
        obs: document.getElementById('obsText').value,
        items: items
    };

    registrarNumeroUsado(); // Consolidar número (Punto 3)
    ipcRenderer.send('guardar-json', { data, defaultPath: currentFilePath || 'proyecto.json' });
};

window.exportarPDF = function() {
    registrarNumeroUsado(); // Consolidar número (Punto 3)
    let suggestedName = currentFilePath ? currentFilePath.replace(/\.json$/i, '.pdf') : 'documento.pdf';
    ipcRenderer.send('exportar-pdf', suggestedName);
};

window.dispararCarga = () => document.getElementById('fileInput').click();

document.getElementById('fileInput').onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(ev) {
        try {
            const d = JSON.parse(ev.target.result);
            document.getElementById('tituloDoc').innerText = d.tipo;
            document.getElementById('emisorNombre').innerText = d.nombre;
            document.getElementById('emisorDNI').innerText = d.dni;
            document.getElementById('emisorDireccion').innerText = d.direccion;
            document.getElementById('emisorTelefono').innerText = d.telefono;
            document.getElementById('numDoc').value = d.num;
            document.getElementById('fechaDoc').value = d.fecha;
            
            document.getElementById('clienteNombre').innerText = d.cNombre || "";
            document.getElementById('clienteDNI').innerText = d.cDni || "";
            document.getElementById('clienteDireccion').innerText = d.cDir || "";
            document.getElementById('clienteTelefono').innerText = d.cTel || "";
            
            document.getElementById('ivaSelect').value = d.iva;
            document.getElementById('obsText').value = d.obs;
            
            const tbody = document.getElementById('cuerpoTabla');
            tbody.innerHTML = "";
            d.items.forEach(item => añadirFila(item.d, item.p));
            
            currentFilePath = file.path;
            calcularTotales();
            ajustarTextArea(document.getElementById('obsText'));
            await showModal('Proyecto cargado', 'alert');
        } catch (err) { await showModal('Error al cargar archivo', 'alert'); }
    };
    reader.readAsText(file);
};

// --- 8. INICIALIZACIÓN DE LISTENERS ---
document.getElementById('selectPerfil').onchange = function(e) {
    const p = perfiles[e.target.value];
    if (p) {
        document.getElementById('emisorNombre').innerText = p.nombre;
        document.getElementById('emisorDNI').innerText = p.dni;
        document.getElementById('emisorDireccion').innerText = p.direccion;
        document.getElementById('emisorTelefono').innerText = p.telefono;
    }
};

// Listener para el auto-ajuste de observaciones (Punto 4)
document.getElementById('obsText').addEventListener('input', function() { ajustarTextArea(this); });

// Listener para validación de teléfonos (Punto 1)
document.getElementById('emisorTelefono').addEventListener('input', validarTelefono);
document.getElementById('clienteTelefono').addEventListener('input', validarTelefono);

// Gestión de placeholders para contenteditable
document.querySelectorAll('[contenteditable="true"]').forEach(el => {
    el.addEventListener('blur', () => {
        if (el.innerText.trim() === "") el.innerHTML = "";
    });
});

// Arrancar app
actualizarSelector();
nuevoProyecto(true);