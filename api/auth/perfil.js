const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  // Verificar autenticación (JWT)
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, error: 'Token de autenticación requerido.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(parts[1], JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Sesión expirada. Inicie sesión nuevamente.' });
    }
    return res.status(401).json({ success: false, error: 'Token inválido.' });
  }

  // Solo clientes pueden acceder a su perfil
  if (decoded.rol !== 'cliente') {
    return res.status(403).json({ success: false, error: 'Solo usuarios con rol cliente pueden acceder a su perfil.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    if (req.method === 'GET') {
      // Obtener perfil del usuario (sin password_hash)
      const userResult = await client.query(
        `SELECT id, nombre, email, rol, telefono, direccion, fecha_creacion
         FROM usuarios
         WHERE id = $1`,
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      const user = userResult.rows[0];
      return res.status(200).json({
        success: true,
        data: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          rol: user.rol,
          telefono: user.telefono || '',
          direccion: user.direccion || '',
          fecha_creacion: user.fecha_creacion
        }
      });

    } else if (req.method === 'PUT') {
      const { telefono, direccion } = req.body || {};

      // Validar que al menos uno de los campos opcionales se envíe
      if (telefono === undefined && direccion === undefined) {
        return res.status(400).json({ success: false, error: 'Debe proporcionar al menos teléfono o dirección para actualizar.' });
      }

      // Validar formato de teléfono si se proporciona
      if (telefono !== undefined && telefono !== null && telefono.trim() !== '') {
        const telefonoLimpio = telefono.trim();
        if (telefonoLimpio.length < 7 || telefonoLimpio.length > 50) {
          return res.status(400).json({ success: false, error: 'El teléfono debe tener entre 7 y 50 caracteres.' });
        }
      }

      // Validar dirección si se proporciona
      if (direccion !== undefined && direccion !== null && direccion.trim() !== '') {
        const direccionLimpia = direccion.trim();
        if (direccionLimpia.length < 5 || direccionLimpia.length > 500) {
          return res.status(400).json({ success: false, error: 'La dirección debe tener entre 5 y 500 caracteres.' });
        }
      }

      // Actualizar solo teléfono y dirección (email y rol NO se pueden cambiar)
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (telefono !== undefined) {
        updates.push(`telefono = $${paramIndex}`);
        values.push(telefono ? telefono.trim() : null);
        paramIndex++;
      }

      if (direccion !== undefined) {
        updates.push(`direccion = $${paramIndex}`);
        values.push(direccion ? direccion.trim() : null);
        paramIndex++;
      }

      values.push(decoded.id);

      const result = await client.query(
        `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${paramIndex}
         RETURNING id, nombre, email, rol, telefono, direccion, fecha_creacion`,
        values
      );

      const user = result.rows[0];
      return res.status(200).json({
        success: true,
        message: 'Perfil actualizado correctamente.',
        data: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          rol: user.rol,
          telefono: user.telefono || '',
          direccion: user.direccion || '',
          fecha_creacion: user.fecha_creacion
        }
      });

    } else {
      return res.status(405).json({ success: false, error: 'Método no permitido. Usa GET o PUT.' });
    }

  } catch (err) {
    console.error('Error en perfil:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};