module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa POST.' });
  }

  // Como usamos JWT stateless almacenado en el cliente, el logout se hace
  // eliminando el token del lado del cliente. Este endpoint confirma el cierre.
  return res.status(200).json({
    success: true,
    message: 'Sesión cerrada correctamente.'
  });
};
