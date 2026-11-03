// Gemeinsame Hilfsfunktionen für Eingabe, Anzeige und Verwaltung
const HS = {
  async api(pfad, { methode = 'GET', daten, admin = false, roh = false } = {}) {
    const kopf = {};
    if (daten !== undefined) kopf['Content-Type'] = 'application/json';
    if (admin) kopf['X-Admin-Passwort'] = encodeURIComponent(sessionStorage.getItem('hsAdmin') || '');
    const antwort = await fetch('/api/' + pfad, {
      method: methode,
      headers: kopf,
      body: daten !== undefined ? JSON.stringify(daten) : undefined,
      cache: 'no-store',
    });
    if (roh && antwort.ok) return antwort;
    let inhalt = {};
    try { inhalt = await antwort.json(); } catch (e) { /* leer */ }
    if (!antwort.ok) {
      const f = new Error(inhalt.fehler || 'Fehler ' + antwort.status);
      f.status = antwort.status;
      throw f;
    }
    return inhalt;
  },

  zahl(n) { return Number(n).toLocaleString('de-DE'); },

  datum(s) {
    if (!s) return '';
    const [d] = s.split(' ');
    const [j, m, t] = d.split('-');
    return `${t}.${m}.${j}`;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // gleicher Vergleichsschlüssel wie im Server
  schluessel(name) {
    return String(name || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
  },

  abstand(a, b) {
    // Levenshtein-Abstand für „Meintest du …?“
    const z = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let vorher = z[0];
      z[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = z[j];
        z[j] = Math.min(z[j] + 1, z[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1));
        vorher = tmp;
      }
    }
    return z[b.length];
  },

  aehnliche(name, liste) {
    const k = HS.schluessel(name);
    if (!k) return [];
    const grenze = Math.max(1, Math.floor(k.length / 5));
    return liste.filter(e => {
      const ek = HS.schluessel(e.name);
      if (ek === k) return true;
      if (k.length >= 4 && (ek.includes(k) || k.includes(ek))) return true;
      return HS.abstand(k, ek) <= grenze;
    }).slice(0, 6);
  },

  treffer(text, liste, max = 8) {
    const k = HS.schluessel(text);
    if (!k) return [];
    const t = liste.filter(e => HS.schluessel(e.name).includes(k));
    // zuerst Treffer am Namensanfang, dann am Wortanfang, dann mitten im Wort
    const rang = name => HS.schluessel(name).startsWith(k) ? 0
      : name.split(/[\s\-/.()]+/).some(w => HS.schluessel(w).startsWith(k)) ? 1 : 2;
    t.sort((a, b) => rang(a.name) - rang(b.name) || a.name.localeCompare(b.name, 'de'));
    return t.slice(0, max);
  },

  // Eingabefeld mit Vorschlagsliste ab 2 Zeichen
  vorschlag(input, { liste, art, aufWahl, aufNeu, neuErlaubt = true }) {
    const box = document.createElement('div');
    box.className = 'vorschlaege';
    box.hidden = true;
    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(box);
    input.setAttribute('autocomplete', 'off');
    let eintraege = [], aktiv = -1;

    const zeigen = () => {
      const text = input.value.trim();
      if (text.length < 2) { box.hidden = true; eintraege = []; return; }
      const t = HS.treffer(text, liste());
      eintraege = t.map(e => ({ typ: 'wahl', e }));
      const exakt = t.some(e => HS.schluessel(e.name) === HS.schluessel(text));
      if (neuErlaubt && !exakt) eintraege.push({ typ: 'neu', name: text });
      aktiv = eintraege.length ? 0 : -1;
      box.innerHTML = eintraege.map((x, i) => x.typ === 'wahl'
        ? `<div class="vs" data-i="${i}">${HS.esc(x.e.name)}${x.e.anzahl !== undefined ? `<small>${x.e.anzahl} Scores</small>` : ''}</div>`
        : `<div class="vs neu" data-i="${i}">＋ ${art} neu anlegen: „${HS.esc(x.name)}“</div>`).join('')
        || `<div class="vs leer">Kein Treffer</div>`;
      markieren();
      box.hidden = false;
    };
    const markieren = () => {
      box.querySelectorAll('.vs').forEach(el => el.classList.toggle('aktiv', Number(el.dataset.i) === aktiv));
    };
    const waehlen = i => {
      const x = eintraege[i];
      if (!x) return;
      box.hidden = true;
      if (x.typ === 'wahl') aufWahl(x.e); else aufNeu(x.name);
    };

    input.addEventListener('input', zeigen);
    input.addEventListener('focus', zeigen);
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    input.addEventListener('keydown', ev => {
      if (box.hidden || !eintraege.length) return;
      if (ev.key === 'ArrowDown') { aktiv = (aktiv + 1) % eintraege.length; markieren(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { aktiv = (aktiv - 1 + eintraege.length) % eintraege.length; markieren(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { waehlen(aktiv); ev.preventDefault(); }
      else if (ev.key === 'Escape') { box.hidden = true; }
    });
    box.addEventListener('pointerdown', ev => {
      const el = ev.target.closest('.vs');
      if (el && el.dataset.i !== undefined) { ev.preventDefault(); waehlen(Number(el.dataset.i)); }
    });
  },

  // einfacher Dialog, gibt den Wert der gewählten Schaltfläche zurück
  dialog(titel, html, knoepfe) {
    return new Promise(fertig => {
      const hg = document.createElement('div');
      hg.className = 'dialog-hg';
      hg.innerHTML = `<div class="dialog"><h3>${HS.esc(titel)}</h3><div class="dialog-text">${html}</div>
        <div class="dialog-knoepfe">${knoepfe.map((k, i) =>
          `<button type="button" class="${k.klasse || ''}" data-i="${i}">${HS.esc(k.text)}</button>`).join('')}</div></div>`;
      hg.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-i]');
        if (b) { hg.remove(); fertig(knoepfe[Number(b.dataset.i)].wert); }
      });
      document.body.appendChild(hg);
      hg.querySelector('button.haupt, button')?.focus();
    });
  },

  meldung(text, art = 'ok') {
    let el = document.getElementById('hs-meldung');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hs-meldung';
      document.body.appendChild(el);
    }
    el.className = art;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, art === 'fehler' ? 6000 : 3000);
  },
};
