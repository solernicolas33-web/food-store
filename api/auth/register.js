const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa POST.' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  let { nombre, email, password } = req.body || {};

  // Validaciones básicas
  if (!nombre || !email || !password) {
    return res.status(400).json({ success: false, error: 'Nombre, email y contraseña son obligatorios.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    // Validar que el email no esté registrado
    const existing = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'El email ya está registrado.' });
    }

    // Encriptar contraseña y asignar rol 'cliente' por defecto
    const passwordHash = await bcrypt.hash(password, 6);

    const result = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, estado)
       VALUES ($1, $2, $3, 'cliente', 'activo')
       RETURNING id, nombre, email, rol, estado, fecha_creacion`,
      [nombre.trim(), email.trim().toLowerCase(), passwordHash]
    );

    const usuario = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente.',
      data: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        estado: usuario.estado,
        fecha_creacion: usuario.fecha_creacion
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};
