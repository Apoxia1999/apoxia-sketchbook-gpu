# Apoxia SketchBook GPU — v3.0.0

Canvas local infinito para imágenes, vídeos, dibujos y notas, con renderizado WebGL 2, texto vectorial Scribe y Vaults cifradas. Funciona como app de escritorio Electron o en el navegador. Los datos del canvas se guardan localmente y no se incluyen en este repositorio.

## Instalar y abrir

Requiere Node.js 20 o superior y npm. Descarga o clona este repositorio y, desde su carpeta, instala las dependencias:

```bash
cd apoxia-sketchbook-gpu
npm install
```

Modo navegador:

```bash
npm run start:web
```

Abrir http://localhost:4180. Los originales, miniaturas, posiciones, notas, dibujos, texto y Vaults se guardan en `data/`.

Modo escritorio:

```bash
npm start
```

La app de escritorio utiliza un perfil llamado **Apoxia SketchBook GPU**, separado del perfil anterior. El modo escritorio habilita los enlaces a archivos locales, apertura en aplicaciones externas y backups ZIP. Su biblioteca predeterminada es distinta de la del servidor web.

Para abrir la biblioteca del navegador desde escritorio, cerrar primero su servidor y ejecutar:

```bash
APOXIA_GPU_DATA_DIR="$PWD/data" npm start
```

Solo una instancia puede escribir en una biblioteca a la vez. Consulta [DESKTOP.md](DESKTOP.md) para generar paquetes de escritorio. Los binarios de `dist/` y las bibliotecas personales de `data/` no se incluyen en Git.

Para comprobar la geometría y el índice espacial sin abrir ventanas:

```bash
npm test
```

## Qué conserva

- Canvas enorme, navegación, zoom al cursor, zoom por arrastre, encuadrado y vistas 1–5.
- Movimiento, escalado proporcional, bloqueos, eliminación, restauración y deshacer/rehacer.
- Magic Laser, selección múltiple, movimiento de grupos y controles de conexiones.
- Notas editables, enlaces, colores, temas, dibujo, goma y Scribe.
- Vídeos con reproducción al pasar el cursor y copia ligera, sonido y acceso al original.
- Vaults cifradas, cierre y apertura con contraseña, coordenadas locales y recortes.
- Persistencia, sincronización del servidor e importación/exportación ZIP en escritorio.

Estas herramientas reutilizan la lógica de la app anterior. Las imágenes y los vídeos pasan al renderizador GPU; las notas inactivas también usan atlas GPU; dibujo y Scribe mantienen sus capas especializadas. Esta es una arquitectura híbrida, no una reescritura de todas las herramientas con shaders.

En el modo normal, arrastrar sobre un área vacía crea una selección rectangular de imágenes, vídeos, notas y texto Scribe. La selección se mueve en grupo y admite deshacer. Los garabatos solo se seleccionan con Magic Laser. Espacio previsualiza el original de imágenes y vídeos o abre el lector de notas a pantalla completa, con porcentaje y posición de lectura guardada. El botón central mueve el canvas; Escape cancela el rectángulo o libera la selección.

Ctrl + arrastrar duplica fotos, vídeos, notas y textos Scribe y mueve las copias. Ctrl+C / Ctrl+V copia y pega el objeto o la selección, conservando sus propiedades; los originales de imagen y vídeo se copian sin recomprimir. Las duplicaciones admiten deshacer/rehacer y conservan la pertenencia a Vaults. Al editar texto se mantienen los atajos normales del editor. Ctrl+C con el cursor sobre una nota, un texto Scribe o una imagen copia su contenido al portapapeles del sistema (las imágenes como PNG), además de permitir pegar el objeto dentro del lienzo. El objeto bajo el cursor tiene prioridad sobre una selección anterior; si forma parte de una selección múltiple, se copia esa selección.

## Tema Paper y notas

