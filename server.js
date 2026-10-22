
require("dotenv").config();


const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Groq = require('groq-sdk');
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

function verificarToken(req, res, next) {
    const encabezado = req.headers.authorization;

    if (!encabezado || !encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Debes iniciar sesión para realizar esta acción."
        });
    }

    const token = encabezado.slice(7);

    try {
        const datosUsuario = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.usuario = datosUsuario;
        next();

    } catch (error) {
        return res.status(401).json({
            error: "Tu sesión no es válida o ha expirado. Inicia sesión nuevamente."
        });
    }
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(__dirname + "/public"));

// Configuración de SQL Server
const dbConfig = {
    server: process.env.DB_SERVER || "localhost",
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ECO_HUELLA",
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// Conexión a la base de datos
let poolPromise;

function conectarBD() {
    if (!poolPromise) {
        poolPromise = sql.connect(dbConfig).catch(error => {
            poolPromise = null;
            throw error;
        });
    }
    return poolPromise;
}

// Ruta para comprobar que el servidor funciona
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});
app.get("/api/tablas", async (req, res) => {
    try {
        const pool = await conectarBD();

        const resultado = await pool.request().query(`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME;
        `);

        res.json(resultado.recordset);
    } catch (error) {
        console.error("Error al consultar las tablas:", error.message);
        res.status(500).json({
            error: "No se pudieron consultar las tablas."
        });
    }
});
app.get("/api/diagnostico-sql", async (req, res) => {
    try {
        const pool = await conectarBD();

        const resultado = await pool.request().query(`
            SELECT
                SUSER_SNAME() AS LoginSQL,
                USER_NAME() AS UsuarioBD,
                DB_NAME() AS BaseDatos,
                HAS_PERMS_BY_NAME(
                    'dbo.Usuario',
                    'OBJECT',
                    'INSERT'
                ) AS PuedeInsertar;
        `);

        res.json(resultado.recordset);
    } catch (error) {
        console.error("Error de diagnóstico:", error.message);
        res.status(500).json({ error: "Error al consultar permisos." });
    }
});

app.get("/api/usuarios", async (req, res) => {
    try {
        const pool = await conectarBD();

        const resultado = await pool.request().query(`
            SELECT
                id_usuario,
                nombre,
                correo,
                fecha_registro
            FROM Usuario
            ORDER BY id_usuario;
        `);

        res.json(resultado.recordset);
    } catch (error) {
        console.error("Error al consultar usuarios:", error.message);

        res.status(500).json({
            error: "No se pudieron consultar los usuarios."
        });
    }
});


app.post("/api/usuarios", async (req, res) => {
    try {
        const { nombre, correo, password } = req.body;

        if (
            typeof nombre !== "string" ||
            !nombre.trim() ||
            nombre.trim().length > 100
        ) {
            return res.status(400).json({
                error: "El nombre es obligatorio y debe tener máximo 100 caracteres."
            });
        }

        if (
            typeof correo !== "string" ||
            !correo.trim() ||
            correo.trim().length > 150
        ) {
            return res.status(400).json({
                error: "Ingresa un correo válido."
            });
        }

        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({
                error: "La contraseña debe tener al menos 8 caracteres."
            });
        }

        const correoNormalizado = correo.trim().toLowerCase();

        // Proteger la contraseña antes de guardarla.
        const passwordHash = await bcrypt.hash(password, 12);

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("nombre", sql.NVarChar(100), nombre.trim())
            .input("correo", sql.NVarChar(150), correoNormalizado)
            .input("password_hash", sql.NVarChar(255), passwordHash)
            .query(`
                INSERT INTO dbo.Usuario
                    (nombre, correo, password_hash)
                OUTPUT
                    INSERTED.id_usuario,
                    INSERTED.nombre,
                    INSERTED.correo,
                    INSERTED.fecha_registro
                VALUES
                    (@nombre, @correo, @password_hash);
            `);

        res.status(201).json({
            mensaje: "Usuario registrado correctamente.",
            usuario: resultado.recordset[0]
        });

    } catch (error) {
        console.error("Error al registrar usuario:", error.message);

        if (error.number === 2627 || error.number === 2601) {
            return res.status(409).json({
                error: "Ese correo ya está registrado."
            });
        }

        res.status(500).json({
            error: "No se pudo registrar el usuario."
        });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { correo, password } = req.body;

        if (
            typeof correo !== "string" ||
            typeof password !== "string" ||
            !correo.trim() ||
            !password
        ) {
            return res.status(400).json({
                error: "Ingresa tu correo y contraseña."
            });
        }

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("correo", sql.NVarChar(150), correo.trim().toLowerCase())
            .query(`
                SELECT id_usuario, nombre, correo, password_hash
                FROM dbo.Usuario
                WHERE correo = @correo;
            `);

        const usuario = resultado.recordset[0];

        // Mensaje genérico para no revelar qué dato es incorrecto.
        if (
            !usuario ||
            !usuario.password_hash ||
            !(await bcrypt.compare(password, usuario.password_hash))
        ) {
            return res.status(401).json({
                error: "Correo o contraseña incorrectos."
            });
        }

        const token = jwt.sign(
            {
                id_usuario: usuario.id_usuario
            },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.json({
            mensaje: "Inicio de sesión correcto.",
            token,
            usuario: {
                id_usuario: usuario.id_usuario,
                nombre: usuario.nombre,
                correo: usuario.correo
            }
        });

    } catch (error) {
        console.error("Error al iniciar sesión:", error.message);

        res.status(500).json({
            error: "No se pudo iniciar sesión."
        });
    }
});




