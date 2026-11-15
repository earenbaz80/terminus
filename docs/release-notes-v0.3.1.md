# Terminus 0.3.1 — Windows x64 (sin publicar)

Borrador de las notas de la próxima release. **No hay tag, ni instalador, ni hashes**: `package.json` sigue en `0.3.0` y el tag tendrá que coincidir con esa versión cuando se suba. La verificación de abajo está hecha contra el build local instalado en esta máquina, no contra un artefacto publicado.

## Cambios

- **Una búsqueda ya no pisa a la que vino después.** Con dos búsquedas seguidas, si la primera respondía más tarde que la segunda, su resultado reemplazaba al de la nueva y la página de resultados mostraba una consulta distinta de la de la barra de direcciones, sin recuperarse sola. Ahora el resultado se descarta cuando la pestaña ya no está en esa búsqueda: la consulta que ves en la barra y la que aparece en la página dejan de poder contradecirse. Medido con dos búsquedas encoladas desde la app instalada: desajuste en 7 de 7 corridas antes (dos de ellas permanentes), en 0 de 3 después. Atrás, adelante y recargar una búsqueda siguen mostrando sus resultados.
- **La búsqueda se queda en su pestaña.** Si cambiabas de pestaña mientras una búsqueda estaba en vuelo, la respuesta se descartaba y esa pestaña se quedaba cargando para siempre. Ahora la respuesta se aplica a la pestaña que lanzó la búsqueda, esté activa o no. Verificado con dos pestañas en la app instalada: con la búsqueda en vuelo en la segunda y salto a la primera, la primera sigue en el inicio y la segunda muestra sus 10 resultados al volver; y con una búsqueda en vuelo en cada pestaña, cada una termina con su propia consulta y sus 10 resultados.

## Herramientas internas del E2E instalado

No cambian lo que ves en la aplicación; son para que las suites digan la verdad cuando fallan.

- **Espera asentada.** La espera de resultados aceptaba la página con la petición todavía en vuelo, así que el paso de las chips recientes lanzaba una segunda búsqueda encima de la primera. Ahora exige el indicador de «cargando» apagado en la sección de resultados.
- **Log de las suites fallidas.** El reportero reescribía el log de cada suite en cada corrida, de modo que el diagnóstico de un fallo intermitente se perdía en la siguiente. Ahora el log de una suite que falla se copia a `failure-<suite>-<fecha>.log` y su ruta sale en consola; una corrida en verde no deja copias.
- **Sonda de foco y selección.** Las esperas que fallan registran ahora si el documento tiene el foco, el valor y la selección de la barra de direcciones y si la lista de sugerencias está desplegada.
- **Traza del buscador.** El campo del buscador de Ctrl+F queda trazado después de escribir y en cada evento posterior, con valor, selección, foco, `isTrusted` y hora, más un muestreo periódico y un registro de pulsaciones a nivel de documento; si el texto deja de coincidir, la traza se imprime en el log.

## Verificación

- `npm run lint`: correcto (tsc y eslint).
- `npm test`: **49 archivos, 274 pruebas**, todas pasan.
- `npm run desktop:build` e instalación `/S`: el `app.asar` instalado es idéntico al de `release/win-unpacked` antes de correr cualquier suite.
- Cuatro suites sobre la app instalada: `ctrl-f 5/5 · ui 11/11 · ui-de 11/11 · network 16/16`, entre 44 y 46 s en total.
- Diez cadenas completas con el reportero: 10 de 10 en verde.
- Dos pestañas: los dos escenarios descritos arriba, con 10 resultados en la pestaña correcta en ambos casos.

## Limitaciones conocidas

- **Mutación de un carácter.** Se vio dos veces antes de instrumentar («buscador» → «buscado» y «…115396» → «…115396t») en campos que rellena la propia prueba; con la traza puesta no apareció en 28 corridas. Si vuelve, el log imprime la secuencia completa.
- **`Timeout esperando el iframe example.com`** con el iframe sin crear: 1 de 12 cadenas. Es una carga de página que no ocurre, no un problema de foco.
- **Inicio sin chips recientes:** 1 de 12 cadenas.
- **Sesión guardada:** el payload de búsqueda de una pestaña inactiva puede no quedar en `termbrowser.tabs`; al restaurar, la página relanza la búsqueda sola. Observado una vez, sin investigar.
- **Cobertura de pruebas:** 43,4 % de líneas y 35,6 % de ramas (umbral del CI: 22 % y 18 %).

## Pendiente antes de publicar

1. Subir la versión a `0.3.1` en `package.json` (y `src/utils/version.ts`, que la sigue).
2. Compilar el instalador, instalarlo en limpio y repetir las suites sobre ese artefacto.
3. Escribir aquí los artefactos y los SHA-256, como en `docs/release-notes-v0.3.0.md`.
4. Publicar con el tag `v0.3.1` (el workflow de release exige que coincida con `package.json`).
