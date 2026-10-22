// Instancias globales para los gráficos de Chart.js
let donutChartInstance = null;
let barChartInstance = null;

// ==========================================
// 1. NAVEGACIÓN Y VISTAS
// ==========================================

function showView(viewId, event) {
    // Ocultar todas las vistas y quitar clase activa del menú
    document.querySelectorAll('.view-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    // Activar la vista solicitada
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.add('active');
    }

    // Resaltar elemento del menú si se disparó por evento
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    // Renderizar gráficos si se accede a 'Mi Huella'
   if (viewId === 'mi-huella') {
    cargarResumen();
}
if (viewId === 'historial') {
    cargarHistorial();
}
if (viewId === 'eco-accion') {
    cargarEcoAcciones();
}

    // Cerrar barra lateral en dispositivos móviles
    const sidebar = document.querySelector('.sidebar');
    if (window.innerWidth <= 768 && sidebar) {
        sidebar.classList.remove('active');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}

// ==========================================
// 2. CÁLCULO DE IMPACTO Y GRÁFICOS (DASHBOARD)
// ==========================================



function calculateImpactScores() {
    const transporte = JSON.parse(
        localStorage.getItem('eco_transporte')
    );
    const electricidad = JSON.parse(
        localStorage.getItem('eco_electricidad')
    );
    const agua = JSON.parse(
        localStorage.getItem('eco_agua')
    );
    const residuos = JSON.parse(
        localStorage.getItem('eco_residuos')
    );

    const scoreTransporte = transporte
        ? Math.min(Math.round(Number(transporte.km || 0) * 1.2), 40)
        : 0;

    const scoreElectricidad = electricidad
        ? Math.min(Math.round(Number(electricidad.kwh || 0) * 0.1), 30)
        : 0;

    const scoreAgua = agua
        ? Math.min(Math.round(Number(agua.showerTime || 0) * 2), 20)
        : 0;

    const scoreResiduos = residuos
        ? Math.min(Math.round(Number(residuos.bags || 0) * 6), 25)
        : 0;

    return {
        scores: [
            scoreTransporte,
            scoreElectricidad,
            scoreAgua,
            scoreResiduos
        ],
        total: scoreTransporte +
            scoreElectricidad +
            scoreAgua +
            scoreResiduos
    };
}


async function cargarResumen() {
    try {
        const usuario = JSON.parse(
            localStorage.getItem('ecoUsuario') || 'null'
        );
        const token = localStorage.getItem('ecoToken');

        if (!usuario || !token) {
            console.error('No hay una sesión activa.');
            return;
        }

        const response = await fetch(
            `/api/resumen/${usuario.id_usuario}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const datos = await response.json();

        if (!response.ok) {
            throw new Error(
                datos.error || 'No se pudieron consultar los registros.'
            );
        }

        if (datos.transporte) {
            localStorage.setItem('eco_transporte', JSON.stringify({
                type: datos.transporte.tipo_transporte,
                km: Number(datos.transporte.distancia_km),
                freq: datos.transporte.frecuencia,
                date: datos.transporte.fecha_registro
            }));
        } else {
            localStorage.removeItem('eco_transporte');
        }

        if (datos.electricidad) {
            localStorage.setItem('eco_electricidad', JSON.stringify({
                kwh: Number(datos.electricidad.consumo_kwh),
                appliances: datos.electricidad.uso_climatizacion,
                date: datos.electricidad.fecha_registro
            }));
        } else {
            localStorage.removeItem('eco_electricidad');
        }

        if (datos.agua) {
            localStorage.setItem('eco_agua', JSON.stringify({
                showerTime: Number(datos.agua.minutos_ducha),
                habits: datos.agua.habitos_ahorro,
                date: datos.agua.fecha_registro
            }));
        } else {
            localStorage.removeItem('eco_agua');
        }

        if (datos.residuos) {
            localStorage.setItem('eco_residuos', JSON.stringify({
                bags: Number(datos.residuos.bolsas_semana),
                recyclingHabits: datos.residuos.practicas_reciclaje,
                date: datos.residuos.fecha_registro
            }));
        } else {
            localStorage.removeItem('eco_residuos');
        }

        renderCharts();
        actualizarRecomendaciones(datos);

    } catch (error) {
        console.error('Error al cargar el resumen:', error);
        alert('No se pudieron actualizar los datos desde SQL Server.');
    }
}


function renderCharts() {
    if (donutChartInstance) donutChartInstance.destroy();
    if (barChartInstance) barChartInstance.destroy();

    const dataImpact = calculateImpactScores();

    // Actualizar puntaje e indicador en la pantalla "Mi Huella"
    const scoreElement = document.querySelector('.score');
    if (scoreElement) {
        scoreElement.innerHTML = `${dataImpact.total} <span>puntos</span>`;
    }

    // Gráfico de Donut
    const canvasDonut = document.getElementById('donutChart');
    if (canvasDonut) {
        const ctxDonut = canvasDonut.getContext('2d');
        donutChartInstance = new Chart(ctxDonut, {
            type: 'doughnut',
            data: {
                labels: ['Transporte', 'Electricidad', 'Agua', 'Residuos'],
                datasets: [{
                    data: dataImpact.scores,
                    backgroundColor: ['#1E88E5', '#FFB300', '#26C6DA', '#AB47BC']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // Gráfico de Barras
    const canvasBar = document.getElementById('barChart');
    if (canvasBar) {
        const ctxBar = canvasBar.getContext('2d');
        barChartInstance = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: ['Transporte', 'Electricidad', 'Agua', 'Residuos'],
                datasets: [{
                    label: 'Puntos de impacto',
                    data: dataImpact.scores,
                    backgroundColor: ['#1E88E5', '#FFB300', '#26C6DA', '#AB47BC']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

 // ==========================================
 // 3. GUARDADO DE FORMULARIOS EN SQL SERVER
 // ==========================================

 // ID temporal del usuario de prueba en ECO_HUELLA
 function obtenerUsuarioId() {
    const usuario = JSON.parse(
        localStorage.getItem('ecoUsuario') || 'null'
    );

    return usuario ? Number(usuario.id_usuario) : null;
}

 // Función general para enviar datos al servidor
 
async function enviarRegistro(endpoint, datos) {
    const token = localStorage.getItem('ecoToken');

    if (!token) {
        throw new Error('Debes iniciar sesión para guardar registros.');
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(datos)
    });

    const resultado = await response.json();

    if (!response.ok) {
        throw new Error(
            resultado.error || resultado.mensaje ||
            'No se pudo guardar el registro.'
        );
    }

    return resultado;
}


async function saveTransportData(event) {
    event.preventDefault();

    const transportType = document.getElementById('transport-type').value;
    const fuelType = transportType === 'Bicicleta / Caminata' ? 'Ninguno' : document.getElementById('fuel-type').value;
    const distance = parseFloat(document.getElementById('distance').value) || 0;
    const frequency = document.getElementById('frequency').value;

    const transportRecord = {
        id_usuario: obtenerUsuarioId(),
        tipo_transporte: transportType,
        tipo_combustible: fuelType,
        distancia_km: distance,
        frecuencia: frequency
    };

    try {
        await enviarRegistro('/api/transporte', transportRecord);

        localStorage.setItem('eco_transporte', JSON.stringify({
            type: transportRecord.tipo_transporte,
            fuel: transportRecord.tipo_combustible,
            km: transportRecord.distancia_km,
            freq: transportRecord.frecuencia,
            date: new Date().toLocaleDateString()
        }));

        mostrarModal('¡Transporte Registrado!', `Datos guardados: ${transportType} (${fuelType}).`, '🚗');
        renderCharts();
    } catch (error) {
        console.error('Error al guardar transporte:', error);
        mostrarModal('Error', 'No se pudo guardar el registro: ' + error.message, '⚠️');
    }
}

async function saveElectricityData(event) {
    event.preventDefault();
    const electricityRecord = {
        id_usuario: obtenerUsuarioId(),
        consumo_kwh: parseFloat(document.getElementById('kwh').value),
        uso_climatizacion: document.getElementById('appliances').value
    };

    try {
        await enviarRegistro('/api/electricidad', electricityRecord);
        localStorage.setItem('eco_electricidad', JSON.stringify({
            kwh: electricityRecord.consumo_kwh,
            appliances: electricityRecord.uso_climatizacion,
            date: new Date().toLocaleDateString()
        }));

        mostrarModal('¡Consumo Eléctrico Guardado!', 'Se actualizó tu consumo de electricidad en la base de datos.', '⚡');
        renderCharts();
    } catch (error) {
        console.error('Error al guardar electricidad:', error);
        mostrarModal('Error', 'No se pudo guardar la electricidad: ' + error.message, '⚠️');
    }
}

async function saveWaterData(event) {
    event.preventDefault();

    const m3Val = parseFloat(document.getElementById('water-m3').value) || 0;
    const showerTime = parseInt(document.getElementById('shower-time').value, 10) || 0;
    const habits = document.getElementById('water-habits').value;

    const waterRecord = {
        id_usuario: obtenerUsuarioId(),
        consumo_m3: m3Val,
        minutos_ducha: showerTime,
        habitos_ahorro: habits
    };

    try {
        await enviarRegistro('/api/agua', waterRecord);

        localStorage.setItem('eco_agua', JSON.stringify({
            m3: waterRecord.consumo_m3,
            showerTime: waterRecord.minutos_ducha,
            habits: waterRecord.habitos_ahorro,
            date: new Date().toLocaleDateString()
        }));

        mostrarModal('¡Consumo de Agua Guardado!', `Se registraron ${m3Val} m³ de consumo de tu recibo.`, '💧');
        renderCharts();
    } catch (error) {
        console.error('Error al guardar agua:', error);
        mostrarModal('Error', 'No se pudo guardar el registro: ' + error.message, '⚠️');
    }
}

async function saveWasteData(event) {
    event.preventDefault();

    const bags = parseInt(document.getElementById('waste-bags').value, 10) || 0;
    const weight = parseFloat(document.getElementById('waste-weight').value) || 0;
    const recyclingHabits = document.getElementById('recycling').value;

    const wasteRecord = {
        id_usuario: obtenerUsuarioId(),
        bolsas_semana: bags,
        peso_kg: weight,
        practicas_reciclaje: recyclingHabits
    };

    try {
        await enviarRegistro('/api/residuos', wasteRecord);

        localStorage.setItem('eco_residuos', JSON.stringify({
            bags: wasteRecord.bolsas_semana,
            weightKg: wasteRecord.peso_kg,
            recyclingHabits: wasteRecord.practicas_reciclaje,
            date: new Date().toLocaleDateString()
        }));

        mostrarModal('¡Residuos Guardados!', `Se registraron ${bags} bolsas (${weight} kg aprox. semanales).`, '♻️');
        renderCharts();
    } catch (error) {
        console.error('Error al guardar residuos:', error);
        mostrarModal('Error', 'No se pudieron guardar los datos: ' + error.message, '⚠️');
    }
}




 // Las eco-acciones siguen guardándose localmente por ahora.
 // Después conectaremos esta función con /api/acciones.
 

async function saveEcoAction(event) {
    event.preventDefault();

    const selectedActions = [];

    if (document.getElementById('act-recycling')?.checked)
        selectedActions.push('Reciclaje de residuos');

    if (document.getElementById('act-compost')?.checked)
        selectedActions.push('Compostaje');

    if (document.getElementById('act-water')?.checked)
        selectedActions.push('Ahorro de agua');

    if (document.getElementById('act-travel')?.checked)
        selectedActions.push('Reducción de viajes en auto');

    if (document.getElementById('act-electricity')?.checked)
        selectedActions.push('Ahorro de energía');

    const customAction =
        document.getElementById('custom-action')?.value.trim();

    if (customAction) {
        selectedActions.push(customAction);
    }

    if (selectedActions.length === 0) {
        alert('Selecciona al menos una acción o escribe una personalizada.');
        return;
    }

    try {
        const token = localStorage.getItem('ecoToken');

        if (!token) {
            throw new Error('Debes iniciar sesión para guardar acciones.');
        }

        const respuesta = await fetch('/api/eco-accion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                acciones: selectedActions
            })
        });

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.error || 'No se pudieron guardar las Eco-Acciones.'
            );
        }

        const summaryDiv = document.getElementById('action-summary');

        if (summaryDiv) {
            summaryDiv.textContent =
                `¡Has registrado ${resultado.cantidad} acción(es)!`;
        }

        await cargarEcoAcciones();

        alert('¡Eco-Acciones guardadas correctamente!');

    } catch (error) {
        console.error('Error al guardar Eco-Acciones:', error);
        alert(error.message || 'No se pudieron guardar las acciones.');
    }
}

// ==========================================
// LÓGICA DEL ECO-CHAT (Conexión Segura con Groq)
// ==========================================
 
// 1. Clave entre comillas y con el nombre de variable correcto
const API_KEY_GROQ = "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";
 
async function getGroqResponse(userMessage) {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const systemPrompt = `Eres el asistente virtual oficial de ECO-HUELLA. Responde de forma amable, concisa y clara. El texto sea corto y evita crear tablas. `;
 
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY_GROQ}` // Ahora coincide con la variable de arriba
        },
        body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ]
        })
    });
 
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Detalle del servidor Groq:", errorData);
        throw new Error(`Error ${response.status}`);
    }
 
    const data = await response.json();
    return data.choices[0].message.content;
}
 