La primera prueba visual usa un tema blanco con cuadrícula azul, notas sin cabecera y tipografía monoespaciada. El cuerpo de la nota se arrastra cuando no está en edición. Con letras de 96 píxeles o más en pantalla, la nota deja de capturar el ratón y oculta sus controles para poder dibujar entre las letras; al alejarse recupera su interacción. Al acercarla a otra nota, un magnetismo de 8 píxeles alinea el inicio del texto a la izquierda, sin modificar la posición vertical. Mantener Shift permite moverla libremente. Pulsar una nota después de dibujar cambia automáticamente a mover; no requiere Escape. Las notas conservan su sombra azul tanto en el editor como en la vista GPU. Un doble clic activa la edición y otro la desactiva; salir del editor guarda el texto. El botón del ojo oculta o restaura fondo, borde y sombra; V hace lo mismo sobre la nota bajo el cursor. El estado se guarda y admite deshacer. Copiar, bloquear y eliminar aparecen en controles flotantes al pasar el ratón. El texto legible utiliza el editor nativo también sin pasar el ratón, manteniendo su posición y nitidez. Al alejarse, la GPU muestra líneas simplificadas en lugar de letras diminutas y conserva estático el shader de las notas de gradiente, sin animar fotogramas fuera de pantalla. Las esquinas y los cuatro laterales permiten redimensionar sin controles visibles. Cerca de un punto de conexión, conectar tiene prioridad sobre redimensionar. Ambas vistas comparten márgenes y geometría, sin reservar una franja superior. El tema Paper se aplica una vez al actualizar y sigue disponible en los ajustes de temas.

## Calidad y rendimiento

Las nuevas fotos compatibles con Chromium se **copian sin recomprimir** a `data/originals/`. No se crea una copia grande reducida a 4096 px: se usa el original. Las miniaturas de 64 px y el detalle intermedio de hasta 512 px se utilizan para navegar. Al acercarse, se cargan fragmentos de 512 × 512 píxeles del original sin reducirlos; 512 es el tamaño de cada fragmento, no un límite de resolución de la foto.

Los formatos que Chromium no puede decodificar, como algunos HEIC/TIFF, conservan su archivo original y utilizan la conversión existente para poder mostrarse. Los vídeos conservan su original y la copia ligera existente de hasta 640 px y 30 segundos.

El índice espacial selecciona el contenido de la vista y un pequeño margen. A escala de miniaturas, los lotes conservan su geometría en buffers GPU: mover o hacer zoom en la cámara cambia una transformación, sin reconstruir miles de referencias por fotograma. La geometría se invalida cuando cambian las referencias, las texturas, el nivel de detalle o el área cubierta. Los atlas protegen las texturas usadas por esos buffers frente a la expulsión. Los controles DOM de las referencias se activan al interactuar con ellas; no hay miles de fotos decodificadas en elementos `<img>`. Los vídeos activos se suben como texturas; los inactivos usan su póster.

Las notas inactivas se rasterizan en workers y se conservan en atlas GPU de dos resoluciones (128 y 512 px); el texto original sigue intacto y el editor nativo se activa al interactuar o acercarse mucho. Cambiar texto, tamaño o color invalida únicamente sus texturas. La caché de detalle da prioridad a las notas que ocupan más píxeles; las notas que superan su resolución usan texto nativo, teniendo en cuenta la densidad de pantalla. Mover la cámara reutiliza los buffers, y el fondo animado se calcula en un shader sin rasterizar el texto en cada fotograma. Cada capa de notas reserva como máximo 192 MiB de atlas, adicionales a las capas de imágenes. Cerrar una Vault borra también sus texturas y descarta los trabajos pendientes de notas.

Se probó una copia aislada de la biblioteca con **1.000 notas y 7.685 imágenes**, ventana de 1440 × 1000 y GPU AMD Radeon 780M. La prueba utiliza movimientos idénticos y desactiva el límite de FPS del navegador: mide capacidad de renderizado, no la frecuencia del monitor.

| Escenario | Antes | Después |
| --- | ---: | ---: |
| Vista con texto legible | 42 FPS | 159 FPS |
| Zoom sobre las notas | 42 FPS | 217 FPS |
| Vista general de 1.000 notas | 58 FPS | 526 FPS |

Los resultados completos están en `verification/text-baseline-controlled-report.json` y `verification/text-optimized-controlled-report.json`. Se comprobaron edición y actualización de textura, arrastre, deshacer/rehacer, bloqueo y ocultar/mostrar. Las notas de prueba se guardan en `verification/text-stress-tests/`, separadas de la biblioteca principal.

El dibujo conserva todos sus puntos originales. Los garabatos cortos también disponen de niveles de detalle, coherentes con la selección de Magic Laser. Para bibliotecas con al menos 128 trazos públicos se reutilizan fragmentos rasterizados de 512 px, con un índice espacial que selecciona los trazos de cada fragmento y mantiene su orden de pintura. El nivel se rasteriza a una resolución igual o superior a la necesaria; se reconstruye al cambiar de banda de zoom. La caché limita sus superficies a 60 fragmentos con un margen de 2 px (menos de 64 MiB). Las regiones vacías no reservan superficies. Cambios de contenido, borrado, deshacer y contenido congelado invalidan la caché. Las Vaults y los trazos pendientes conservan el renderizado directo; la caché pública se vacía al entrar en ese modo y al purgar memoria privada.

