const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  // Verificar autenticación y autorización (SOLO superadmin)
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

  if (decoded.rol !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Acceso denegado. Se requiere rol superadmin.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    // GET: Listar todos los usuarios
    if (req.method === 'GET') {
      const result = await client.query(
        `SELECT id, nombre, email, rol, estado, fecha_creacion
         FROM usuarios
         ORDER BY fecha_creacion DESC`
      );

      return res.status(200).json({
        success: true,
        data: result.rows.map(r => ({
          id: r.id,
          nombre: r.nombre,
          email: r.email,
          rol: r.rol,
          activo: r.estado === 'activo',
          fecha_creacion: r.fecha_creacion
        }))
      });
    }

    // PUT: Cambiar rol o activar/desactivar usuario
    if (req.method === 'PUT') {
      const { id, rol, activo } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, error: 'ID del usuario es obligatorio.' });
      }

      // Verificar que el usuario existe
      const userResult = await client.query('SELECT id, nombre, email, rol, estado FROM usuarios WHERE id = $1', [id]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      const usuario = userResult.rows[0];
      const esMismoUsuario = decoded.id === id;

      // Validar rol si se proporciona
      if (rol !== undefined) {
        if (!['cliente', 'empleado', 'superadmin'].includes(rol)) {
          return res.status(400).json({ success: false, error: 'Rol inválido. Valores permitidos: cliente, empleado, superadmin.' });
        }

        // REGLA R10: No permitir quitar el rol superadmin si es el último superadmin activo
        if (usuario.rol === 'superadmin' && rol !== 'superadmin') {
          const superadminCount = await client.query(
            `SELECT COUNT(*) FROM usuarios WHERE rol = 'superadmin' AND estado = 'activo'`
          );
          const activeSuperadmins = parseInt(superadminCount.rows[0].count, 10);

          if (activeSuperadmins <= 1) {
            return res.status(400).json({
              success: false,
              error: 'No se puede quitar el rol superadmin: es el último superadmin activo del sistema. Se requiere al menos un superadmin activo.'
            });
          }
        }

        // No permitir autodesignación de rol inferior (opcional, pero buena práctica)
        if (esMismoUsuario && usuario.rol === 'superadmin' && rol !== 'superadmin') {
          return res.status(400).json({ success: false, error: 'No puedes cambiar tu propio rol de superadmin.' });
        }
      }

      // Validar estado activo/inactivo si se proporciona
      if (activo !== undefined) {
        const nuevoEstado = activo ? 'activo' : 'inactivo';

        // REGLA R10: No permitir desactivar al último superadmin activo
        if (usuario.rol === 'superadmin' && usuario.estado === 'activo' && !activo) {
          const superadminCount = await client.query(
            `SELECT COUNT(*) FROM usuarios WHERE rol = 'superadmin' AND estado = 'activo'`
          );
          const activeSuperadmins = parseInt(superadminCount.rows[0].count, 10);

          if (activeSuperadmins <= 1) {
            return res.status(400).json({
              success: false,
              error: 'No se puede desactivar este usuario: es el último superadmin activo del sistema. Se requiere al menos un superadmin activo.'
            });
          }
        }

        // No permitir auto-desactivación
        if (esMismoUsuario && usuario.estado === 'activo' && !activo) {
          return res.status(400).json({ success: false, error: 'No puedes desactivar tu propia cuenta.' });
        }

        await client.query('UPDATE usuarios SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
      }

      // Actualizar rol si se proporcionó
      if (rol !== undefined) {
        await client.query('UPDATE usuarios SET rol = $1 WHERE id = $2', [rol, id]);
      }

      // Obtener usuario actualizado
      const updatedResult = await client.query(
        `SELECT id, nombre, email, rol, estado, fecha_creacion FROM usuarios WHERE id = $1`,
        [id]
      );

      return res.status(200).json({
        success: true,
        message: 'Usuario actualizado correctamente.',
        data: {
          id: updatedResult.rows[0].id,
          nombre: updatedResult.rows[0].nombre,
          email: updatedResult.rows[0].email,
          rol: updatedResult.rows[0].rol,
          activo: updatedResult.rows[0].estado === 'activo',
          fecha_creacion: updatedResult.rows[0].fecha_creacion
        }
      });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido.' });

  } catch (err) {
    console.error('Error en admin/usuarios:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};