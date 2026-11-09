# Auditoría SFW — estado de verificación

Base original 16b2922. SFW elimina el cifrado de contenedores y rechaza canvas cifrados antiguos antes de modificar su contenido. Perfil y appId separados.

## Cambios y comprobaciones

- Tareas 1/2. ZIP elimina permisos ejecutables y enlaces externos. También descarta enlaces importados a extensiones ejecutables. Apertura de originales limitada a extensiones multimedia/documento. Prueba de extracción ZIP pasada. Falta comprobar el lanzamiento real en Windows.
- Tareas 3/10/11 y cifrado de 6. No aplican al almacenamiento abierto SFW. Se retiraron KDF, cifrado, descifrado, contraseñas y controles de cierre.
- Tarea 4. Publicación atómica del PID mediante hard link y exclusión de recuperación de bloqueo obsoleto. Prueba de 50 procesos con exactamente un ganador pasada. Una interrupción durante la recuperación puede dejar .server.lock.reclaim, que exige revisión manual con la app cerrada. Falla de forma cerrada.
- Tareas 5/14. Copia de carpeta rechaza symlinks, excluye state.json.tmp y comprueba mtime y tamaño de state.json. Prueba de rechazo de symlink y limpieza pasada. Falta prueba de escritura concurrente durante la copia.
- Tarea 6. Directorios nuevos media/originals/tmp con modo 0700.
- Tarea 7. Advertencia LAN HTTP en README, DESKTOP y consola. TLS requiere configuración externa.
- Tareas 8/9. Origen same-site rechazado y original-path oculto al navegador. Pruebas HTTP pasadas.
- Tarea 12. Conversiones protegidas por acquireMutation/finally. Falta prueba específica de importación y duplicación concurrentes.
- Tarea 13. Hashes SHA256 fijados para linux-x64, linux-arm64 y win32-x64 de FFmpeg b6.1.1. Preparación Linux correcta y rechazo de hash manipulado comprobados. Windows ARM64 carece de binario en la publicación y falla explícitamente. Los hashes son una referencia inicial obtenida de esa publicación, sin verificación independiente del editor.
- Tarea 15. La caché del relay se invalida ante respuestas >=400. Falta prueba de reinicio con relay en vivo.
- Tarea 16. buffer-crc32 1.0.0 directo. npm ci --ignore-scripts y carga del módulo archive comprobados.
- Tarea 17. Unidades .service.example con __REPO_DIR__ y __LAN_IP__ documentados.

## Ejecuciones realizadas

npm test. Prueba de contenedores con mover, escalar, guardar, recargar y liberar contenido. UI de contenedor abierto sin formulario de contraseña ni botón de cierre. Pruebas de servidor HTTP. Extracción ZIP hostil y rechazo de symlinks. Contención de 50 instancias. Hash alterado de FFmpeg. Instalación independiente de dependencias y empaquetado Linux x64 satisfactorios.

La aprobación final exige las pruebas pendientes anteriores y revisión de la variante por el equipo auditor. No se ha construido ni probado Windows. El empaquetado Linux debe repetirse tras los últimos cambios de interfaz antes de distribuirlo.

## Revisión r2

- R1 corregido. Los enlaces relativos importados se registran solo para las extensiones de la lista multimedia/documento de open-original. ZIP con innocent.txt, photo.jpg, payload.hta y shortcut.lnk comprobado: solo photo.jpg queda registrado. Los demás carecen de entrada para la resolución del enlace y requieren volver a enlazarlos.
- R2 corregido. npm test incluye verification/sfw-containers.test.mjs. En Node 26 el ejecutor aislado resume cinco archivos. La ejecución adicional con --test-isolation=none muestra las 18 pruebas individuales, todas correctas.
- R3 parcialmente comprobado. Se ejercitó copyCanvasSafely con una copia real y un backend iniciado sobre el origen dentro de la ventana de copia. Una petición POST /api/vaults modificó state.json. La importación rechazó el cambio y eliminó el destino.
- Empaquetado Linux x64 repetido tras los cambios de interfaz y r2, terminado correctamente.
- R3 pendiente: prueba de lanzamiento real en Windows, reinicio real de Electron con relay activo y contraste de los hashes con una copia de procedencia independiente. Descargar otra vez de la misma publicación no constituye esa confirmación independiente.
