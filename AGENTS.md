# Instrucciones para Agentes de IA - Proyecto Food Store

Este archivo establece las directrices y reglas clave de desarrollo para cualquier asistente o agente de IA que trabaje en el proyecto **Food Store** (Materia: Organización Empresarial).

## Reglas Principales de Arquitectura y Desarrollo

1. **Base de Datos Externa (PostgreSQL)**:
   - El proyecto utilizará una base de datos PostgreSQL alojada externamente.
   - No asumir bases de datos en memoria ni SQLite local para entornos finales.

2. **Validación de Permisos en Servidor**:
   - Toda validación de autenticación, autorización y permisos DEBE realizarse obligatoriamente en el servidor (backend / server side).
   - No confiar únicamente en validaciones del cliente o frontend.

3. **Política de Eliminación de Productos (Soft Delete)**:
   - Queda estrictamente prohibido eliminar (DELETE) registros de productos en la base de datos.
   - Las bajas de productos deben implementarse mediante borrado lógico (e.g., flag de activo/desactivado).

4. **Simulación de Pagos**:
   - Los procesos de pago y pasarelas son **100% simulados**.
   - No integrar pasarelas de pago ni credenciales reales en ningún entorno.

## Objetivos del Proyecto
- Desarrollar una solución funcional para la materia **Organización Empresarial**.
- Mantener un código limpio, estructurado y documentado.

## Reglas de Entrega
- Al finalizar cualquier tarea, entregá siempre un resumen estructurado en español detallando: 1) Archivos creados o modificados, 2) Cómo funciona la lógica implementada, y 3) Cómo probarlo paso a paso.