La prueba aislada de dibujo añade **2.000 trazos** (líneas y garabatos de 80 puntos) a las 1.000 notas y 7.685 imágenes. El zoom general pasó de 53 a 137 FPS y el zoom cercano de 161 a 227 FPS; la navegación cercana pasó de 167 a 263 FPS. Se midió con la misma ventana, GPU y límite de FPS desactivado que en la prueba de notas. Informes: `verification/stroke-baseline-report.json` y `verification/stroke-optimized-report.json`. Se verificaron dibujo, borrado, deshacer/rehacer, visibilidad y cierre/reapertura de una Vault con un trazo. La biblioteca de prueba está separada en `verification/stroke-stress-tests/`.

Al abrir una biblioteca grande, las miniaturas públicas se empaquetan en páginas de 1.024 imágenes y se guardan en `data/tmp/gpu-preview-packs/`. La GPU reconstruye sus texturas al refrescar, pero carga estas páginas en lugar de decodificar miles de archivos individuales. La caché derivada se limita a 64 MiB y sus claves incluyen IDs y fechas/tamaños de los archivos. Se borra antes de cifrar o incorporar contenido a una Vault; nunca empaqueta imágenes pertenecientes a Vaults. Si ImageMagick no está disponible, se utilizan lotes pequeños en workers como alternativa. Los archivos públicos individuales pueden reutilizar la caché HTTP con validación; los privados siguen usando `no-store`.

La prueba con 7.690 fotos obtuvo 7,49 s al generar las páginas por primera vez y 1,75 s al refrescar con la caché lista (`verification/reload-cache-report.json`). El resultado depende del equipo y de la biblioteca. Se verificaron orientación y coordenadas de los atlas comparando muestras de píxeles, y la invalidación y bloqueo de la caché al cifrar/cerrar una Vault.

Cada capa GPU (pública y contenido de Vaults) tiene un máximo de 320 MiB de atlas: 128 MiB de miniaturas, 64 MiB de detalle intermedio y 128 MiB de fragmentos originales. Los vídeos activos, framebuffer, archivos comprimidos y decodificación temporal consumen memoria adicional. Los workers todavía decodifican temporalmente el original completo para extraer sus fragmentos, por lo que archivos gigantes pueden tardar o requerir mucha RAM. No se promete escala ilimitada ni la misma fluidez en cualquier equipo.

La importación prepara hasta cuatro imágenes por adelantado con dos workers y copia dos archivos en paralelo desde el cliente. El servidor serializa las mutaciones y guarda el estado de forma atómica; guardar el estado completo por archivo sigue siendo un coste a optimizar en bibliotecas grandes. El recorrido de limpieza de archivos privados se omite cuando no hay contenido cifrado que limpiar.

Al cerrar una Vault se terminan los workers de las capas GPU, se borran los atlas y se descartan los resultados pendientes; el contenido cerrado deja de formar parte de la escena. El almacenamiento y las comprobaciones de sesión mantienen el cifrado y las restricciones del backend anterior.

## Traer un proyecto anterior

Cerrar la app y el servidor anteriores. La versión de escritorio puede importar su backup ZIP. También puede copiar una biblioteca anterior, dejando el origen intacto:

```bash
APOXIA_IMPORT_CANVAS=/ruta/al/canvas/anterior/data npm start
```

El formato `state.json` y el formato cifrado de Vaults se conservan. Los proyectos exportados mantienen los originales y las miniaturas; la ruta de imagen grande de la app anterior es compatible con los nuevos originales.

## Verificación

`npm test` comprueba el índice espacial con 10.000 objetos, coordenadas negativas, movimiento y referencias de tamaño enorme.

Se han probado en Chromium: importar un PNG nativo, movimiento con eventos de puntero, deshacer/rehacer, escalado, bloqueo, Magic Laser, notas, dibujo, Scribe, reproducción de vídeo y persistencia tras recargar. Una Vault con una imagen original se ha cerrado y reabierto: la escena y los atlas privados quedaron vacíos y la ruta del original cerrado respondió 404. La exportación y posterior importación ZIP conservaron el estado completo del proyecto de prueba.

Electron abrió un proyecto de prueba con WebGL y habilitó las herramientas de escritorio. La importación real de 7.690 imágenes finalizó sin errores; se verificaron 21 originales por SHA-256 (`verification/real-collection.log`). La medición posterior en Chromium con ventana, una vez cargadas las miniaturas, obtuvo 6,1 ms de mediana entre fotogramas al navegar, tanto en la vista general como con detalle original; el coste CPU de la cámara fue de 0,7 y 0,9 ms respectivamente (`verification/performance-headed-report.json`). Estas cifras corresponden al equipo de prueba, no garantizan el mismo resultado en otro dispositivo. `verification/test-performance-gpu.py` mide además una sesión headless; su límite y backend gráfico pueden diferir de la ventana normal. `verification/test-retained-gpu.py` comprueba reutilización, movimiento, deshacer, visibilidad y protección de texturas en datos aislados. Los scripts de navegador requieren ChromeDriver en el puerto 9515.