// Función principal que controla la interfaz del chat
async function sendMessage() {
    const inputField = document.getElementById('userInput');
    const userText = inputField.value.trim();
   
    if (!userText) return;
 
    // Escribe el mensaje del usuario
    addMessage(userText, 'user');
    inputField.value = '';
 
    // Muestra que el bot está escribiendo
    const typingId = addMessage('Pensando una respuesta verde...', 'bot');
 
    try {
        // Pide la respuesta a Groq
        const botReply = await getGroqResponse(userText);
        // Actualiza la burbuja con la respuesta real
        updateMessage(typingId, botReply);
    } catch (error) {
        console.error("Fallo general:", error);
        // Evita que se quede congelado
        updateMessage(typingId, "⚠️ Hubo un error de conexión con la IA. Revisa tu conexión o presiona F12 para ver la consola.");
    }
}
 
// Funciones visuales (Una sola copia de cada una)
function addMessage(text, sender) {
    const chatBox = document.getElementById('chatBox');
    const msgDiv = document.createElement('div');
    const uniqueId = 'msg-' + Date.now() + '-' + Math.random().toString(36.2);
   
    msgDiv.id = uniqueId;
    // Forzar que siempre incluya la clase base 'message' y el rol correspondiente
    msgDiv.className = `message ${sender}`;
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
   
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
   
    return uniqueId;
}
 