app.post("/api/agua", verificarToken, async (req, res) => {
    try {
        const { minutos_ducha, habitos_ahorro } = req.body;

        // El ID proviene del token verificado, no del navegador.
        const idUsuario = Number(req.usuario.id_usuario);
        const minutos = Number(minutos_ducha);

        if (
            !Number.isInteger(minutos) ||
            minutos_ducha === undefined ||
            minutos_ducha === null ||
            String(minutos_ducha).trim() === "" ||
            minutos < 0
        ) {
            return res.status(400).json({
                error: "Los minutos de ducha deben ser un entero mayor o igual a cero."
            });
        }

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("id_usuario", sql.Int, idUsuario)
            .input("minutos_ducha", sql.Int, minutos)
            .input(
                "habitos_ahorro",
                sql.NVarChar(200),
                habitos_ahorro?.trim() || null
            )
            .query(`
                INSERT INTO dbo.RegistroAgua
                    (id_usuario, minutos_ducha, habitos_ahorro)
                OUTPUT
                    INSERTED.id_agua,
                    INSERTED.id_usuario,
                    INSERTED.minutos_ducha,
                    INSERTED.habitos_ahorro,
                    INSERTED.fecha_registro
                VALUES
                    (@id_usuario, @minutos_ducha, @habitos_ahorro);
            `);

        res.status(201).json({
            mensaje: "Registro de agua guardado correctamente.",
            registro: resultado.recordset[0]
        });

    } catch (error) {
        console.error("Error al registrar agua:", error);

        if (error.number === 547) {
            return res.status(400).json({
                error: "El usuario no existe o el registro incumple una restricción."
            });
        }

        res.status(500).json({
            error: "No se pudo registrar el consumo de agua."
        });
    }
});


