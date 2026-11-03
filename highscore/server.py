#!/usr/bin/env python3
"""Saarcade Highscore-Server.

Läuft nur mit der Python-Standardbibliothek (keine Installation nötig).
Daten liegen in einer SQLite-Datei (daten/highscores.db).

Start:  py server.py            (Port 8080)
        py server.py --port 9000 --db C:\\pfad\\test.db
"""
import argparse
import csv
import hashlib
import hmac
import io
import json
import mimetypes
import os
import secrets
import socket
import sqlite3
import sys
import threading
import time
import traceback
import unicodedata
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASIS = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASIS, 'web')
DATEN = os.path.join(BASIS, 'daten')

DB_DATEI = os.path.join(DATEN, 'highscores.db')
SICHERUNGEN = os.path.join(DATEN, 'sicherungen')
SICHERUNGEN_BEHALTEN = 60          # tägliche Sicherungen, ältere werden gelöscht
RUECKGAENGIG_MINUTEN = 10          # so lange kann ein Eintrag an der Eingabe zurückgenommen werden

STANDARD_EINSTELLUNGEN = {
    'titel': 'Highscores',
    'spalten': '5',               # Kacheln nebeneinander am Beamer
    'zeilen': '4',                # so viele Reihen passen gleichzeitig auf den Beamer
    'tempo': '35',                # Scroll-Geschwindigkeit in Bildpunkten pro Sekunde
    'pause_sekunden': '5',        # Pause oben und unten
    'liste': 'wechselnd',         # Standard am Beamer: wechselnd | monat | jahr | ewig
    'detail_sekunden': '10',      # Detailanzeige schließt sich danach
    'hinweis': '',                # freier Text oben rechts am Beamer
    'qr_zeigen': '1',             # QR-Code zur Eingabe oben rechts am Beamer
    'qr_adresse': '',             # leer = aktuelle WLAN-Adresse des Notebooks automatisch
}
LISTEN = ('wechselnd', 'monat', 'jahr', 'ewig')

SCHEMA = """
CREATE TABLE IF NOT EXISTS machines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    name_key    TEXT    NOT NULL UNIQUE,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    name_key    TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id  INTEGER NOT NULL REFERENCES machines(id),
    player_id   INTEGER NOT NULL REFERENCES players(id),
    score       INTEGER NOT NULL,
    played_at   TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    undo_token  TEXT
);
CREATE INDEX IF NOT EXISTS idx_scores_machine ON scores(machine_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player  ON scores(player_id);
CREATE INDEX IF NOT EXISTS idx_scores_played  ON scores(played_at);
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"""

SCHREIBSPERRE = threading.Lock()


class Fehler(Exception):
    def __init__(self, status, meldung):
        super().__init__(meldung)
        self.status = status
        self.meldung = meldung


# ---------------------------------------------------------------- Hilfen

def jetzt():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def schluessel(name):
    """Vergleichsschlüssel: 'Jürgen K.' und 'juergen k' gelten als gleich."""
    s = name.casefold()
    for a, b in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue')):
        s = s.replace(a, b)
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if c.isalnum())


def sortierschluessel(name):
    """Alphabetisch, ein führendes 'The ' wird ignoriert (The Addams Family -> A)."""
    n = name.strip()
    if n.lower().startswith('the '):
        n = n[4:]
    return schluessel(n)


def name_bereinigen(name, art):
    name = ' '.join(str(name or '').split())[:60]
    if not schluessel(name):
        raise Fehler(400, f'Bitte einen gültigen Namen für {art} angeben.')
    return name


def zeitraum_start(liste):
    h = datetime.now()
    if liste == 'monat':
        return h.strftime('%Y-%m-01 00:00:00')
    if liste == 'jahr':
        return h.strftime('%Y-01-01 00:00:00')
    return '0000-00-00 00:00:00'