function updateMessage(id, text) {
    const msgDiv = document.getElementById(id);
    if (msgDiv) {
        let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formattedText = formattedText.replace(/\n/g, '<br>');
        msgDiv.innerHTML = formattedText;
    }
}
 
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}


           
// ==========================================
// 5. INICIALIZACIÓN DE LA APLICACIÓN
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Cargar resumen de Eco-Acciones si ya existe en localStorage
    const savedActions = JSON.parse(localStorage.getItem('eco_acciones_hoy'));
    if (savedActions && savedActions.actions) {
        const summaryDiv = document.getElementById('action-summary');
        if (summaryDiv) {
            summaryDiv.innerHTML = `¡Has registrado ${savedActions.actions.length} acción(es) hoy!`;
        }
    }

});

async function cargarHistorial() {
    const tbody = document.getElementById('historialBody');

    if (!tbody) return;

    tbody.textContent = '';

    try {
        const usuario = JSON.parse(
            localStorage.getItem('ecoUsuario') || 'null'
        );

        const token = localStorage.getItem('ecoToken');

        if (!usuario || !token) {
            throw new Error('Debes iniciar sesión para ver tu historial.');
        }

        const respuesta = await fetch(
            `/api/historial/${usuario.id_usuario}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const registros = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                registros.error || 'No se pudo consultar el historial.'
            );
        }

        if (registros.length === 0) {
            const fila = document.createElement('tr');
            const celda = document.createElement('td');

            celda.colSpan = 4;
            celda.textContent = 'Todavía no tienes registros guardados.';
            fila.appendChild(celda);
            tbody.appendChild(fila);
            return;
        }

        registros.forEach(registro => {
            const fila = document.createElement('tr');

            const fecha = new Date(registro.fecha);
            const fechaTexto = Number.isNaN(fecha.getTime())
                ? 'Fecha no disponible'
                : fecha.toLocaleString('es-MX', {
                    dateStyle: 'short',
                    timeStyle: 'short'
                });

            [
                registro.categoria,
                registro.valor,
                registro.detalle,
                fechaTexto
            ].forEach(valor => {
                const celda = document.createElement('td');
                celda.textContent = valor ?? 'Sin detalles';
                fila.appendChild(celda);
            });

            tbody.appendChild(fila);
        });

    } catch (error) {
        console.error('Error al cargar el historial:', error);

        const fila = document.createElement('tr');
        const celda = document.createElement('td');

        celda.colSpan = 4;
        celda.textContent = error.message ||
            'No se pudo cargar el historial.';

        fila.appendChild(celda);
        tbody.appendChild(fila);
    }
}



async function cargarEcoAcciones() {
    const lista = document.getElementById('eco-acciones-lista');

    if (!lista) return;

    lista.innerHTML = '<li>Cargando Eco-Acciones...</li>';

    try {
        const usuario = JSON.parse(
            localStorage.getItem("ecoUsuario") || "null"
        );
        const token = localStorage.getItem('ecoToken')

        if (!usuario || !token) {
            lista.innerHTML =
                '<li>Inicia sesión para consultar tus Eco-Acciones.</li>';
            return;
        }

        const respuesta = await fetch(
            `/api/eco-accion/${usuario.id_usuario}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (!respuesta.ok) {
            throw new Error(
                'No se pudieron consultar las Eco-Acciones.'
            );
        }

        const acciones = await respuesta.json();
        lista.innerHTML = '';

        if (acciones.length === 0) {
            lista.innerHTML =
                '<li>Aún no tienes Eco-Acciones registradas.</li>';
            return;
        }

        acciones.forEach(accion => {
            const elemento = document.createElement('li');

            // Evita que la zona horaria cambie el día mostrado.
            const fechaTexto = String(accion.fecha_accion).slice(0, 10);
            const [anio, mes, dia] = fechaTexto.split('-');

            const fechaFormateada =
                `${dia}/${mes}/${anio}`;

            elemento.textContent =
                `${accion.descripcion} — ${fechaFormateada}`;

            lista.appendChild(elemento);
        });

    } catch (error) {
        console.error('Error al cargar Eco-Acciones:', error);

        lista.innerHTML =
            '<li>No se pudieron cargar las Eco-Acciones.</li>';
    }
}


/* ==========================================
   AUTENTICACIÓN DE ECO-HUELLA
========================================== */

const authScreen = document.getElementById("auth-screen");
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

function mostrarFormularioAcceso(tipo) {
    const esLogin = tipo === "login";

    loginForm.hidden = !esLogin;
    registerForm.hidden = esLogin;

    tabLogin.classList.toggle("active", esLogin);
    tabRegister.classList.toggle("active", !esLogin);

    document.getElementById("login-mensaje").textContent = "";
    document.getElementById("register-mensaje").textContent = "";
}

tabLogin.addEventListener("click", () => {
    mostrarFormularioAcceso("login");
});

tabRegister.addEventListener("click", () => {
    mostrarFormularioAcceso("register");
});

// REGISTRO DE CUENTA
registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const mensaje = document.getElementById("register-mensaje");
    const boton = registerForm.querySelector('button[type="submit"]');

    mensaje.textContent = "";
    boton.disabled = true;

    try {
        const respuesta = await fetch("/api/usuarios", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nombre: document.getElementById("register-nombre").value.trim(),
                correo: document.getElementById("register-correo").value.trim(),
                password: document.getElementById("register-password").value
            })
        });

        const data = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(data.error || "No se pudo crear la cuenta.");
        }

        // Preparar el formulario de inicio de sesión.
        document.getElementById("login-correo").value =
            document.getElementById("register-correo").value.trim();

        document.getElementById("login-password").value = "";
        registerForm.reset();

        mostrarFormularioAcceso("login");

        document.getElementById("login-mensaje").style.color = "#28794b";
        document.getElementById("login-mensaje").textContent =
            "Cuenta creada correctamente. Ahora inicia sesión.";

    } catch (error) {
        mensaje.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
});