Las nuevas pruebas de notas mantienen el límite de FPS del navegador y cierran su sesión automáticamente. `--uncapped` permite medir capacidad máxima y `--keep-open` deja la sesión abierta solo si se solicita explícitamente.

Los datos y capturas de prueba son locales. No se envían fotos a servicios externos.

## SVG de contornos en GPU

Añadir archivos y arrastrar al canvas aceptan SVG de contornos con segmentos rectos (M/L/H/V/Z, también relativos, líneas y polilíneas), sin rellenos y con extremos y uniones redondos. El original se conserva como un único objeto que se puede mover, escalar, bloquear, duplicar y guardar en Vaults. Los SVG con curvas, transformaciones, rellenos, efectos o estilos no soportados se rechazan con un aviso.

La geometría se prepara en un worker y se carga una sola vez en buffers GPU. Al mover o ampliar solo cambia la transformación; no se generan imágenes por fragmentos. A distancia se usa una simplificación de tolerancia 0,7 unidades, solo si el error proyectado no supera 0,45 píxeles físicos; al acercarse se utiliza la geometría original. El antialias puede diferir ligeramente del rasterizador SVG nativo. La miniatura rasterizada se usa únicamente mientras se prepara la geometría o si falta el original. Al cerrar una Vault se cancelan las cargas y se libera su geometría.

La prueba `verification/test-svg-vector.cjs` usa Playwright y una biblioteca temporal: comprueba importación, recarga, detalle, capas con imágenes, arrastre y tamaño reales, deshacer/rehacer y cancelación de cargas al cerrar Vaults. Acepta el SVG `daytime-contornos/contornos.svg` como argumento; sin argumento genera un ejemplo de prueba. `PLAYWRIGHT_MODULE` y `CHROME_BIN` permiten utilizar instalaciones existentes. Las pruebas geométricas se ejecutan con `npm test`.

Las pruebas `verification/test-hover-clipboard.cjs` y `verification/test-desktop-clipboard.cjs` verifican los atajos reales y el portapapeles del sistema en navegador y Electron con bibliotecas temporales. Requieren Playwright y sustituyen el contenido del portapapeles por sus datos de prueba. Se pueden indicar `PLAYWRIGHT_MODULE`, `CHROME_BIN` o `ELECTRON_BIN` para usar instalaciones existentes.

X elimina únicamente el objeto visible superior bajo el cursor, siguiendo las capas de notas, textos Scribe, dibujos y media y el orden de renderizado de cada capa. Supr y Retroceso siguen borrando la selección. Ctrl+V centra el objeto o el conjunto copiado en la posición del ratón, conservando la distribución del grupo y el nivel de zoom.

## Recortar imágenes con Alt

Mantén Alt sobre una imagen y arrastra un borde o una esquina para recortar. El original se muestra atenuado fuera del marco y los controles normales se ocultan temporalmente. Soltar el ratón aplica el cambio; Esc lo cancela y Ctrl+Z / Ctrl+Y permiten deshacer y rehacer. Al ampliar un borde más allá del original se restaura la imagen completa, sin recorte. Sin Alt los bordes siguen cambiando el tamaño, respetando la proporción de la parte visible.

El original no se modifica: el recorte se guarda como coordenadas normalizadas, se aplica en GPU y se conserva al duplicar, pegar, guardar y usar Vaults. Ctrl+C copia al portapapeles solo la región visible, mientras la descarga del original sigue conservando el archivo completo. Los SVG de contornos siguen siendo vectores. `npm test` comprueba la geometría; `verification/test-image-crop.cjs` verifica los gestos, píxeles, recuperación, historial, copia y persistencia en una biblioteca temporal.

Ctrl+V sobre el canvas también importa imágenes del portapapeles del sistema mediante el mismo flujo que Añadir archivos, en la posición del cursor. Una imagen copiada desde otra aplicación tiene prioridad sobre la copia interna anterior. Las copias creadas dentro del canvas conservan tamaño, recorte y selección de grupo. Pegar mientras se edita texto sigue usando el editor; los eventos de pegado no solicitados y el botón central no importan contenido. `verification/test-external-clipboard.cjs` comprueba imágenes externas, prioridad, duplicación interna y persistencia en Electron con datos temporales.