def datum_pruefen(text):
    """'2026-11-02' oder '2026-11-02 21:15:00' -> Zeitstempel. Leer = jetzt."""
    if not text:
        return jetzt()
    text = str(text).strip()
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            d = datetime.strptime(text, fmt)
            break
        except ValueError:
            continue
    else:
        raise Fehler(400, 'Ungültiges Datum.')
    if fmt == '%Y-%m-%d':
        # nur Datum: heute -> aktuelle Uhrzeit, sonst 12:00 Uhr
        d = datetime.now() if d.date() == datetime.now().date() else d.replace(hour=12)
    if d > datetime.now() + timedelta(minutes=5):
        raise Fehler(400, 'Das Datum liegt in der Zukunft.')
    return d.strftime('%Y-%m-%d %H:%M:%S')


def punkte_pruefen(wert):
    try:
        s = int(str(wert).replace('.', '').replace(',', '').replace(' ', ''))
    except ValueError:
        raise Fehler(400, 'Bitte eine gültige Punktzahl eingeben.')
    if s <= 0 or s > 9_000_000_000_000_000:
        raise Fehler(400, 'Die Punktzahl ist nicht plausibel.')
    return s


def passwort_hash(passwort, salz=None):
    salz = salz or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', passwort.encode('utf-8'), salz.encode(), 120_000).hex()
    return f'{salz}${h}'


def lokale_adressen():
    # die Adresse im aktuellen WLAN zuerst, danach weitere Netzwerkkarten
    haupt = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))       # es wird nichts gesendet
        haupt = s.getsockname()[0]
        s.close()
    except OSError:
        pass
    weitere = set()
    try:
        for a in socket.gethostbyname_ex(socket.gethostname())[2]:
            weitere.add(a)
    except OSError:
        pass
    adressen = [haupt] if haupt else []
    adressen += sorted(weitere - set(adressen))
    return [a for a in adressen if not a.startswith('127.')]


def eingabe_adresse(con, port):
    # Ziel des QR-Codes am Beamer: feste Adresse aus den Einstellungen, sonst die aktuelle WLAN-Adresse
    fest = einstellung(con, 'qr_adresse', '')
    if fest:
        return fest
    adressen = lokale_adressen()
    return f'http://{adressen[0]}:{port}/eingabe' if adressen else ''


# ---------------------------------------------------------------- Datenbank

