/**
 * Puerta de `npm audit` con exclusiones explícitas.
 *
 * La auditoría se queda estricta a nivel `moderate`: cualquier advisory nuevo
 * pone el job en rojo. Lo único que se permite pasar es una lista corta de
 * advisories sin arreglo disponible, cada uno con su motivo y una fecha de
 * revisión; cuando la fecha vence, la puerta vuelve a fallar aunque el advisory
 * siga igual, para que la excepción no se olvide.
 *
 * El informe entra como JSON (`npm audit --json > audit.json`), no por el exit
 * code de npm: ese código no distingue «hay un advisory excluido» de «hay uno
 * nuevo», que es justo lo que hay que separar.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Severidades que hacen fallar el job, las mismas de `--audit-level=moderate`. */
export const SEVERIDADES_QUE_FALLAN = ['moderate', 'high', 'critical'];

/**
 * Cada exclusión nombra un advisory concreto, por qué se acepta y cuándo hay que
 * volver a mirarlo. `paquete` es informativo: el identificador manda.
 */
export const AUDIT_WAIVERS = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    paquete: 'picomatch',
    motivo:
      'ReDoS por extglobs repetidos de una sola rama. La versión instalada, 4.0.7, es la última publicada, así que no hay a qué subir; la cadena entra por vite/vitest (tinyglobby → fdir) y por electron-builder (node-gyp), sin ejecutar código del producto con expresiones de usuario. Lo único que ofrece npm es bajar Vite de 8 a 6.2.7, que rompe el build.',
    revisar: '2027-02-01',
  },
];

/** Fecha de hoy en ISO corto, para comparar con `revisar`. */
function hoyISO(ahora) {
  return ahora.toISOString().slice(0, 10);
}

/** Advisories del informe, sin repetir entre paquetes. */
export function advisoriesDe(informe) {
  const vistas = new Map();
  for (const vulnerabilidad of Object.values(informe?.vulnerabilities ?? {})) {
    for (const via of vulnerabilidad.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const id = String(via.url ?? '').split('/').pop();
      if (!id) continue;
      if (!vistas.has(id)) {
        vistas.set(id, {
          id,
          paquete: vulnerabilidad.name ?? via.name ?? 'desconocido',
          severidad: via.severity ?? vulnerabilidad.severity ?? 'unknown',
          titulo: via.title ?? '',
        });
      }
    }
  }
  return [...vistas.values()];
}

/**
 * Decide qué hacer con el informe. Devuelve los fallos (advisories sin excluir y
 * exclusiones vencidas) y los avisos (exclusiones que ya no aplican).
 */
export function evaluarAudit(informe, { ahora = new Date(), waivers = AUDIT_WAIVERS } = {}) {
  const hoy = hoyISO(ahora);
  const advisories = advisoriesDe(informe);
  const fallos = [];
  const permitidos = [];

  // Un informe sin `vulnerabilities` es un `npm audit` que no llegó a completarse
  // (sin red, registro caído): no puede convertirse en un verde sin auditar.
  if (typeof informe?.vulnerabilities !== 'object' || informe.vulnerabilities === null) {
    fallos.push({
      tipo: 'informe',
      id: '-',
      paquete: '-',
      severidad: 'unknown',
      detalle: 'el informe no trae `vulnerabilities`: npm audit no se completó',
    });
    return { fallos, avisos: [], permitidos, advisories };
  }

  for (const advisory of advisories) {
    if (!SEVERIDADES_QUE_FALLAN.includes(advisory.severidad)) continue;
    const waiver = waivers.find((candidato) => candidato.id === advisory.id);
    if (!waiver) {
      fallos.push({
        tipo: 'advisory',
        id: advisory.id,
        paquete: advisory.paquete,
        severidad: advisory.severidad,
        detalle: advisory.titulo,
      });
      continue;
    }
    if (waiver.revisar < hoy) {
      fallos.push({
        tipo: 'vencido',
        id: advisory.id,
        paquete: advisory.paquete,
        severidad: advisory.severidad,
        detalle: `la exclusión venció el ${waiver.revisar} y hay que volver a revisarla`,
      });
      continue;
    }
    permitidos.push({ id: advisory.id, paquete: advisory.paquete, revisar: waiver.revisar });
  }

  const avisos = waivers
    .filter((waiver) => !advisories.some((advisory) => advisory.id === waiver.id))
    .map((waiver) => ({
      id: waiver.id,
      detalle: `ya no aparece en el informe: se puede borrar la exclusión de ${waiver.paquete}`,
    }));

  return { fallos, avisos, permitidos, advisories };
}

/** Texto para el log del job; una línea por hallazgo. */
export function formatear(resultado) {
  const lineas = [];
  for (const { id, paquete, severidad, detalle } of resultado.fallos) {
    lineas.push(`FALLO ${id} (${paquete}, ${severidad}): ${detalle}`);
  }
  for (const { id, paquete, revisar } of resultado.permitidos) {
    lineas.push(`EXCLUIDO ${id} (${paquete}): revisión pendiente para el ${revisar}`);
  }
  for (const { id, detalle } of resultado.avisos) {
    lineas.push(`AVISO ${id}: ${detalle}`);
  }
  if (resultado.fallos.length === 0) {
    lineas.push(
      `npm audit: ${resultado.permitidos.length} exclusiones vigentes, ningún advisory nuevo`
    );
  }
  return lineas.join('\n');
}

/** CLI: lee el informe de un fichero (o de stdin) y sale con 1 si hay fallos. */
export async function runCli(argv = [], { leer = readFileSync } = {}) {
  const ruta = argv[0];
  let texto;
  if (ruta) {
    texto = leer(ruta, 'utf8');
  } else {
    const trozos = [];
    for await (const trozo of process.stdin) trozos.push(trozo);
    texto = Buffer.concat(trozos).toString('utf8');
  }

  let informe;
  try {
    informe = JSON.parse(texto.replace(/^\uFEFF/, ''));
  } catch (error) {
    console.error(`No se pudo leer el informe de npm audit: ${error.message}`);
    return 1;
  }

  const resultado = evaluarAudit(informe);
  console.log(formatear(resultado));
  if (resultado.fallos.length > 0) {
    console.error(`::error title=npm audit::${resultado.fallos.length} hallazgo(s) que bloquean el job`);
    return 1;
  }
  return 0;
}

const ejecutadoDirectamente =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirectamente) {
  runCli(process.argv.slice(2)).then((codigo) => process.exit(codigo));
}