// INICIO DE SESIÓN
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const mensaje = document.getElementById("login-mensaje");
    const boton = loginForm.querySelector('button[type="submit"]');

    mensaje.style.color = "";
    mensaje.textContent = "";
    boton.disabled = true;

    try {
        const respuesta = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                correo: document.getElementById("login-correo").value.trim(),
                password: document.getElementById("login-password").value
            })
        });

        const data = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(data.error || "No se pudo iniciar sesión.");
        }

        // Mantener los datos durante esta pestaña del navegador.
       localStorage.setItem('ecoToken', data.token);
localStorage.setItem('ecoUsuario', JSON.stringify(data.usuario));

        // Mostrar el nombre real del usuario.
        const nombreUsuario = document.querySelector(".user-name");
        if (nombreUsuario) {
            nombreUsuario.textContent = data.usuario.nombre;
        }

        authScreen.style.display = "none";

        // Mostrar la vista inicial.
        if (typeof showView === "function") {
            showView("inicio");
        }

    } catch (error) {
        mensaje.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
});

function actualizarRecomendaciones(datos) {
    const recomendaciones = {
        transporte: {
            estado: document.getElementById('estado-transporte'),
            consejo: document.getElementById('consejo-transporte')
        },
        electricidad: {
            estado: document.getElementById('estado-electricidad'),
            consejo: document.getElementById('consejo-electricidad')
        },
        agua: {
            estado: document.getElementById('estado-agua'),
            consejo: document.getElementById('consejo-agua')
        },
        residuos: {
            estado: document.getElementById('estado-residuos'),
            consejo: document.getElementById('consejo-residuos')
        }
    };

    function mostrar(tipo, estado, consejo) {
        if (recomendaciones[tipo].estado) {
            recomendaciones[tipo].estado.textContent = estado;
        }

        if (recomendaciones[tipo].consejo) {
            recomendaciones[tipo].consejo.textContent = consejo;
        }
    }

    // Transporte
    if (datos.transporte) {
        const km = Number(datos.transporte.distancia_km);

        if (km >= 50) {
            mostrar(
                'transporte',
                'Prioridad alta',
                'Tu último registro muestra una distancia de 50 km o más. Cuando sea posible, comparte viajes o combina varios trayectos para reducir desplazamientos.'
            );
        } else {
            mostrar(
                'transporte',
                'Buen comienzo',
                'Continúa registrando tus trayectos. Cuando sea práctico, considera caminar, usar bicicleta o transporte público.'
            );
        }
    } else {
        mostrar(
            'transporte',
            'Sin registros',
            'Registra tus trayectos para recibir consejos más personalizados sobre transporte.'
        );
    }

    // Electricidad
    if (datos.electricidad) {
        const kwh = Number(datos.electricidad.consumo_kwh);

        if (kwh >= 300) {
            mostrar(
                'electricidad',
                'Revisar consumo',
                'Tu último registro es de 300 kWh o más. Revisa el uso del aire acondicionado, ajusta la temperatura y apaga los aparatos que no utilices.'
            );
        } else {
            mostrar(
                'electricidad',
                'Buen comienzo',
                'Mantén hábitos de ahorro: utiliza focos LED, apaga las luces innecesarias y revisa el consumo de tus aparatos.'
            );
        }
    } else {
        mostrar(
            'electricidad',
            'Sin registros',
            'Registra tu consumo eléctrico para recibir recomendaciones relacionadas con tus datos.'
        );
    }

    // Agua
    if (datos.agua) {
        const minutos = Number(datos.agua.minutos_ducha);

        if (minutos > 10) {
            mostrar(
                'agua',
                'Oportunidad de mejora',
                'Tu último registro indica duchas de más de 10 minutos. Intenta reducir gradualmente el tiempo y cierra la llave mientras te enjabonas.'
            );
        } else {
            mostrar(
                'agua',
                'Buen comienzo',
                'Continúa cuidando el agua con duchas breves y revisando que no haya fugas en grifos o sanitarios.'
            );
        }
    } else {
        mostrar(
            'agua',
            'Sin registros',
            'Registra tus hábitos de consumo de agua para obtener consejos personalizados.'
        );
    }

    // Residuos
    if (datos.residuos) {
        const bolsas = Number(datos.residuos.bolsas_semana);

        if (bolsas >= 5) {
            mostrar(
                'residuos',
                'Oportunidad de mejora',
                'Tu último registro indica 5 bolsas o más por semana. Intenta evitar productos desechables, reutilizar envases y separar los materiales reciclables.'
            );
        } else {
            mostrar(
                'residuos',
                'Buen comienzo',
                'Continúa separando los residuos reciclables y, si es posible, aprovecha los restos orgánicos para hacer composta.'
            );
        }
    } else {
        mostrar(
            'residuos',
            'Sin registros',
            'Registra tus residuos semanales para recibir recomendaciones basadas en tus hábitos.'
        );
    }
}