def verbinden():
    con = sqlite3.connect(DB_DATEI, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys = ON')
    return con


def db_einrichten():
    os.makedirs(os.path.dirname(DB_DATEI), exist_ok=True)
    con = verbinden()
    con.execute('PRAGMA journal_mode = WAL')
    con.executescript(SCHEMA)
    for k, v in STANDARD_EINSTELLUNGEN.items():
        con.execute('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)', (k, v))
    con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('stand', '1')")
    con.commit()
    con.close()


def einstellung(con, key, standard=''):
    r = con.execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
    return r['value'] if r else standard


def setze_einstellung(con, key, value):
    con.execute('INSERT INTO settings(key, value) VALUES (?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value', (key, str(value)))


def stand_erhoehen(con):
    """Änderungszähler – der Beamer lädt neu, sobald er sich ändert."""
    con.execute("UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'stand'")


def finde_oder_erstelle(con, tabelle, name, art):
    name = name_bereinigen(name, art)
    key = schluessel(name)
    r = con.execute(f'SELECT id, name FROM {tabelle} WHERE name_key = ?', (key,)).fetchone()
    if r:
        return r['id'], r['name'], False
    if tabelle == 'machines':
        cur = con.execute('INSERT INTO machines(name, name_key, active, created_at) VALUES (?, ?, 1, ?)',
                          (name, key, jetzt()))
    else:
        cur = con.execute('INSERT INTO players(name, name_key, created_at) VALUES (?, ?, ?)',
                          (name, key, jetzt()))
    return cur.lastrowid, name, True


def sicherung_erstellen(erzwingen=False):
    os.makedirs(SICHERUNGEN, exist_ok=True)
    ziel = os.path.join(SICHERUNGEN, f'highscores-{datetime.now():%Y-%m-%d}.db')
    if os.path.exists(ziel) and not erzwingen:
        return ziel
    quelle = verbinden()
    kopie = sqlite3.connect(ziel)
    quelle.backup(kopie)
    kopie.close()
    quelle.close()
    dateien = sorted(f for f in os.listdir(SICHERUNGEN) if f.startswith('highscores-') and f.endswith('.db'))
    for alt in dateien[:-SICHERUNGEN_BEHALTEN]:
        try:
            os.remove(os.path.join(SICHERUNGEN, alt))
        except OSError:
            pass
    return ziel


def sicherungs_schleife():
    while True:
        try:
            sicherung_erstellen()
        except Exception as e:
            print('Sicherung fehlgeschlagen:', e)
        time.sleep(3600)


# ---------------------------------------------------------------- API

def score_zeile(r):
    return {
        'id': r['id'],
        'spieler': r['spieler'],
        'spieler_id': r['player_id'],
        'score': r['score'],
        'datum': r['played_at'],
        'neu': r['created_at'] >= (datetime.now() - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S'),
    }


def board(con, liste):
    if liste not in ('monat', 'jahr', 'ewig'):
        liste = 'ewig'
    start = zeitraum_start(liste)
    flipper = {}
    for m in con.execute('SELECT id, name FROM machines WHERE active = 1'):
        flipper[m['id']] = {'id': m['id'], 'name': m['name'], 'scores': []}
    rows = con.execute("""
        SELECT * FROM (
            SELECT s.id, s.machine_id, s.player_id, s.score, s.played_at, s.created_at,
                   p.name AS spieler,
                   ROW_NUMBER() OVER (PARTITION BY s.machine_id
                                      ORDER BY s.score DESC, s.played_at, s.id) AS platz
            FROM scores s JOIN players p ON p.id = s.player_id
            WHERE s.played_at >= ?
        ) WHERE platz <= 5
        ORDER BY machine_id, platz
    """, (start,))
    for r in rows:
        if r['machine_id'] in flipper:
            flipper[r['machine_id']]['scores'].append(score_zeile(r))
    liste_sortiert = sorted(flipper.values(), key=lambda f: (sortierschluessel(f['name']), f['name']))
    return {'liste': liste, 'start': start, 'flipper': liste_sortiert,
            'stand': int(einstellung(con, 'stand', '0'))}


def plaetze(con, machine_id, score, played_at):
    ergebnis = {}
    for liste in ('monat', 'jahr', 'ewig'):
        start = zeitraum_start(liste)
        if played_at < start:
            ergebnis[liste] = None
            continue
        r = con.execute('SELECT COUNT(*) + 1 AS platz FROM scores '
                        'WHERE machine_id = ? AND played_at >= ? AND score > ?',
                        (machine_id, start, score)).fetchone()
        n = con.execute('SELECT COUNT(*) AS n FROM scores WHERE machine_id = ? AND played_at >= ?',
                        (machine_id, start)).fetchone()
        ergebnis[liste] = {'platz': r['platz'], 'von': n['n']}
    return ergebnis


def admin_pruefen(con, handler):
    gespeichert = einstellung(con, 'admin_passwort')
    if not gespeichert:
        raise Fehler(403, 'Es ist noch kein Admin-Passwort festgelegt.')
    eingabe = unquote(handler.headers.get('X-Admin-Passwort', ''))
    salz = gespeichert.split('$')[0]
    if not eingabe or not hmac.compare_digest(passwort_hash(eingabe, salz), gespeichert):
        time.sleep(0.6)
        raise Fehler(401, 'Falsches Passwort.')


def int_param(wert, name):
    try:
        return int(wert)
    except (TypeError, ValueError):
        raise Fehler(400, f'Ungültige Angabe: {name}')


def api(methode, teile, q, d, handler):
    con = verbinden()
    try:
        return api_routen(con, methode, teile, q, d, handler)
    finally:
        con.close()


def api_routen(con, methode, teile, q, d, handler):
    t = teile + [''] * 4
    route = (methode, t[0])

    # ---------- öffentlich: lesen
    if route == ('GET', 'stand'):
        return {'stand': int(einstellung(con, 'stand', '0'))}

    if route == ('GET', 'board'):
        return board(con, q.get('liste', 'ewig'))

    if route == ('GET', 'einstellungen'):
        e = {k: einstellung(con, k, v) for k, v in STANDARD_EINSTELLUNGEN.items()}
        e['eingabe_adresse'] = eingabe_adresse(con, handler.server.server_address[1])
        return e

    if route == ('GET', 'flipper') and not t[1]:
        rows = con.execute("""SELECT m.id, m.name, m.active, COUNT(s.id) AS anzahl
                              FROM machines m LEFT JOIN scores s ON s.machine_id = m.id
                              GROUP BY m.id""").fetchall()
        liste = [dict(r) for r in rows]
        liste.sort(key=lambda f: (sortierschluessel(f['name']), f['name']))
        return liste

    if route == ('GET', 'flipper') and t[2] == 'scores':
        mid = int_param(t[1], 'Flipper')
        m = con.execute('SELECT id, name, active FROM machines WHERE id = ?', (mid,)).fetchone()
        if not m:
            raise Fehler(404, 'Flipper nicht gefunden.')
        rows = con.execute("""SELECT s.*, p.name AS spieler FROM scores s
                              JOIN players p ON p.id = s.player_id
                              WHERE s.machine_id = ?
                              ORDER BY s.score DESC, s.played_at, s.id""", (mid,)).fetchall()
        return {'flipper': dict(m), 'scores': [score_zeile(r) for r in rows]}

    if route == ('GET', 'spieler') and t[2] == 'scores':
        # bestes Ergebnis des Spielers auf jedem Flipper, mit seinem Platz in der ewigen Liste
        pid = int_param(t[1], 'Spieler')
        p = con.execute('SELECT id, name FROM players WHERE id = ?', (pid,)).fetchone()
        if not p:
            raise Fehler(404, 'Spieler nicht gefunden.')
        rows = con.execute("""
            SELECT * FROM (
                SELECT s.id, s.machine_id, s.player_id, s.score, s.played_at, s.created_at,
                       m.name AS flipper,
                       ROW_NUMBER() OVER (PARTITION BY s.machine_id
                                          ORDER BY s.score DESC, s.played_at, s.id) AS platz
                FROM scores s JOIN machines m ON m.id = s.machine_id
                WHERE m.active = 1
            ) WHERE player_id = ?
            ORDER BY platz
        """, (pid,)).fetchall()
        neu_ab = (datetime.now() - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')
        beste = {}
        for r in rows:
            if r['machine_id'] not in beste:
                beste[r['machine_id']] = {'flipper': r['flipper'], 'flipper_id': r['machine_id'],
                                          'platz': r['platz'], 'score': r['score'], 'datum': r['played_at'],
                                          'neu': r['created_at'] >= neu_ab}
        liste = sorted(beste.values(), key=lambda b: (b['platz'], sortierschluessel(b['flipper'])))
        return {'spieler': dict(p), 'eintraege': len(rows), 'bestwerte': liste}

    if route == ('GET', 'spieler'):
        rows = con.execute("""SELECT p.id, p.name, COUNT(s.id) AS anzahl
                              FROM players p LEFT JOIN scores s ON s.player_id = p.id
                              GROUP BY p.id""").fetchall()
        liste = [dict(r) for r in rows]
        liste.sort(key=lambda p: (schluessel(p['name']), p['name']))
        return liste

    if route == ('GET', 'neueste'):
        limit = min(max(int_param(q.get('limit', 10), 'limit'), 1), 50)
        rows = con.execute("""SELECT s.*, p.name AS spieler, m.name AS flipper FROM scores s
                              JOIN players p ON p.id = s.player_id
                              JOIN machines m ON m.id = s.machine_id
                              ORDER BY s.created_at DESC, s.id DESC LIMIT ?""", (limit,)).fetchall()
        return [dict(score_zeile(r), flipper=r['flipper'], eingetragen=r['created_at']) for r in rows]

    # ---------- öffentlich: Score eintragen / zurücknehmen
    if route == ('POST', 'scores'):
        score = punkte_pruefen(d.get('score'))
        played_at = datum_pruefen(d.get('datum'))
        with SCHREIBSPERRE:
            if d.get('flipper_id'):
                m = con.execute('SELECT id, name FROM machines WHERE id = ?',
                                (int_param(d['flipper_id'], 'Flipper'),)).fetchone()
                if not m:
                    raise Fehler(404, 'Flipper nicht gefunden.')
                mid, mname, m_neu = m['id'], m['name'], False
            else:
                mid, mname, m_neu = finde_oder_erstelle(con, 'machines', d.get('flipper_name'), 'den Flipper')
            if d.get('spieler_id'):
                p = con.execute('SELECT id, name FROM players WHERE id = ?',
                                (int_param(d['spieler_id'], 'Spieler'),)).fetchone()
                if not p:
                    raise Fehler(404, 'Spieler nicht gefunden.')
                pid, pname, p_neu = p['id'], p['name'], False
            else:
                pid, pname, p_neu = finde_oder_erstelle(con, 'players', d.get('spieler_name'), 'den Spieler')
            token = secrets.token_hex(12)
            cur = con.execute('INSERT INTO scores(machine_id, player_id, score, played_at, created_at, undo_token) '
                              'VALUES (?, ?, ?, ?, ?, ?)', (mid, pid, score, played_at, jetzt(), token))
            stand_erhoehen(con)
            con.commit()
        return {'id': cur.lastrowid, 'token': token, 'flipper': mname, 'flipper_id': mid,
                'spieler': pname, 'spieler_id': pid, 'score': score, 'datum': played_at,
                'neuer_flipper': m_neu, 'neuer_spieler': p_neu,
                'plaetze': plaetze(con, mid, score, played_at)}

    if route == ('DELETE', 'scores'):
        sid = int_param(t[1], 'Score')
        grenze = (datetime.now() - timedelta(minutes=RUECKGAENGIG_MINUTEN)).strftime('%Y-%m-%d %H:%M:%S')
        with SCHREIBSPERRE:
            r = con.execute('SELECT id, undo_token, created_at FROM scores WHERE id = ?', (sid,)).fetchone()
            if not r or not r['undo_token'] or not hmac.compare_digest(r['undo_token'], str(q.get('token', ''))):
                raise Fehler(403, 'Dieser Eintrag kann hier nicht zurückgenommen werden.')
            if r['created_at'] < grenze:
                raise Fehler(403, f'Zurücknehmen geht nur {RUECKGAENGIG_MINUTEN} Minuten lang. '
                                  'Bitte in der Verwaltung löschen.')
            con.execute('DELETE FROM scores WHERE id = ?', (sid,))
            stand_erhoehen(con)
            con.commit()
        return {'ok': True}

    # ---------- Admin-Passwort
    if route == ('GET', 'admin') and t[1] == 'status':
        return {'passwort_gesetzt': bool(einstellung(con, 'admin_passwort'))}

    if route == ('POST', 'admin') and t[1] == 'passwort':
        neu = str(d.get('neu', ''))
        if len(neu) < 4:
            raise Fehler(400, 'Das Passwort muss mindestens 4 Zeichen haben.')
        if einstellung(con, 'admin_passwort'):
            admin_pruefen(con, handler)
        with SCHREIBSPERRE:
            setze_einstellung(con, 'admin_passwort', passwort_hash(neu))
            con.commit()
        return {'ok': True}

    if t[0] == 'admin' or (methode == 'PUT' and t[0] == 'einstellungen'):
        admin_pruefen(con, handler)
    else:
        raise Fehler(404, 'Unbekannte Adresse.')

    # ---------- ab hier nur mit Admin-Passwort
    if route == ('PUT', 'einstellungen'):
        neu = {}
        for k, v in d.items():
            if k not in STANDARD_EINSTELLUNGEN:
                continue
            v = str(v).strip()
            if k == 'spalten':
                v = str(min(max(int_param(v, 'Spalten'), 2), 8))
            elif k == 'zeilen':
                v = str(min(max(int_param(v, 'Reihen'), 1), 8))
            elif k == 'tempo':
                v = str(min(max(int_param(v, 'Tempo'), 5), 300))
            elif k == 'pause_sekunden':
                v = str(min(max(int_param(v, 'Pause'), 0), 120))
            elif k == 'detail_sekunden':
                v = str(min(max(int_param(v, 'Detailanzeige'), 3), 300))
            elif k == 'liste' and v not in LISTEN:
                raise Fehler(400, 'Ungültige Liste.')
            elif k in ('titel', 'hinweis'):
                v = v[:80]
            elif k == 'qr_zeigen':
                v = '1' if v in ('1', 'true', 'True') else '0'
            elif k == 'qr_adresse':
                v = v[:200]
                if v and not v.startswith(('http://', 'https://')):
                    raise Fehler(400, 'Die QR-Adresse muss mit http:// oder https:// beginnen.')
            neu[k] = v
        with SCHREIBSPERRE:
            for k, v in neu.items():
                setze_einstellung(con, k, v)
            stand_erhoehen(con)
            con.commit()
        return {k: einstellung(con, k, v) for k, v in STANDARD_EINSTELLUNGEN.items()}

    sub = (methode, t[1])

    if sub == ('POST', 'login'):
        return {'ok': True}

    if sub == ('GET', 'netzwerk'):
        return {'adressen': lokale_adressen(), 'port': handler.server.server_address[1],
                'datenbank': DB_DATEI}

    if sub == ('POST', 'flipper'):
        namen = d.get('namen') or []
        angelegt, vorhanden = [], []
        with SCHREIBSPERRE:
            for n in namen:
                if not schluessel(str(n)):
                    continue
                _, name, neu = finde_oder_erstelle(con, 'machines', n, 'den Flipper')
                (angelegt if neu else vorhanden).append(name)
            stand_erhoehen(con)
            con.commit()
        return {'angelegt': angelegt, 'vorhanden': vorhanden}

    if sub in (('PUT', 'flipper'), ('PUT', 'spieler')):
        tabelle = 'machines' if t[1] == 'flipper' else 'players'
        oid = int_param(t[2], 'ID')
        with SCHREIBSPERRE:
            if 'name' in d:
                name = name_bereinigen(d['name'], 'den Namen')
                key = schluessel(name)
                r = con.execute(f'SELECT id, name FROM {tabelle} WHERE name_key = ? AND id <> ?',
                                (key, oid)).fetchone()
                if r:
                    raise Fehler(409, f'„{r["name"]}“ gibt es schon. Bitte stattdessen zusammenführen.')
                con.execute(f'UPDATE {tabelle} SET name = ?, name_key = ? WHERE id = ?', (name, key, oid))
            if 'active' in d and tabelle == 'machines':
                con.execute('UPDATE machines SET active = ? WHERE id = ?', (1 if d['active'] else 0, oid))
            stand_erhoehen(con)
            con.commit()
        return {'ok': True}

    if sub in (('DELETE', 'flipper'), ('DELETE', 'spieler')):
        tabelle, spalte = ('machines', 'machine_id') if t[1] == 'flipper' else ('players', 'player_id')
        oid = int_param(t[2], 'ID')
        with SCHREIBSPERRE:
            n = con.execute(f'SELECT COUNT(*) AS n FROM scores WHERE {spalte} = ?', (oid,)).fetchone()['n']
            if n:
                raise Fehler(409, f'Hier hängen noch {n} Scores dran. Bitte zusammenführen '
                                  '(oder Flipper deaktivieren).')
            con.execute(f'DELETE FROM {tabelle} WHERE id = ?', (oid,))
            stand_erhoehen(con)
            con.commit()
        return {'ok': True}

    if sub == ('POST', 'zusammenfuehren'):
        art = d.get('art')
        if art not in ('flipper', 'spieler'):
            raise Fehler(400, 'Ungültige Art.')
        tabelle, spalte = ('machines', 'machine_id') if art == 'flipper' else ('players', 'player_id')
        von, nach = int_param(d.get('von'), 'von'), int_param(d.get('nach'), 'nach')
        if von == nach:
            raise Fehler(400, 'Bitte zwei verschiedene Einträge auswählen.')
        with SCHREIBSPERRE:
            for oid in (von, nach):
                if not con.execute(f'SELECT 1 FROM {tabelle} WHERE id = ?', (oid,)).fetchone():
                    raise Fehler(404, 'Eintrag nicht gefunden.')
            cur = con.execute(f'UPDATE scores SET {spalte} = ? WHERE {spalte} = ?', (nach, von))
            con.execute(f'DELETE FROM {tabelle} WHERE id = ?', (von,))
            stand_erhoehen(con)
            con.commit()
        return {'ok': True, 'verschoben': cur.rowcount}

    if sub == ('GET', 'scores'):
        where, args = [], []
        if q.get('flipper_id'):
            where.append('s.machine_id = ?')
            args.append(int_param(q['flipper_id'], 'Flipper'))
        if q.get('spieler_id'):
            where.append('s.player_id = ?')
            args.append(int_param(q['spieler_id'], 'Spieler'))
        limit = min(max(int_param(q.get('limit', 300), 'limit'), 1), 5000)
        sql = ('SELECT s.*, p.name AS spieler, m.name AS flipper FROM scores s '
               'JOIN players p ON p.id = s.player_id JOIN machines m ON m.id = s.machine_id '
               + ('WHERE ' + ' AND '.join(where) if where else '')
               + ' ORDER BY s.created_at DESC, s.id DESC LIMIT ?')
        rows = con.execute(sql, args + [limit]).fetchall()
        return [dict(score_zeile(r), flipper=r['flipper'], flipper_id=r['machine_id'],
                     eingetragen=r['created_at']) for r in rows]

    if sub == ('PUT', 'scores'):
        sid = int_param(t[2], 'Score')
        felder, args = [], []
        if 'score' in d:
            felder.append('score = ?')
            args.append(punkte_pruefen(d['score']))
        if 'datum' in d:
            felder.append('played_at = ?')
            args.append(datum_pruefen(d['datum']))
        if d.get('spieler_id'):
            felder.append('player_id = ?')
            args.append(int_param(d['spieler_id'], 'Spieler'))
        if d.get('flipper_id'):
            felder.append('machine_id = ?')
            args.append(int_param(d['flipper_id'], 'Flipper'))
        if not felder:
            raise Fehler(400, 'Nichts zu ändern.')
        with SCHREIBSPERRE:
            con.execute(f'UPDATE scores SET {", ".join(felder)} WHERE id = ?', args + [sid])
            stand_erhoehen(con)
            con.commit()
        return {'ok': True}

    if sub == ('DELETE', 'scores'):
        sid = int_param(t[2], 'Score')
        with SCHREIBSPERRE:
            con.execute('DELETE FROM scores WHERE id = ?', (sid,))
            stand_erhoehen(con)
            con.commit()
        return {'ok': True}

    if sub == ('GET', 'sicherung'):
        pfad = sicherung_erstellen(erzwingen=True)
        with open(pfad, 'rb') as f:
            inhalt = f.read()
        return Datei(inhalt, 'application/octet-stream', f'highscores-{datetime.now():%Y-%m-%d_%H-%M}.db')

    if sub == ('GET', 'export'):
        rows = con.execute("""SELECT m.name AS flipper, p.name AS spieler, s.score, s.played_at, s.created_at
                              FROM scores s JOIN players p ON p.id = s.player_id
                              JOIN machines m ON m.id = s.machine_id
                              ORDER BY m.name, s.score DESC""").fetchall()
        puffer = io.StringIO()
        w = csv.writer(puffer, delimiter=';')
        w.writerow(['Flipper', 'Spieler', 'Punkte', 'Gespielt am', 'Eingetragen am'])
        for r in rows:
            w.writerow([r['flipper'], r['spieler'], r['score'], r['played_at'], r['created_at']])
        return Datei(('\ufeff' + puffer.getvalue()).encode('utf-8'), 'text/csv; charset=utf-8',
                     f'highscores-{datetime.now():%Y-%m-%d}.csv')

    raise Fehler(404, 'Unbekannte Adresse.')


class Datei:
    def __init__(self, inhalt, typ, name):
        self.inhalt, self.typ, self.name = inhalt, typ, name


# ---------------------------------------------------------------- HTTP

SEITEN = {
    '/': 'index.html',
    '/anzeige': 'anzeige.html',
    '/eingabe': 'eingabe.html',
    '/verwaltung': 'verwaltung.html',
}


class Handler(BaseHTTPRequestHandler):
    server_version = 'SaarcadeHighscore/1.0'

    def log_message(self, fmt, *args):
        pass  # keine Zeile pro Abruf; Fehler werden unten ausgegeben

    def do_GET(self):
        self.verarbeiten('GET')

    def do_POST(self):
        self.verarbeiten('POST')

    def do_PUT(self):
        self.verarbeiten('PUT')

    def do_DELETE(self):
        self.verarbeiten('DELETE')

    def verarbeiten(self, methode):
        url = urlparse(self.path)
        pfad = unquote(url.path)
        if pfad.startswith('/api/'):
            try:
                q = {k: v[0] for k, v in parse_qs(url.query).items()}
                d = {}
                if methode in ('POST', 'PUT'):
                    laenge = int(self.headers.get('Content-Length') or 0)
                    if laenge > 1_000_000:
                        raise Fehler(413, 'Anfrage zu groß.')
                    roh = self.rfile.read(laenge) if laenge else b''
                    d = json.loads(roh.decode('utf-8')) if roh else {}
                    if not isinstance(d, dict):
                        raise Fehler(400, 'Ungültige Daten.')
                teile = [x for x in pfad[5:].split('/') if x]
                ergebnis = api(methode, teile or [''], q, d, self)
                if isinstance(ergebnis, Datei):
                    self.senden(200, ergebnis.inhalt, ergebnis.typ,
                                {'Content-Disposition': f'attachment; filename="{ergebnis.name}"'})
                else:
                    self.json_senden(200, ergebnis)
            except Fehler as f:
                self.json_senden(f.status, {'fehler': f.meldung})
            except json.JSONDecodeError:
                self.json_senden(400, {'fehler': 'Ungültige Daten.'})
            except Exception as e:
                traceback.print_exc()
                self.json_senden(500, {'fehler': f'Interner Fehler: {e}'})
        elif methode == 'GET':
            self.statisch(pfad)
        else:
            self.json_senden(405, {'fehler': 'Nicht erlaubt.'})

    def statisch(self, pfad):
        datei = SEITEN.get(pfad.rstrip('/') or '/', pfad.lstrip('/'))
        voll = os.path.normpath(os.path.join(WEB, datei))
        if not voll.startswith(WEB + os.sep) or not os.path.isfile(voll):
            self.senden(404, 'Seite nicht gefunden'.encode('utf-8'), 'text/plain; charset=utf-8')
            return
        typ = mimetypes.guess_type(voll)[0] or 'application/octet-stream'
        if typ.startswith('text/') or typ in ('application/javascript', 'image/svg+xml'):
            typ += '; charset=utf-8'
        with open(voll, 'rb') as f:
            self.senden(200, f.read(), typ)

    def json_senden(self, status, daten):
        self.senden(status, json.dumps(daten, ensure_ascii=False).encode('utf-8'),
                    'application/json; charset=utf-8')

    def senden(self, status, inhalt, typ, kopf=None):
        try:
            self.send_response(status)
            self.send_header('Content-Type', typ)
            self.send_header('Content-Length', str(len(inhalt)))
            self.send_header('Cache-Control', 'no-cache')
            for k, v in (kopf or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(inhalt)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


def main():
    global DB_DATEI, SICHERUNGEN
    parser = argparse.ArgumentParser(description='Saarcade Highscore-Server')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--db', help='Pfad zur Datenbank-Datei (Standard: daten/highscores.db)')
    args = parser.parse_args()
    if args.db:
        DB_DATEI = os.path.abspath(args.db)
        SICHERUNGEN = os.path.join(os.path.dirname(DB_DATEI), 'sicherungen')

    mimetypes.add_type('application/javascript', '.js')
    db_einrichten()
    threading.Thread(target=sicherungs_schleife, daemon=True).start()

    try:
        server = ThreadingHTTPServer(('0.0.0.0', args.port), Handler)
    except OSError:
        print(f'\nPort {args.port} ist schon belegt. Läuft der Highscore-Server schon in einem anderen Fenster?')
        input('Enter drücken zum Schließen …')
        sys.exit(1)

    print('=' * 60)
    print('  Saarcade Highscore-Server läuft')
    print('=' * 60)
    print(f'  Auf diesem Rechner:   http://localhost:{args.port}')
    for a in lokale_adressen():
        print(f'  Im WLAN (Handy):      http://{a}:{args.port}/eingabe')
    print(f'  Datenbank:            {DB_DATEI}')
    print('\n  Dieses Fenster offen lassen. Beenden mit Strg+C oder Fenster schließen.')
    print('=' * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer beendet.')


if __name__ == '__main__':
    main()
