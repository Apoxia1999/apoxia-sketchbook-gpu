# Apoxia SketchBook GPU · Escritorio

## Usar la app sin instalar herramientas de desarrollo

El repositorio contiene el código fuente. Los paquetes se generan en `dist/` con los comandos de desarrollo de este documento; esa carpeta no se sube a Git.

- Linux x64: AppImage o archivo `tar.gz`. Da permiso de ejecución al AppImage, o extrae el archivo y ejecuta `apoxia-sketchbook-gpu`.
- Windows x64: ZIP con `Apoxia SketchBook GPU.exe`. Descomprímelo conservando los archivos de su carpeta. Los instaladores NSIS y el ejecutable portable se generan por separado.

Electron, Node y el procesamiento multimedia van incluidos. No necesitas iniciar un servidor, instalar Node, FFmpeg ni ImageMagick. El motor interno solo escucha en este ordenador, en un puerto gestionado automáticamente, y sus peticiones requieren una clave propia de la app.

Los binarios son para sistemas de escritorio modernos de 64 bits. No son compatibles con cualquier sistema antiguo, arquitecturas de 32 bits ni macOS. No se ha verificado su funcionamiento en un ordenador Windows en esta sesión. Los ejecutables Windows no tienen firma de distribución.

## Dónde se guarda el canvas

La aplicación guarda datos y preferencias en su carpeta de usuario, separada de la instalación. En el menú **Archivo → Carpeta del canvas** puedes abrir la carpeta exacta. En Linux suele estar bajo `~/.config/Apoxia SketchBook GPU/`; en Windows bajo `%APPDATA%/Apoxia SketchBook GPU/`.

La primera apertura crea un canvas propio. Para trasladar uno existente:

1. Cierra el servidor/app que usa el canvas de origen.
2. En **Archivo → Importar copia de un canvas…**, elige su carpeta `data`, que contiene `state.json`.
3. La app copia el canvas a una carpeta nueva y se reinicia. La carpeta de origen no se sobrescribe.

Conserva la carpeta completa: incluye `state.json`, `media`, `originals` y `vault-data`. Las preferencias de interfaz y los accesos nativos a archivos pertenecen al perfil de escritorio. Las rutas de accesos directos no se sincronizan automáticamente entre ordenadores.

No se incorpora tu canvas, tus archivos ni tus contraseñas a los paquetes que compartes. Cerrar la app termina los guardados pendientes y cierra las Vaults cifradas antes de parar el motor. Los archivos recién incorporados a una Vault cifrada se sellan al cerrar. Las Vaults que todavía no tienen contraseña siguen sin cifrar.

## Convertir una selección en acceso directo

1. Selecciona con Magic Laser uno o varios elementos.
2. Pulsa **Añadir archivo** y elige un archivo con el selector del sistema.
3. La selección queda enlazada y vuelve al modo de movimiento. Al pasar el ratón aparece un degradado cálido.
4. Un clic abre el archivo; arrastrar sigue permitiendo mover los elementos. En los modos de dibujo, goma o láser no se abre accidentalmente.

Un PDF o ebook se abre con la aplicación predeterminada del sistema. Windows abre ejecutables mediante el sistema; Linux permite lanzar AppImages y programas ELF que ya tengan permiso de ejecución. Los scripts y otros formatos se entregan al abridor predeterminado del sistema.

Se enlaza el archivo original, **no se copia ni se cifra ese archivo externo**. Si lo mueves, bórralo o cambias de ordenador, tendrás que volver a enlazarlo. La selección admite deshacer para quitar o cambiar el enlace. Dentro de una Vault, el identificador del enlace se cifra junto con su elemento; la ruta del archivo externo queda en el registro local de escritorio.

Si no hay una selección del láser, Añadir conserva la importación habitual de fotos y vídeos. En la versión del navegador los enlaces nativos no están disponibles.

## Desarrollo

```sh
npm install
npm start
```

Si tu npm bloquea los scripts de instalación de Electron:

```sh
node node_modules/electron/install.js
```

Para mantener el modo navegador:

```sh
npm run start:web
```

Para construir paquetes:

```sh
npm run dist:linux
npm run dist:win
# Instalador y ejecutable portable (Windows o Linux con Wine):
npm run dist:win:installer
```

El empaquetado descarga herramientas multimedia para cada sistema. Las descargas y resultados se excluyen de Git. No se publican los paquetes ni se suben a ningún servicio.

En Linux sin FUSE puedes ejecutar:

```sh
./Apoxia-SketchBook-2.1.0-linux-x86_64.AppImage --appimage-extract-and-run
```

El empaquetado de Windows desde Linux depende de las herramientas que electron-builder pueda obtener para ese host. Existe también un workflow de GitHub Actions para construir ambos sistemas en sus respectivos runners; ejecutar/publicar ese workflow requiere subir el proyecto a un repositorio de tu elección.

## Componentes incluidos

- Electron y Chromium: licencias incluidas en sus paquetes.
- FFmpeg y FFprobe: binarios estáticos, licencias y referencias al código fuente incluidos en `resources/tools/`. FFmpeg es un programa separado, ejecutado como proceso, y se distribuye según su licencia correspondiente.
- Fuentes Nimbus Roman y Satisfy, e iconos Lucide: avisos en `assets/`.