async function restaurarSesion() {
    const token = localStorage.getItem('ecoToken');
    const usuarioGuardado = localStorage.getItem('ecoUsuario');

    // Si no hay sesión guardada, se muestra el inicio de sesión normal.
    if (!token || !usuarioGuardado) return;

    try {
        const usuario = JSON.parse(usuarioGuardado);

        // Verificar que el token siga siendo válido.
        const respuesta = await fetch(
            `/api/resumen/${usuario.id_usuario}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!respuesta.ok) {
            throw new Error('La sesión ha caducado.');
        }

        // Restaurar los datos del usuario en la página.
        const nombreUsuario = document.querySelector('.user-name');

        if (nombreUsuario) {
            nombreUsuario.textContent = usuario.nombre;
        }

        const pantallaAcceso = document.getElementById('auth-screen');

        if (pantallaAcceso) {
            pantallaAcceso.style.display = 'none';
        }

        showView('inicio');

    } catch (error) {
        console.warn('No se pudo restaurar la sesión:', error.message);

        localStorage.removeItem('ecoToken');
        localStorage.removeItem('ecoUsuario');

        // La pantalla de inicio de sesión queda disponible.
    }
}

// Ejecutar al cargar la página.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restaurarSesion);
} else {
    restaurarSesion();
}


// Factores de emisión documentados (kg CO2e por unidad)
const FACTORES_EMISION = {
  electricidad_kwh: 0.435,   // CRE México / RENE
  gasolina_litro: 2.31,      // EPA / IPCC
  diesel_litro: 2.68,        // EPA / IPCC
  gas_lp_litro: 1.51,        // GHG Protocol
  agua_m3: 0.344             // DEFRA / GHG
};

/**
 * Calcula la huella ambiental en kg CO2e
 */
function calcularHuellaReal(datos) {
  const huellaElectricidad = (datos.kwh || 0) * FACTORES_EMISION.electricidad_kwh;
  const huellaGasolina = (datos.litrosGasolina || 0) * FACTORES_EMISION.gasolina_litro;
  const huellaGasLP = (datos.litrosGasLP || 0) * FACTORES_EMISION.gas_lp_litro;
  const huellaAgua = ((datos.litrosAgua || 0) / 1000) * FACTORES_EMISION.agua_m3;

  const totalKgCO2e = huellaElectricidad + huellaGasolina + huellaGasLP + huellaAgua;
  return Number(totalKgCO2e.toFixed(2));
}

/**
 * Compara dos periodos de consumo/emisión
 */
function compararPeriodos(huellaActual, huellaAnterior) {
  if (!huellaAnterior || huellaAnterior === 0) {
    return { mensaje: "Sin datos previos para comparar.", cambioPorcentual: 0 };
  }

  const diferencia = huellaActual - huellaAnterior;
  const porcentaje = ((diferencia / huellaAnterior) * 100).toFixed(1);

  const esReduccion = diferencia < 0;

  return {
    diferenciaAbsoluta: Number(diferencia.toFixed(2)), // en kg CO2e
    porcentaje: Math.abs(porcentaje),
    esReduccion: esReduccion,
    mensaje: esReduccion
      ? `¡Felicidades! Redujiste tu huella un ${Math.abs(porcentaje)}% (${Math.abs(diferencia).toFixed(2)} kg CO₂e menos).`
      : `Tu huella aumentó un ${porcentaje}% (${diferencia.toFixed(2)} kg CO₂e más) respecto al periodo anterior.`
  };
}

// Ejemplo de uso:
const semana1 = calcularHuellaReal({ kwh: 50, litrosGasolina: 20, litrosAgua: 1500 });
const semana2 = calcularHuellaReal({ kwh: 42, litrosGasolina: 15, litrosAgua: 1400 });

const comparativa = compararPeriodos(semana2, semana1);
console.log(`Semana 1: ${semana1} kg CO2e`);
console.log(`Semana 2: ${semana2} kg CO2e`);
console.log(comparativa.mensaje);

// 1. Seleccionar el botón de usuario por su ID o clase
const botonUsuario = document.getElementById('user-profile-btn'); // Cambia el ID según tu HTML

// 2. Escuchar el evento de clic
botonUsuario.addEventListener('click', () => {
  // Opcional: Confirmar si el usuario realmente quiere salir
  const confirmar = confirm('¿Estás seguro de que deseas cerrar sesión?');
  
  if (confirmar) {
    cerrarSesion();
  }
});

/**
 * Función encargada de limpiar la sesión y redirigir
 */
function cerrarSesion() {
  // Limpiar tokens, datos de usuario o variables guardadas en el navegador
  localStorage.clear(); // O localStorage.removeItem('token');
  sessionStorage.clear();

  // (Opcional) Limpiar estado global en memoria si manejas variables globales
  // usuarioActual = null;

  // Redirigir a la página de login o inicio
  window.location.href = 'login.html'; // Ajusta la ruta según la estructura de tu proyecto
}
document.addEventListener('DOMContentLoaded', () => {
  const botonUsuario = document.getElementById('user-profile-btn');

  if (botonUsuario) {
    botonUsuario.addEventListener('click', () => {
      const confirmar = confirm('¿Estás seguro de que deseas cerrar sesión?');
      if (confirmar) {
        cerrarSesion();
      }
    });
  }
});

function cerrarSesion() {
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = 'login.html'; // Cambia 'login.html' por la ruta de tu pantalla de acceso
}
/**
 * Muestra una notificación personalizada en pantalla
 * @param {string} mensaje - Texto que se mostrará
 * @param {string} icono - Emoji o icono para acompañar el mensaje
 */
function mostrarNotificacion(mensaje, icono = '🌱') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  if (!toast) return;

  // Actualizar contenido
  toastMessage.textContent = mensaje;
  toastIcon.textContent = icono;

  // Mostrar el toast
  toast.classList.add('show');

  // Ocultar automáticamente después de 3.5 segundos
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}
/**
 * Muestra la ventana modal centrada personalizada
 */
function mostrarModal(titulo, mensaje, icono = '🌱') {
  const modal = document.getElementById('modal-container');
  const modalTitle = document.getElementById('modal-title');
  const modalMessage = document.getElementById('modal-message');
  const modalIcon = document.getElementById('modal-icon');
  const closeBtn = document.getElementById('modal-close-btn');

  if (!modal) return;

  modalTitle.textContent = titulo;
  modalMessage.textContent = mensaje;
  modalIcon.textContent = icono;

  modal.classList.add('active');

  const cerrar = () => {
    modal.classList.remove('active');
    closeBtn.removeEventListener('click', cerrar);
  };

  closeBtn.onclick = cerrar;
}

/**
 * Función encargada de limpiar la sesión y redirigir
 */
function cerrarSesion() {
  localStorage.clear();
  sessionStorage.clear();
  window.location.reload(); // Recarga la pantalla de login/autenticación
}

// Vincular evento de clic en el perfil del sidebar
document.addEventListener('DOMContentLoaded', () => {
  const sidebarUser = document.querySelector('.sidebar-user');
  if (sidebarUser) {
    sidebarUser.style.cursor = 'pointer';
    sidebarUser.addEventListener('click', () => {
      const confirmar = confirm('¿Deseas cerrar sesión en ECO-HUELLA?');
      if (confirmar) {
        cerrarSesion();
      }
    });
  }
});