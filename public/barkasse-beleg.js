// ====================================================================
// SAARCADE - Druckbeleg für die Barkassen-Abrechnung
// Wird von kasse.html und admin.html gemeinsam genutzt.
// ====================================================================

(function () {
    const CASH_VALUES = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
    const CHANGE_VALUES = [20, 10, 5, 2, 1, 0.5];

    function euro(amount) {
        return (parseFloat(amount) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    }

    function signed(amount) {
        const value = parseFloat(amount) || 0;
        return (value > 0 ? '+' : '') + euro(value);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function denomination(value) {
        return value >= 1 ? `${value} €` : `${Math.round(value * 100)} ct`;
    }

    function formatDate(dateString) {
        // closing_date ist ein reines Datum (YYYY-MM-DD) ohne Zeitzone
        const [y, m, d] = String(dateString).split('-');
        return `${d}.${m}.${y}`;
    }

    function countRows(values, counts) {
        return values.map(value => {
            const count = (counts || {})[String(value)] || 0;
            return `
                <tr>
                    <td>${denomination(value)}</td>
                    <td class="num">${count || ''}</td>
                    <td class="num">${count ? euro(Math.round(value * 100) * count / 100) : ''}</td>
                </tr>`;
        }).join('');
    }

    // Wechselgeld-Tabelle: die üblichen Werte plus alle weiteren, die tatsächlich gezählt wurden
    function changeValues(counts) {
        return CASH_VALUES.filter(v => CHANGE_VALUES.includes(v) || (counts || {})[String(v)]);
    }

    function formatTime(dateTime) {
        return new Date(dateTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    // Tagesübersicht: alle Abrechnungen des Tages (Schichtwechsel + Tagesabschluss)
    function dayOverview(dayClosings) {
        const list = (dayClosings || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (list.length < 2) return '';
        const sum = (key) => list.reduce((s, x) => s + (parseFloat(x[key]) || 0), 0);
        const rows = list.map(x => `
                <tr>
                    <td>${formatTime(x.created_at)}</td>
                    <td>${x.closing_type === 'shift' ? 'Schichtwechsel' : 'Tagesabschluss'}</td>
                    <td>BK-${x.id}</td>
                    <td>${escapeHtml(x.closing_name || '')}</td>
                    <td class="num">${euro(x.revenue_counted)}</td>
                    <td class="num">${euro(x.revenue_system)}</td>
                    <td class="num">${signed(x.difference)}</td>
                </tr>`).join('');
        return `
    <h2 style="margin-top: 18px;">Tagesübersicht</h2>
    <table class="count">
        <thead><tr><th>Uhrzeit</th><th>Art</th><th>Beleg</th><th>Abgerechnet von</th><th class="num">Einnahmen gezählt</th><th class="num">laut Tablet</th><th class="num">Differenz</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4">Tag gesamt</td><td class="num">${euro(sum('revenue_counted'))}</td><td class="num">${euro(sum('revenue_system'))}</td><td class="num">${signed(sum('difference'))}</td></tr></tfoot>
    </table>`;
    }

    // Baut den kompletten Beleg als HTML-Dokument (A4).
    // c.closing_type: 'shift' = Zwischenabrechnung beim Schichtwechsel, sonst Tagesabschluss (auch ältere Belege).
    // dayClosings: alle Abrechnungen des Tages (für die Tagesübersicht beim Tagesabschluss).
    function buildCashClosingReceipt(c, dayClosings) {
        const b = c.system_breakdown || {};
        const diff = parseFloat(c.difference) || 0;
        let diffNote = 'Kasse stimmt.';
        if (diff > 0) diffNote = `Überschuss von ${euro(diff)} in die Trinkgeldkasse.`;
        if (diff < 0) diffNote = `Fehlbetrag von ${euro(-diff)}.`;

        const created = new Date(c.created_at);
        const isShift = c.closing_type === 'shift';
        const fromShift = !!c.opening_source_id;
        const opening = (c.opening_total !== null && c.opening_total !== undefined) ? c.opening_total : c.change_total;
        const withdrawal = parseFloat(c.withdrawal) || 0;
        const title = isShift ? 'Zwischenabrechnung Barkasse – Schichtwechsel' : 'Abrechnung Barkasse – Tagesabschluss';

        // Rechte Spalte: Anfangsbestand bzw. Wechselgeld
        const openingBox = `
            <h2>Anfangsbestand</h2>
            <p style="margin: 0 0 10px;">${euro(opening)} – übernommen aus der Zwischenabrechnung BK-${c.opening_source_id}</p>`;
        const changeTable = (heading, totalLabel) => `
            <h2>${heading}</h2>
            <table class="count">
                <thead><tr><th>Wert</th><th class="num">Anzahl</th><th class="num">Summe</th></tr></thead>
                <tbody>${countRows(changeValues(c.change_counts), c.change_counts)}</tbody>
                <tfoot><tr><td colspan="2">${totalLabel}</td><td class="num">${euro(c.change_total)}</td></tr></tfoot>
            </table>`;
        // Abrechnungen vor dem Schichtwechsel-Umbau (ohne closing_type) behalten ihre alte Darstellung
        const legacy = !c.closing_type;
        const rightColumn = fromShift
            ? openingBox
            : (legacy
                ? changeTable('Wechselgeld', 'Wechselgeld gesamt')
                : changeTable('Anfangsbestand (Wechselgeld)', 'Anfangsbestand gesamt'));

        const revenueLabel = isShift ? 'Einnahmen dieser Schicht' : (fromShift ? 'Einnahmen letzte Schicht' : 'Tageseinnahmen');
        // Überschuss kommt in die Trinkgeldkasse und ist nicht mehr in der Kasse
        const surplus = diff > 0 ? diff : 0;
        const surplusRow = surplus ? `<tr><td>Überschuss in die Trinkgeldkasse</td><td class="num">− ${euro(surplus)}</td></tr>` : '';
        const extraRows = isShift
            ? `<tr><td colspan="2" style="height: 6px;"></td></tr>
        ${withdrawal ? `<tr><td>Entnahme</td><td class="num">− ${euro(withdrawal)}</td></tr>` : ''}
        ${surplusRow}
        <tr class="sep"><td>Übergabe an neue Schicht</td><td class="num">${euro(c.handover_total ?? ((parseFloat(c.cash_total) || 0) - withdrawal - surplus))}</td></tr>`
            : ''; // Tagesabschluss: Abschöpfen/Auffüllen des Wechselgelds erfolgt später zu Hause

        const signRows = isShift
            ? `<tr>
            <td style="width: 25%;"><strong>Übergabe (alte Schicht)</strong></td>
            <td style="width: 35%;">${escapeHtml(c.closing_name)}<div class="line">Name</div></td>
            <td><div class="line">Unterschrift</div></td>
        </tr>
        <tr>
            <td><strong>Übernahme (neue Schicht)</strong></td>
            <td>${escapeHtml(c.handover_name || '')}<div class="line">Name</div></td>
            <td><div class="line">Unterschrift</div></td>
        </tr>`
            : `<tr>
            <td style="width: 25%;"><strong>Übernahme Kasse</strong></td>
            <td style="width: 35%;">${escapeHtml(c.handover_name || '')}<div class="line">Name</div></td>
            <td><div class="line">Unterschrift</div></td>
        </tr>
        <tr>
            <td><strong>Abrechnung Kasse</strong></td>
            <td>${escapeHtml(c.closing_name)}<div class="line">Name</div></td>
            <td><div class="line">Unterschrift</div></td>
        </tr>`;

        return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Barkasse ${formatDate(c.closing_date)} - ${escapeHtml(c.event_name)}</title>
<style>
    @page { size: A4; margin: 15mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
    .head img { height: 50px; }
    h1 { font-size: 16pt; margin: 0; }
    .meta { width: 100%; margin-bottom: 14px; }
    .meta td { padding: 2px 0; }
    .cols { display: flex; gap: 20px; }
    .cols > div { flex: 1; }
    h2 { font-size: 11pt; margin: 0 0 4px; }
    table.count { width: 100%; border-collapse: collapse; }
    table.count th, table.count td { border: 1px solid #999; padding: 3px 6px; }
    table.count th { background: #eee; }
    .num { text-align: right; }
    table.count tfoot td { font-weight: bold; background: #f5f5f5; }
    table.result { width: 60%; margin: 16px 0 0 auto; border-collapse: collapse; }
    table.result td { padding: 3px 6px; }
    table.result tr.sep td { border-top: 1px solid #000; font-weight: bold; }
    .small { font-size: 9pt; color: #444; }
    .note { margin-top: 8px; text-align: right; font-weight: bold; }
    .sign { width: 100%; margin-top: 40px; border-collapse: collapse; }
    .sign td { padding: 30px 8px 4px 0; vertical-align: bottom; }
    .line { border-top: 1px solid #000; padding-top: 3px; font-size: 9pt; }
    .foot { margin-top: 25px; font-size: 8pt; color: #666; }
</style>
</head>
<body>
    <div class="head">
        <h1>${title}</h1>
        <img src="${location.origin}/Saarcade-Logo.png" alt="Saarcade e.V." onerror="this.style.display='none'">
    </div>

    <table class="meta">
        <tr><td style="width: 25%;"><strong>Veranstaltung:</strong></td><td>${escapeHtml(c.event_name)}</td>
            <td style="width: 20%;"><strong>Beleg-Nr.:</strong></td><td>BK-${c.id}</td></tr>
        <tr><td><strong>Datum:</strong></td><td>${formatDate(c.closing_date)}, ${formatTime(c.created_at)} Uhr</td>
            <td><strong>Kasse:</strong></td><td>${escapeHtml(c.bartender_name || '–')}</td></tr>
    </table>

    <div class="cols">
        <div>
            <h2>Kasse gezählt</h2>
            <table class="count">
                <thead><tr><th>Wert</th><th class="num">Anzahl</th><th class="num">Summe</th></tr></thead>
                <tbody>${countRows(CASH_VALUES, c.cash_counts)}</tbody>
                <tfoot><tr><td colspan="2">Summe Kasse gesamt</td><td class="num">${euro(c.cash_total)}</td></tr></tfoot>
            </table>
        </div>
        <div>
            ${rightColumn}
        </div>
    </div>

    <table class="result">
        <tr><td>Summe Kasse gesamt</td><td class="num">${euro(c.cash_total)}</td></tr>
        <tr><td>abzügl. ${legacy ? 'Wechselgeld' : 'Anfangsbestand'}</td><td class="num">− ${euro(opening)}</td></tr>
        <tr class="sep"><td>${revenueLabel}</td><td class="num">${euro(c.revenue_counted)}</td></tr>
        <tr><td>Einnahmen gemäß Tablet</td><td class="num">${euro(c.revenue_system)}</td></tr>
        <tr><td class="small" colspan="2">
            davon Barverkäufe ${euro(b.cash_sales_total)} (${b.cash_sales_count || 0} Buchungen)${b.voucher_sales_count ? `,
            Verzehrkarten ${euro(b.voucher_sales_total)} (${b.voucher_sales_count})` : ''}${b.voucher_refunds_count ? `, Rückgaben −${euro(b.voucher_refunds_total)} (${b.voucher_refunds_count})` : ''}
        </td></tr>
        <tr class="sep"><td>Differenz (+/-)</td><td class="num">${signed(diff)}</td></tr>
        ${extraRows}
    </table>
    <div class="note">${diffNote}</div>

    ${isShift ? '' : dayOverview(dayClosings)}

    <table class="sign">
        ${signRows}
    </table>

    <div class="foot">
        Erfasst an der Kasse am ${created.toLocaleDateString('de-DE')} um ${created.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · Saarcade e.V. Thekensystem
    </div>

    <script>window.onload = () => window.print();<\/script>
</body>
</html>`;
    }

    // Schreibt den Beleg in ein (bereits geöffnetes) Fenster und startet den Druck
    function writeCashClosingReceipt(win, closing, dayClosings) {
        win.document.open();
        win.document.write(buildCashClosingReceipt(closing, dayClosings));
        win.document.close();
    }

    // Druckt den Beleg direkt aus der aktuellen Seite (unsichtbarer Rahmen, kein Pop-up nötig)
    function printCashClosingReceipt(closing, dayClosings) {
        let frame = document.getElementById('cashClosingPrintFrame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'cashClosingPrintFrame';
            frame.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0;';
            document.body.appendChild(frame);
        }
        writeCashClosingReceipt(frame.contentWindow, closing, dayClosings);
    }

    window.buildCashClosingReceipt = buildCashClosingReceipt;
    window.writeCashClosingReceipt = writeCashClosingReceipt;
    window.printCashClosingReceipt = printCashClosingReceipt;
})();