## Idioma / Language

En el engranaje, el selector **Idioma** permite elegir **Español** o **English**. La elección se guarda en las preferencias del ordenador y se aplica a la interfaz, ayudas, mensajes y menús de Electron. Los textos del canvas y los nombres de archivo no se traducen.

El clip permite elegir cualquier archivo: imágenes y vídeos se importan al canvas; otros archivos crean un clip vectorial con un acceso directo al archivo local. Si existe una selección del Magic Laser, se vincula el archivo a esa selección. El archivo enlazado permanece en su ubicación original.

## Copias y backups ZIP

El engranaje ofrece tres acciones en Electron:

- **Copiar archivos vinculados a DATA**: copia los archivos externos utilizados por dibujos o clips a `linked-files/` dentro de la carpeta del canvas. Los originales permanecen intactos; los accesos directos pasan a abrir las copias.
- **Exportar canvas ZIP**: incluye el estado, imágenes, vídeos, vaults y preferencias. Permite elegir si incluye también los archivos vinculados; si se incluyen, primero se copian a DATA. Sin ellos, los enlaces conservarán las rutas de este ordenador y podrían no funcionar en otro.
- **Importar canvas ZIP**: admite backups de Apoxia SketchBook, comprueba sus rutas e integridad y abre una copia en una carpeta nueva. El canvas anterior se conserva.

Las operaciones muestran un indicador circular y progreso. El ZIP se escribe y lee por partes. Durante la exportación se pausa la modificación del estado para obtener una copia consistente. Las vaults cifradas conservan su cifrado; sus imágenes y vídeos pendientes se cifran antes del backup. Los archivos externos vinculados que se copian a `linked-files/` son copias normales, sin cifrar. Las vaults antiguas con posibles enlaces deben abrirse una vez para registrar qué archivos utilizan.

## Sesión editable en la red local (desarrollo Linux)

Con Electron abierto, ejecuta `APOXIA_LAN_HOST=IP_LOCAL npm run share:lan`. El proceso imprime un enlace privado con una clave de acceso. Mantén ambos procesos abiertos; Ctrl+C detiene el acceso LAN. Se comparte el backend existente, sin abrir DATA con un segundo servidor. La clave de Electron no sale al navegador; el enlace genera una cookie de acceso. El servicio escucha únicamente en la IP indicada, puerto 8765.

Los cambios guardados se actualizan aproximadamente cada dos segundos. Cada ventana conserva su propia posición y zoom. Se aplaza la sincronización durante gestos o edición activa. Si dos ventanas editan el mismo objeto, prevalece el último guardado: no hay resolución de conflictos ni cursores compartidos. La llegada de cambios externos que afectan a la vista reinicia el historial local de deshacer para evitar restaurar datos antiguos. Las vaults cifradas mantienen su contraseña y solo se abren en una ventana a la vez. Los accesos a aplicaciones/archivos locales y los backups nativos siguen requiriendo Electron. El servicio usa HTTP en la LAN; no debe publicarse en Internet.

## Servicios independientes de Codex (este ordenador)

Las unidades `apoxia-sketchbook.service` y `apoxia-lan.service` se instalan en `~/.config/systemd/user/` y se habilitan para la sesión gráfica. Electron y el acceso LAN siguen abiertos al cerrar Codex, arrancan al iniciar sesión y se reinician si terminan. Cerrar Electron con la X oculta la ventana y mantiene el motor en segundo plano. El acceso directo Apoxia SketchBook del menú Apps vuelve a mostrarla; este comportamiento se activa mediante APOXIA_KEEP_SERVER=1 en el servicio. Detener el servicio manda una señal que guarda los cambios y cierra el backend antes de salir.

La clave del enlace se conserva en `~/.config/Apoxia SketchBook GPU/lan-access.json`, con permisos privados. No cambia al reiniciar el servicio. La IP LAN configurada es `192.168.1.229`, puerto `8765`.

Parar ambos de forma intencionada:

```sh
systemctl --user stop apoxia-lan.service apoxia-sketchbook.service
```

Volver a iniciarlos:

```sh
systemctl --user start apoxia-sketchbook.service apoxia-lan.service
```

Consultar estado:

```sh
systemctl --user status apoxia-sketchbook.service apoxia-lan.service
```

Estos servicios requieren el ordenador encendido y la sesión gráfica iniciada. Al cerrar sesión o suspender el ordenador, el canvas no estará accesible desde la LAN. Si DHCP cambia la IP de este ordenador, habrá que actualizar la configuración y el enlace.

## SFW y red local
Los contenedores SFW guardan su contenido abierto. Un canvas con Vaults cifradas debe exportarse desde la aplicación original antes de usarlo en SFW.
El acceso LAN usa HTTP sin cifrado y expone la sesión a la red local. Úsalo en redes de confianza. En otras redes, configura un proxy inverso HTTPS (Caddy o nginx) y APOXIA_LAN_HOST con la dirección LAN del proxy.
Las unidades desktop/*.service.example son plantillas. Sustituye __REPO_DIR__ por la ruta absoluta del proyecto y __LAN_IP__ por la IP local del relay.
Instala las copias sin .example en ~/.config/systemd/user/ y ejecuta systemctl --user daemon-reload antes de activarlas.
