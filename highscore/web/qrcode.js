// Kleiner QR-Code-Erzeuger (ohne Internet), nach dem Verfahren von Project Nayuki.
// Byte-Modus, Fehlerkorrektur M, Version 1–10 (reicht für Adressen bis ca. 210 Zeichen).
const QR = (() => {
  const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // Korrektur-Bytes je Block
  const BLOECKE = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  const rohModule = v => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  };
  const datenBytes = v => Math.floor(rohModule(v) / 8) - ECC[v] * BLOECKE[v];

  const mal = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  };
  const teiler = grad => {
    const r = new Array(grad).fill(0);
    r[grad - 1] = 1;
    let wurzel = 1;
    for (let i = 0; i < grad; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = mal(r[j], wurzel);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      wurzel = mal(wurzel, 2);
    }
    return r;
  };
  const rest = (daten, t) => {
    const r = new Array(t.length).fill(0);
    for (const b of daten) {
      const f = b ^ r.shift();
      r.push(0);
      t.forEach((c, i) => { r[i] ^= mal(c, f); });
    }
    return r;
  };

  function erzeugen(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 1;
    for (; v <= 10; v++) {
      const zaehlbits = v < 10 ? 8 : 16;
      if (4 + zaehlbits + bytes.length * 8 <= datenBytes(v) * 8) break;
    }
    if (v > 10) throw new Error('Adresse zu lang für den QR-Code');

    // Bitfolge: Modus, Länge, Daten, Abschluss, Füllbytes
    const bits = [];
    const anhaengen = (wert, n) => { for (let i = n - 1; i >= 0; i--) bits.push((wert >>> i) & 1); };
    anhaengen(4, 4);
    anhaengen(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(b => anhaengen(b, 8));
    const kapazitaet = datenBytes(v) * 8;
    anhaengen(0, Math.min(4, kapazitaet - bits.length));
    anhaengen(0, (8 - bits.length % 8) % 8);
    for (let p = 0xec; bits.length < kapazitaet; p ^= 0xec ^ 0x11) anhaengen(p, 8);
    const daten = [];
    for (let i = 0; i < bits.length; i += 8) daten.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // Blöcke mit Fehlerkorrektur, verschränkt
    const anzahl = BLOECKE[v], eccLaenge = ECC[v], roh = Math.floor(rohModule(v) / 8);
    const kurze = anzahl - roh % anzahl, kurzLaenge = Math.floor(roh / anzahl);
    const t = teiler(eccLaenge);
    const bl = [];
    for (let i = 0, k = 0; i < anzahl; i++) {
      const d = daten.slice(k, k + kurzLaenge - eccLaenge + (i < kurze ? 0 : 1));
      k += d.length;
      const e = rest(d, t);
      if (i < kurze) d.push(0);
      bl.push(d.concat(e));
    }
    const folge = [];
    for (let i = 0; i < bl[0].length; i++) {
      bl.forEach((b, j) => { if (i !== kurzLaenge - eccLaenge || j >= kurze) folge.push(b[i]); });
    }

    // Raster mit Funktionsmustern
    const n = v * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fest = Array.from({ length: n }, () => new Array(n).fill(false));
    const setzen = (x, y, an) => { m[y][x] = an; fest[y][x] = true; };

    for (let i = 0; i < n; i++) { setzen(6, i, i % 2 === 0); setzen(i, 6, i % 2 === 0); }
    [[3, 3], [n - 4, 3], [3, n - 4]].forEach(([x, y]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < n && yy >= 0 && yy < n) setzen(xx, yy, d !== 2 && d !== 4);
      }
    });
    if (v > 1) {
      const na = Math.floor(v / 7) + 2;
      const schritt = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
      const pos = [6];
      for (let p = n - 7; pos.length < na; p -= schritt) pos.splice(1, 0, p);
      pos.forEach((x, i) => pos.forEach((y, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
          setzen(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const formatZeichnen = maske => {
      const d = maske;                         // Stufe M = 00
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412;
      const bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setzen(8, i, bit(i));
      setzen(8, 7, bit(6)); setzen(8, 8, bit(7)); setzen(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setzen(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setzen(n - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setzen(8, n - 15 + i, bit(i));
      setzen(8, n - 8, true);
    };
    formatZeichnen(0);
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) {
        const an = ((b >>> i) & 1) === 1, a = n - 11 + i % 3, c = Math.floor(i / 3);
        setzen(a, c, an); setzen(c, a, an);
      }
    }

    // Daten im Zickzack eintragen
    let i = 0;
    for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
      if (rechts === 6) rechts = 5;
      for (let s = 0; s < n; s++) for (let j = 0; j < 2; j++) {
        const x = rechts - j, hoch = ((rechts + 1) & 2) === 0, y = hoch ? n - 1 - s : s;
        if (!fest[y][x] && i < folge.length * 8) {
          m[y][x] = ((folge[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }

    // Maske mit den wenigsten Strafpunkten wählen
    const MASKEN = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
    ];
    const maskieren = k => {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        if (!fest[y][x] && MASKEN[k](x, y)) m[y][x] = !m[y][x];
    };
    const strafe = () => {
      let p = 0, dunkel = 0;
      for (let a = 0; a < n; a++) {
        let lz = 1, lsp = 1;
        for (let b = 1; b < n; b++) {
          if (m[a][b] === m[a][b - 1]) { lz++; if (lz === 5) p += 3; else if (lz > 5) p++; } else lz = 1;
          if (m[b][a] === m[b - 1][a]) { lsp++; if (lsp === 5) p += 3; else if (lsp > 5) p++; } else lsp = 1;
        }
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (m[y][x]) dunkel++;
        if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
      p += Math.floor(Math.abs(dunkel * 20 - n * n * 10) / (n * n)) * 10;
      return p;
    };
    let beste = 0, besteStrafe = Infinity;
    for (let k = 0; k < 8; k++) {
      maskieren(k); formatZeichnen(k);
      const s = strafe();
      if (s < besteStrafe) { beste = k; besteStrafe = s; }
      maskieren(k);
    }
    maskieren(beste); formatZeichnen(beste);
    return m;
  }

  // als SVG mit weißem Rand (4 Module)
  function svg(text) {
    const m = erzeugen(text), n = m.length, r = 4;
    let pfad = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) pfad += `M${x + r},${y + r}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * r} ${n + 2 * r}" shape-rendering="crispEdges">`
      + `<rect width="100%" height="100%" fill="#fff"/><path d="${pfad}" fill="#000"/></svg>`;
  }

  return { erzeugen, svg };
})();
