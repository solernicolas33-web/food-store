const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa GET.' });
  }

  // Extraer token de la cabecera Authorization: Bearer <token>
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, authenticated: false, error: 'No se proporcionó un token válido.' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    return res.status(200).json({
      success: true,
      authenticated: true,
      data: {
        id: decoded.id,
        nombre: decoded.nombre,
        email: decoded.email,
        rol: decoded.rol
      }
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, authenticated: false, error: 'Sesión expirada.' });
    }
    return res.status(401).json({ success: false, authenticated: false, error: 'Token inválido.' });
  }
};
