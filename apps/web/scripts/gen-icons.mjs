import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generador de la marca gráfica de Rinde en PNG.
 *
 * Produce los iconos de la PWA y los recursos nativos de Android sin depender
 * de un editor ni de un binario externo: la "R" es un bitmap de 5×7 escalado,
 * y el PNG se escribe a mano (zlib + CRC32). Reproducible y versionable.
 *
 *   node apps/web/scripts/gen-icons.mjs
 *
 * Las rutas se resuelven desde la ubicación de ESTE archivo, no desde el
 * directorio de trabajo: así el script da lo mismo desde dónde se invoque.
 */

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GLYPH = ["11110", "10001", "10001", "11110", "10100", "10010", "10001"];
const VERDE = [0x14, 0x7a, 0x55];
const BLANCO = [0xff, 0xff, 0xff];

function canvas(width, height) {
  const buf = Buffer.alloc(width * height * 4);
  return {
    buf,
    set(x, y, [r, g, b], a = 255) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    },
  };
}

/** Dibuja la "R" centrada, ocupando `fraction` de la altura del lienzo. */
function drawGlyph(c, width, height, fraction, color = BLANCO) {
  const cell = Math.max(1, Math.floor((height * fraction) / 7));
  const gw = cell * 5;
  const gh = cell * 7;
  const ox = Math.round((width - gw) / 2);
  const oy = Math.round((height - gh) / 2);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (GLYPH[row][col] !== "1") continue;
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          c.set(ox + col * cell + dx, oy + row * cell + dy, color);
        }
      }
    }
  }
}

/** Cuadrado de esquinas redondeadas, verde, con la R. */
function squareIcon(size, { radiusFraction = 0.22, glyphFraction = 0.5 } = {}) {
  const c = canvas(size, size);
  const radius = size * radiusFraction;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (radius > 0) {
        const cx = Math.min(Math.max(x, radius), size - radius);
        const cy = Math.min(Math.max(y, radius), size - radius);
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      }
      c.set(x, y, VERDE);
    }
  }
  drawGlyph(c, size, size, glyphFraction);
  return png(size, size, c.buf);
}

/** Círculo verde con la R. Para `ic_launcher_round`. */
function roundIcon(size) {
  const c = canvas(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - r + 0.5) ** 2 + (y - r + 0.5) ** 2 <= (r - 0.5) ** 2) c.set(x, y, VERDE);
    }
  }
  drawGlyph(c, size, size, 0.5);
  return png(size, size, c.buf);
}

/**
 * Capa de primer plano de un icono adaptativo: fondo TRANSPARENTE y la R
 * dentro de la zona segura.
 *
 * Android recorta el icono adaptativo con formas distintas según el lanzador
 * (círculo, escudo, cuadrado redondeado) y anima los bordes. De los 108 dp del
 * lienzo, solo los 66 dp centrales están garantizados. La R se dibuja al 40%
 * de la altura para quedar holgada dentro de esa zona.
 */
function adaptiveForeground(size) {
  const c = canvas(size, size);
  drawGlyph(c, size, size, 0.4);
  return png(size, size, c.buf);
}

/** Pantalla de arranque: verde con la R centrada. */
function splash(width, height) {
  const c = canvas(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) c.set(x, y, VERDE);
  const relacion = Math.min(width, height) / Math.max(width, height);
  drawGlyph(c, width, height, relacion * 0.28);
  return png(width, height, c.buf);
}

function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

// ---------------------------------------------------------------- PWA
const PUBLIC = resolve(WEB, "public");
write(`${PUBLIC}/icon-192.png`, squareIcon(192));
write(`${PUBLIC}/icon-512.png`, squareIcon(512));
// Maskable: el sistema recorta los bordes, así que el glifo va más adentro.
write(`${PUBLIC}/icon-maskable-512.png`, squareIcon(512, { radiusFraction: 0, glyphFraction: 0.4 }));

// ------------------------------------------------------------ Android
const RES = resolve(WEB, "android/app/src/main/res");
if (existsSync(RES)) {
  const densities = [["mdpi", 1], ["hdpi", 1.5], ["xhdpi", 2], ["xxhdpi", 3], ["xxxhdpi", 4]];
  for (const [name, scale] of densities) {
    write(`${RES}/mipmap-${name}/ic_launcher.png`, squareIcon(Math.round(48 * scale)));
    write(`${RES}/mipmap-${name}/ic_launcher_round.png`, roundIcon(Math.round(48 * scale)));
    write(
      `${RES}/mipmap-${name}/ic_launcher_foreground.png`,
      adaptiveForeground(Math.round(108 * scale)),
    );
  }

  const portrait = [
    ["mdpi", 320, 480], ["hdpi", 480, 800], ["xhdpi", 720, 1280],
    ["xxhdpi", 960, 1600], ["xxxhdpi", 1280, 1920],
  ];
  for (const [name, w, h] of portrait) {
    write(`${RES}/drawable-port-${name}/splash.png`, splash(w, h));
    write(`${RES}/drawable-land-${name}/splash.png`, splash(h, w));
  }
  write(`${RES}/drawable/splash.png`, splash(480, 320));

  // El fondo del icono adaptativo es el verde de la marca, no blanco.
  write(
    `${RES}/values/ic_launcher_background.xml`,
    Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
        '    <color name="ic_launcher_background">#147A55</color>\n</resources>\n',
      "utf-8",
    ),
  );
} else {
  console.log("Sin proyecto Android (android/); se generaron solo los iconos web.");
}

// -------------------------------------------- material para la ficha de Play
const PLAY = resolve(WEB, "store");
// Icono de la ficha: 512×512, sin transparencia (Play redondea las esquinas).
write(`${PLAY}/play-icon-512.png`, squareIcon(512, { radiusFraction: 0 }));
// Gráfico destacado obligatorio: 1024×500.
write(`${PLAY}/play-feature-graphic-1024x500.png`, splash(1024, 500));

console.log("Iconos generados: PWA, Android (mipmap + splash) y ficha de Play.");