app.post("/api/electricidad", verificarToken, async (req, res) => {
    try {
        const {
            consumo_kwh,
            uso_climatizacion
        } = req.body;

        const idUsuario = Number(req.usuario.id_usuario);
        const consumo = Number(consumo_kwh);

        if (
            consumo_kwh === undefined ||
            consumo_kwh === null ||
            String(consumo_kwh).trim() === "" ||
            !Number.isFinite(consumo) ||
            consumo < 0
        ) {
            return res.status(400).json({
                error: "El consumo debe ser un número mayor o igual a cero."
            });
        }

        if (
            uso_climatizacion != null &&
            (typeof uso_climatizacion !== "string" ||
             uso_climatizacion.length > 100)
        ) {
            return res.status(400).json({
                error: "El uso de climatización no debe superar 100 caracteres."
            });
        }

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("id_usuario", sql.Int, idUsuario)
            .input("consumo_kwh", sql.Decimal(10, 2), consumo)
            .input(
                "uso_climatizacion",
                sql.NVarChar(100),
                uso_climatizacion?.trim() || null
            )
            .query(`
                INSERT INTO dbo.RegistroElectricidad
                    (id_usuario, consumo_kwh, uso_climatizacion)
                OUTPUT
                    INSERTED.id_electricidad,
                    INSERTED.id_usuario,
                    INSERTED.consumo_kwh,
                    INSERTED.uso_climatizacion,
                    INSERTED.fecha_registro
                VALUES
                    (@id_usuario, @consumo_kwh, @uso_climatizacion);
            `);

        res.status(201).json({
            mensaje: "Registro de electricidad guardado correctamente.",
            registro: resultado.recordset[0]
        });

    } catch (error) {
        console.error("Error al registrar electricidad:", error);

        if (error.number === 547) {
            return res.status(400).json({
                error: "El usuario no existe o el registro incumple una restricción."
            });
        }

        res.status(500).json({
            error: "No se pudo registrar el consumo de electricidad."
        });
    }
});



app.post("/api/residuos", verificarToken, async (req, res) => {
    try {
        const {
            bolsas_semana,
            practicas_reciclaje
        } = req.body;

        const idUsuario = Number(req.usuario.id_usuario);
        const bolsas = Number(bolsas_semana);

        if (
            bolsas_semana === undefined ||
            bolsas_semana === null ||
            String(bolsas_semana).trim() === "" ||
            !Number.isInteger(bolsas) ||
            bolsas < 0
        ) {
            return res.status(400).json({
                error: "Las bolsas por semana deben ser un entero mayor o igual a cero."
            });
        }

        if (
            practicas_reciclaje != null &&
            (typeof practicas_reciclaje !== "string" ||
             practicas_reciclaje.length > 250)
        ) {
            return res.status(400).json({
                error: "Las prácticas de reciclaje no deben superar 250 caracteres."
            });
        }

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("id_usuario", sql.Int, idUsuario)
            .input("bolsas_semana", sql.Int, bolsas)
            .input(
                "practicas_reciclaje",
                sql.NVarChar(250),
                practicas_reciclaje?.trim() || null
            )
            .query(`
                INSERT INTO dbo.RegistroResiduos
                    (id_usuario, bolsas_semana, practicas_reciclaje)
                OUTPUT
                    INSERTED.id_residuos,
                    INSERTED.id_usuario,
                    INSERTED.bolsas_semana,
                    INSERTED.practicas_reciclaje,
                    INSERTED.fecha_registro
                VALUES
                    (@id_usuario, @bolsas_semana, @practicas_reciclaje);
            `);

        res.status(201).json({
            mensaje: "Registro de residuos guardado correctamente.",
            registro: resultado.recordset[0]
        });

    } catch (error) {
        console.error("Error al registrar residuos:", error);

        if (error.number === 547) {
            return res.status(400).json({
                error: "El usuario no existe o el registro incumple una restricción."
            });
        }

        res.status(500).json({
            error: "No se pudo registrar el consumo de residuos."
        });
    }
});



