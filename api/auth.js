const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Helper: extract and verify JWT
function getUserFromToken(req) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  try {
    return jwt.verify(parts[1], JWT_SECRET);
  } catch {
    return null;
  }
}

// Helper: create DB pool
function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// Helper: send error
function sendError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return sendError(res, 500, 'DATABASE_URL no está configurada.');
  }

  const url = req.url || '';
  const method = req.method;
  const pool = getPool();
  let client;

  try {
    client = await pool.connect();

    // ==================== POST /api/auth/login ====================
    if (method === 'POST' && url.includes('/login')) {
      const { email, password } = req.body || {};
      if (!email || !password) return sendError(res, 400, 'Email y contraseña son obligatorios.');

      const result = await client.query(
        'SELECT id, nombre, email, password_hash, rol, estado FROM usuarios WHERE email = $1',
        [email.trim().toLowerCase()]
      );

      if (result.rows.length === 0) return sendError(res, 401, 'Email o contraseña incorrectos.');

      const usuario = result.rows[0];
      if (usuario.estado !== 'activo') return sendError(res, 401, 'Email o contraseña incorrectos.');

      const valida = await bcrypt.compare(password, usuario.password_hash);
      if (!valida) return sendError(res, 401, 'Email o contraseña incorrectos.');

      const token = jwt.sign(
        { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return res.status(200).json({
        success: true,
        message: 'Inicio de sesión exitoso.',
        data: { token, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } }
      });
    }

    // ==================== POST /api/auth/register ====================
    if (method === 'POST' && url.includes('/register')) {
      const { nombre, email, password } = req.body || {};
      if (!nombre || !email || !password) return sendError(res, 400, 'Nombre, email y contraseña son obligatorios.');
      if (password.length < 6) return sendError(res, 400, 'La contraseña debe tener al menos 6 caracteres.');

      const existing = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
      if (existing.rows.length > 0) return sendError(res, 409, 'El email ya está registrado.');

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
        data: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, estado: usuario.estado, fecha_creacion: usuario.fecha_creacion }
      });
    }

    // ==================== GET /api/auth/me ====================
    if (method === 'GET' && url.includes('/me')) {
      const decoded = getUserFromToken(req);
      if (!decoded) return sendError(res, 401, 'No se proporcionó un token válido.');

      return res.status(200).json({
        success: true,
        authenticated: true,
        data: { id: decoded.id, nombre: decoded.nombre, email: decoded.email, rol: decoded.rol }
      });
    }

    // ==================== POST /api/auth/logout ====================
    if (method === 'POST' && url.includes('/logout')) {
      return res.status(200).json({ success: true, message: 'Sesión cerrada correctamente.' });
    }

    // ==================== GET/PUT /api/auth/perfil ====================
    if (url.includes('/perfil')) {
      const decoded = getUserFromToken(req);
      if (!decoded) return sendError(res, 401, 'Token de autenticación requerido.');
      if (decoded.rol !== 'cliente') return sendError(res, 403, 'Solo usuarios con rol cliente pueden acceder a su perfil.');

      if (method === 'GET') {
        const userResult = await client.query(
          `SELECT id, nombre, email, rol, telefono, direccion, fecha_creacion FROM usuarios WHERE id = $1`,
          [decoded.id]
        );
        if (userResult.rows.length === 0) return sendError(res, 404, 'Usuario no encontrado.');

        const user = userResult.rows[0];
        return res.status(200).json({
          success: true,
          data: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, telefono: user.telefono || '', direccion: user.direccion || '', fecha_creacion: user.fecha_creacion }
        });
      }

      if (method === 'PUT') {
        const { telefono, direccion } = req.body || {};
        if (telefono === undefined && direccion === undefined) {
          return sendError(res, 400, 'Debe proporcionar al menos teléfono o dirección para actualizar.');
        }
        if (telefono !== undefined && telefono !== null && telefono.trim() !== '') {
          const t = telefono.trim();
          if (t.length < 7 || t.length > 50) return sendError(res, 400, 'El teléfono debe tener entre 7 y 50 caracteres.');
        }
        if (direccion !== undefined && direccion !== null && direccion.trim() !== '') {
          const d = direccion.trim();
          if (d.length < 5 || d.length > 500) return sendError(res, 400, 'La dirección debe tener entre 5 y 500 caracteres.');
        }

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (telefono !== undefined) { updates.push(`telefono = $${paramIndex}`); values.push(telefono ? telefono.trim() : null); paramIndex++; }
        if (direccion !== undefined) { updates.push(`direccion = $${paramIndex}`); values.push(direccion ? direccion.trim() : null); paramIndex++; }

        values.push(decoded.id);
        const result = await client.query(
          `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, nombre, email, rol, telefono, direccion, fecha_creacion`,
          values
        );

        const user = result.rows[0];
        return res.status(200).json({
          success: true,
          message: 'Perfil actualizado correctamente.',
          data: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, telefono: user.telefono || '', direccion: user.direccion || '', fecha_creacion: user.fecha_creacion }
        });
      }

      return sendError(res, 405, 'Método no permitido. Usa GET o PUT.');
    }

    // Default: route not found
    return sendError(res, 404, 'Endpoint de autenticación no encontrado.');

  } catch (err) {
    console.error('Error en auth:', err);
    return sendError(res, 500, err.message);
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};