app.post("/api/transporte", verificarToken, async (req, res) => {
    try {
        const {
            tipo_transporte,
            distancia_km,
            frecuencia
        } = req.body;

        const idUsuario = Number(req.usuario.id_usuario);
        const distancia = Number(distancia_km);

        if (
            typeof tipo_transporte !== "string" ||
            !tipo_transporte.trim() ||
            tipo_transporte.length > 80
        ) {
            return res.status(400).json({
                error: "Selecciona un tipo de transporte válido."
            });
        }

        if (
            distancia_km === undefined ||
            distancia_km === null ||
            String(distancia_km).trim() === "" ||
            !Number.isFinite(distancia) ||
            distancia < 0
        ) {
            return res.status(400).json({
                error: "La distancia debe ser un número mayor o igual a cero."
            });
        }

        if (
            frecuencia != null &&
            (typeof frecuencia !== "string" || frecuencia.length > 50)
        ) {
            return res.status(400).json({
                error: "La frecuencia no debe superar 50 caracteres."
            });
        }

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("id_usuario", sql.Int, idUsuario)
            .input(
                "tipo_transporte",
                sql.NVarChar(80),
                tipo_transporte.trim()
            )
            .input("distancia_km", sql.Decimal(10, 2), distancia)
            .input(
                "frecuencia",
                sql.NVarChar(50),
                frecuencia?.trim() || null
            )
            .query(`
                INSERT INTO dbo.RegistroTransporte
                    (id_usuario, tipo_transporte, distancia_km, frecuencia)
                OUTPUT
                    INSERTED.id_transporte,
                    INSERTED.id_usuario,
                    INSERTED.tipo_transporte,
                    INSERTED.distancia_km,
                    INSERTED.frecuencia,
                    INSERTED.fecha_registro
                VALUES
                    (@id_usuario, @tipo_transporte, @distancia_km, @frecuencia);
            `);

        res.status(201).json({
            mensaje: "Registro de transporte guardado correctamente.",
            registro: resultado.recordset[0]
        });

    } catch (error) {
        console.error("Error al registrar transporte:", error);

        if (error.number === 547) {
            return res.status(400).json({
                error: "El usuario no existe o el registro incumple una restricción."
            });
        }

        res.status(500).json({
            error: "No se pudo registrar el transporte."
        });
    }
});


 // ==========================================
 // CONSULTAR REGISTROS PARA EL PANEL ECO-HUELLA
 // ==========================================

 app.get("/api/resumen/:id_usuario", verificarToken, async (req, res) => {
     const idUsuario = Number(req.params.id_usuario);

     if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
         return res.status(400).json({
             error: "El ID de usuario no es válido."
         });
     }
 if (idUsuario !== Number(req.usuario.id_usuario)) {
    return res.status(403).json({
        error: "No puedes consultar los datos de otro usuario."
    });
}
     try {
         const pool = await conectarBD();

         const [transporte, electricidad, agua, residuos] =
             await Promise.all([
                 pool.request()
                     .input("id_usuario", sql.Int, idUsuario)
                     .query(`
                         SELECT TOP 1 *
                         FROM dbo.RegistroTransporte
                         WHERE id_usuario = @id_usuario
                         ORDER BY fecha_registro DESC, id_transporte DESC
                     `),

                 pool.request()
                     .input("id_usuario", sql.Int, idUsuario)
                     .query(`
                         SELECT TOP 1 *
                         FROM dbo.RegistroElectricidad
                         WHERE id_usuario = @id_usuario
                         ORDER BY fecha_registro DESC, id_electricidad DESC
                     `),

                 pool.request()
                     .input("id_usuario", sql.Int, idUsuario)
                     .query(`
                         SELECT TOP 1 *
                         FROM dbo.RegistroAgua
                         WHERE id_usuario = @id_usuario
                         ORDER BY fecha_registro DESC, id_agua DESC
                     `),

                 pool.request()
                     .input("id_usuario", sql.Int, idUsuario)
                     .query(`
                         SELECT TOP 1 *
                         FROM dbo.RegistroResiduos
                         WHERE id_usuario = @id_usuario
                         ORDER BY fecha_registro DESC, id_residuos DESC
                     `)
             ]);

         res.json({
             transporte: transporte.recordset[0] || null,
             electricidad: electricidad.recordset[0] || null,
             agua: agua.recordset[0] || null,
             residuos: residuos.recordset[0] || null
         });
     } catch (error) {
         console.error("Error al consultar el resumen:", error);

         res.status(500).json({
             error: "No se pudo consultar el resumen."
         });
     }
 });
 app.get("/api/historial/:id_usuario", verificarToken, async (req, res) => {
    const idUsuario = Number(req.params.id_usuario);

    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
        return res.status(400).json({
            error: "El ID de usuario no es válido."
        });
    }
if (idUsuario !== Number(req.usuario.id_usuario)) {
    return res.status(403).json({
        error: "No puedes consultar el historial de otro usuario."
    });
}
    try {
        const pool = await conectarBD();

        const resultado = await pool.request()
            .input("id_usuario", sql.Int, idUsuario)
            .query(`
                SELECT TOP (100)
                    categoria,
                    valor,
                    detalle,
                    fecha
                FROM (
                    SELECT
                        N'Transporte' AS categoria,
                        CONCAT(
                            CAST(distancia_km AS NVARCHAR(30)),
                            N' km'
                        ) AS valor,
                        CONCAT(
                            tipo_transporte,
                            N' - ',
                            frecuencia
                        ) AS detalle,
                        fecha_registro AS fecha
                    FROM dbo.RegistroTransporte
                    WHERE id_usuario = @id_usuario

                    UNION ALL

                    SELECT
                        N'Electricidad',
                        CONCAT(
                            CAST(consumo_kwh AS NVARCHAR(30)),
                            N' kWh'
                        ),
                        COALESCE(
                            uso_climatizacion,
                            N'Sin detalles'
                        ),
                        fecha_registro
                    FROM dbo.RegistroElectricidad
                    WHERE id_usuario = @id_usuario

                    UNION ALL

                    SELECT
                        N'Agua',
                        CONCAT(
                            CAST(minutos_ducha AS NVARCHAR(30)),
                            N' minutos de ducha'
                        ),
                        COALESCE(
                            habitos_ahorro,
                            N'Sin detalles'
                        ),
                        fecha_registro
                    FROM dbo.RegistroAgua
                    WHERE id_usuario = @id_usuario

                    UNION ALL

                    SELECT
                        N'Residuos',
                        CONCAT(
                            CAST(bolsas_semana AS NVARCHAR(30)),
                            N' bolsas por semana'
                        ),
                        COALESCE(
                            practicas_reciclaje,
                            N'Sin detalles'
                        ),
                        fecha_registro
                    FROM dbo.RegistroResiduos
                    WHERE id_usuario = @id_usuario
                ) AS Historial
                ORDER BY fecha DESC;
            `);

        res.json(resultado.recordset);

    } catch (error) {
        console.error("Error al consultar el historial:", error);

        res.status(500).json({
            error: "No se pudo consultar el historial."
        });
    }
});

app.post('/api/eco-accion', verificarToken, async (req, res) => {
    try {
        const id_usuario = Number(req.usuario.id_usuario);
const { acciones } = req.body;

        if (
            !Number.isInteger(Number(id_usuario)) ||
            Number(id_usuario) <= 0 ||
            !Array.isArray(acciones) ||
            acciones.length === 0
        ) {
            return res.status(400).json({
                error: 'Debes proporcionar un usuario y al menos una acción.'
            });
        }

        const accionesValidas = acciones.filter(
            accion =>
                typeof accion === 'string' &&
                accion.trim().length > 0 &&
                accion.trim().length <= 250
        );

        if (accionesValidas.length !== acciones.length) {
            return res.status(400).json({
                error: 'Cada acción debe tener entre 1 y 250 caracteres.'
            });
        }

        const pool = await conectarBD();

        for (const accion of accionesValidas) {
            await pool.request()
                .input('id_usuario', sql.Int, Number(id_usuario))
                .input('descripcion', sql.NVarChar(250), accion.trim())
                .query(`
                    INSERT INTO EcoAccion (id_usuario, descripcion)
                    VALUES (@id_usuario, @descripcion)
                `);
        }

        res.status(201).json({
            mensaje: 'Eco-Acciones guardadas correctamente.',
            cantidad: accionesValidas.length
        });

    } catch (error) {
        console.error('Error al guardar Eco-Acciones:', error);

        res.status(500).json({
            error: 'No se pudieron guardar las Eco-Acciones.'
        });
    }
});

app.get('/api/eco-accion/:id_usuario', verificarToken, async (req, res) => {
    try {
        const idUsuario = Number(req.params.id_usuario);

if (idUsuario !== Number(req.usuario.id_usuario)) {
    return res.status(403).json({
        error: "No puedes consultar las Eco-Acciones de otro usuario."
    });
}

        if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
            return res.status(400).json({
                error: 'El ID del usuario no es válido.'
            });
        }

        const pool = await conectarBD();

        const resultado = await pool.request()
            .input('id_usuario', sql.Int, idUsuario)
            .query(`
                SELECT
                    id_usuario,
                    descripcion,
                    fecha_accion
                FROM dbo.EcoAccion
                WHERE id_usuario = @id_usuario
                ORDER BY fecha_accion DESC
            `);

        res.json(resultado.recordset);

    } catch (error) {
        console.error('Error al consultar Eco-Acciones:', error);

        res.status(500).json({
            error: 'No se pudieron consultar las Eco-Acciones.'
        });
    }
});



// Comprobar la conexión con SQL Server
conectarBD()
    .then(() => console.log("Conexión a ECO_HUELLA establecida"))
    .catch(error => console.error("Error de conexión SQL Server:", error.message));

// Iniciar servidor
const PORT = process.env.PORT || 3000;

app.post('/api/chat', verificarToken, async (req, res) => {
    try {
        const { mensaje } = req.body;

        if (typeof mensaje !== 'string' || !mensaje.trim()) {
            return res.status(400).json({
                error: 'Escribe un mensaje para ECO-CHAT.'
            });
        }
        

 
const pool = await conectarBD();
const idUsuario = req.usuario.id_usuario;

const [agua, electricidad, residuos, transporte] =
    await Promise.all([
        pool.request()
            .input('id', sql.Int, idUsuario)
            .query(`
                SELECT TOP 1 minutos_ducha, habitos_ahorro,
                       fecha_registro
                FROM RegistroAgua
                WHERE id_usuario = @id
                ORDER BY fecha_registro DESC
            `),

        pool.request()
            .input('id', sql.Int, idUsuario)
            .query(`
                SELECT TOP 1 consumo_kwh, uso_climatizacion,
                       fecha_registro
                FROM RegistroElectricidad
                WHERE id_usuario = @id
                ORDER BY fecha_registro DESC
            `),

        pool.request()
            .input('id', sql.Int, idUsuario)
            .query(`
                SELECT TOP 1 bolsas_semana, practicas_reciclaje,
                       fecha_registro
                FROM RegistroResiduos
                WHERE id_usuario = @id
                ORDER BY fecha_registro DESC
            `),

        pool.request()
            .input('id', sql.Int, idUsuario)
            .query(`
                SELECT TOP 1 tipo_transporte, distancia_km,
                       frecuencia, fecha_registro
                FROM RegistroTransporte
                WHERE id_usuario = @id
                ORDER BY fecha_registro DESC
            `)
    ]);

const datosAmbientales = {
    agua: agua.recordset[0] || null,
    electricidad: electricidad.recordset[0] || null,
    residuos: residuos.recordset[0] || null,
    transporte: transporte.recordset[0] || null
};
       
const respuesta = await groq.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: [
       
{
    role: 'system',
    content:
        'Eres ECO-CHAT, el asistente virtual de ECO-HUELLA. ' +
        'Responde siempre en español, de forma amable, clara y breve. ' +
        'Usa un tono cercano y educativo. ' +

        'FORMATO OBLIGATORIO: ' +
        '1. Responde directamente a la pregunta. ' +
        '2. Usa párrafos cortos y listas de máximo 3 puntos cuando ayuden. ' +
        '3. Utiliza títulos breves solo si son necesarios. ' +
        '4. Evita tablas, introducciones largas y conclusiones repetitivas. ' +
        '5. Limita normalmente la respuesta a 100 palabras. ' +
        '6. Usa como máximo 2 emojis relevantes. ' +

        'PERSONALIZACIÓN: ' +
        'Utiliza los registros ambientales proporcionados para personalizar ' +
        'tus consejos. Menciona únicamente los datos relevantes para la pregunta. ' +
        'Si faltan datos, dilo claramente. No inventes consumos ni hábitos. ' +
        'Distingue entre datos registrados y estimaciones. ' +
        'No presentes ahorros estimados como resultados garantizados. ' +

        '\n\nRegistros ambientales del usuario:\n' +
        JSON.stringify(datosAmbientales)
},

        {
            role: 'user',
            content: mensaje.trim()
        }
    ]
});

        res.json({
            respuesta: respuesta.choices[0].message.content
        });

    } catch (error) {
        console.error('Error en ECO-CHAT:', error.message);

        res.status(500).json({
            error: 'No se pudo obtener una respuesta de ECO-CHAT.'
        });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor ECO-HUELLA funcionando en http://localhost:${PORT}`);
});
