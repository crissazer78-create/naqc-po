/* =========================================================================
   NAQC Parts/Purchases Request - sequential e-signature workflow
   No Microsoft / SMTP required. Emails go through Resend (HTTPS).
   Flow: Requestor -> Manager -> Coordinator -> (VP only if Fixed Asset or total >= $1,000)
   ========================================================================= */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/* ---------------------------------------------------------------------------
   1) CONFIG  --  edit these (or set them as environment variables on your host)
   --------------------------------------------------------------------------- */
const CONFIG = {
  // Get a free key at https://resend.com  ->  API Keys
  RESEND_API_KEY: process.env.RESEND_API_KEY || 'PASTE_YOUR_RESEND_KEY_HERE',

  // The "from" address. Until you verify your own domain in Resend, use:
  //   onboarding@resend.dev   (works immediately, fine for testing)
  FROM_EMAIL: process.env.FROM_EMAIL || 'NAQC Purchasing <onboarding@resend.dev>',

  // The public URL where this app runs. Used to build the signing links in emails.
  // Local test: http://localhost:3000   |   Deployed: https://your-app.onrender.com
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',

  PORT: process.env.PORT || 3000,

  // Coordinator dropdown -> email it routes to. Fill in the real emails.
  COORDINATORS: {
    'Steve Kennedy': process.env.COORD_STEVE || 'steve@example.com',
    'Hung Chan': process.env.COORD_HUNG || 'hung@example.com',
    'Charles Caragan': process.env.COORD_CHARLES || 'charles@example.com'
  },

  // Threshold (in dollars) that requires VP confirmation. Fixed Asset always requires VP.
  VP_THRESHOLD: 1000
};

/* ---------------------------------------------------------------------------
   2) TINY JSON DATABASE  (one file; fine for low volume)
   --------------------------------------------------------------------------- */
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ orders: {} }, null, 2));

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function token() {
  return crypto.randomBytes(18).toString('hex');
}

/* ---------------------------------------------------------------------------
   3) MONEY HELPERS
   --------------------------------------------------------------------------- */
function computeTotals(items, taxRate) {
  let subtotal = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const price = Number(it.unitPrice) || 0;
    subtotal += qty * price;
  }
  const tax = subtotal * (Number(taxRate) || 0);
  return { subtotal, tax, total: subtotal + tax };
}
const money = n => '$' + (Number(n) || 0).toFixed(2);

/* ---------------------------------------------------------------------------
   4) BUILD THE WORKFLOW STEPS for a new order
   --------------------------------------------------------------------------- */
function buildFlow(po) {
  const needsVP = po.category === 'Fixed Asset' || po.total >= CONFIG.VP_THRESHOLD;
  const steps = [
    { role: 'requestor', label: 'Requestor', name: po.requesterName, email: po.requesterEmail,
      token: token(), signed: true, signatureDataUrl: po.requestorSignature, signedDate: po.requestDate },
    { role: 'manager', label: 'Manager', name: po.managerName || '', email: po.managerEmail,
      token: token(), signed: false, signatureDataUrl: null, signedDate: null },
    { role: 'coordinator', label: 'Coordinator', name: po.coordinatorName, email: po.coordinatorEmail,
      token: token(), signed: false, signatureDataUrl: null, signedDate: null }
  ];
  if (needsVP) {
    steps.push({ role: 'vp', label: 'Vice President', name: po.vpName || '', email: po.vpEmail,
      token: token(), signed: false, signatureDataUrl: null, signedDate: null });
  }
  return steps;
}

/* ---------------------------------------------------------------------------
   5) PDF GENERATION  --  redraws the whole form each time, stamping
      whatever signatures exist so far. Mirrors the Excel layout.
   --------------------------------------------------------------------------- */
async function buildPdf(po) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 36;                 // left margin
  const R = 612 - M;            // right edge
  let y = 792 - 40;             // cursor from top
  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);

  const text = (s, x, yy, size = 9, f = font, color = black) =>
    page.drawText(String(s == null ? '' : s), { x, y: yy, size, font: f, color });
  const line = (x1, yy, x2, w = 0.7, color = rgb(0.3, 0.3, 0.3)) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const box = (x, yy, w, h, bw = 0.7) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: bw });

  // Title
  text('NAQC Parts/Purchases Request', M, y, 15, bold);
  y -= 8;
  line(M, y, R, 1.2, black);
  y -= 18;

  // CHOOSE ONE row (checkboxes)
  text('CHOOSE ONE:', M, y, 9, bold);
  const cats = ['Parts (New)', 'Parts (Replace)', 'Fixed Asset', 'General', 'Shop Supplies'];
  let cx = M + 70;
  for (const c of cats) {
    box(cx, y - 1, 8, 8, 0.7);
    if (po.category === c) { text('X', cx + 1.3, y, 8, bold); }
    text(c, cx + 12, y, 8);
    cx += 12 + font.widthOfTextAtSize(c, 8) + 16;
  }
  y -= 16;
  text('Purchasing Assigned Order Number (HMA ONLY): ' + (po.hmaOrderNumber || ''), M, y, 8, font, gray);
  y -= 18;

  // Two-column info block
  const colR = 320;
  const field = (label, value, x, yy, vWidth) => {
    text(label, x, yy, 8, bold);
    const lx = x + bold.widthOfTextAtSize(label, 8) + 4;
    text(value || '', lx, yy, 9);
    line(lx, yy - 2, x + (vWidth || 250), 0.5);
  };
  field('Requester Full Name:', po.requesterName, M, y, 270);
  field('Request Date:', po.requestDate, colR, y, 250);
  y -= 18;
  field('Order From (Vendor / Contact Info):', po.vendor, M, y, 270);
  field('Parts Needed Date:', po.partsNeededDate, colR, y, 250);
  y -= 22;

  // Vehicle block
  text('For Vehicle Repair Only:', M, y, 8, bold);
  y -= 14;
  field('YEAR:', po.vehicleYear, M, y, 120);
  field('Order Number:', po.orderNumber, colR, y, 250);
  y -= 16;
  field('MODEL:', po.vehicleModel, M, y, 120);
  text('Will Call:', colR, y, 8, bold);
  box(colR + 50, y - 1, 8, 8);
  if (po.willCall) text('X', colR + 51.3, y, 8, bold);
  y -= 16;
  field('FULL VIN:', po.vin, M, y, 270);
  y -= 22;

  // Reason
  text('REASON FOR PURCHASE (details):', M, y, 8, bold);
  y -= 13;
  const reason = String(po.reason || '');
  const wrap = (str, max) => {
    const words = str.split(/\s+/); const lines = []; let cur = '';
    for (const w of words) {
      if (font.widthOfTextAtSize((cur + ' ' + w).trim(), 9) > max) { lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };
  for (const ln of wrap(reason, R - M)) { text(ln, M, y, 9); y -= 12; }
  y -= 6;

  // Line items table
  const cols = [M, M + 22, M + 120, M + 360, M + 410, M + 480, R];
  const headers = ['#', 'Part Number', 'Part Description', 'QTY', 'Unit Price', 'Price'];
  const rowH = 16;
  const tableTop = y;
  // header
  page.drawRectangle({ x: M, y: y - rowH + 4, width: R - M, height: rowH, color: rgb(0.92, 0.92, 0.92) });
  for (let i = 0; i < headers.length; i++) text(headers[i], cols[i] + 3, y - 8, 8, bold);
  y -= rowH;
  const items = (po.items || []).slice(0, 10);
  while (items.length < 10) items.push({});
  items.forEach((it, idx) => {
    const lineTotal = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
    text(idx + 1, cols[0] + 3, y - 8, 8);
    text(it.partNumber || '', cols[1] + 3, y - 8, 8);
    text(it.description || '', cols[2] + 3, y - 8, 8);
    text(it.qty != null && it.qty !== '' ? it.qty : '', cols[3] + 3, y - 8, 8);
    text(it.unitPrice ? money(it.unitPrice) : '', cols[4] + 3, y - 8, 8);
    text(lineTotal ? money(lineTotal) : '', cols[5] + 3, y - 8, 8);
    y -= rowH;
  });
  // grid
  box(M, y + 4, R - M, tableTop - y);
  // vertical lines
  for (let i = 1; i < cols.length; i++) {
    page.drawLine({ start: { x: cols[i], y: tableTop + 4 }, end: { x: cols[i], y: y + 4 }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  }
  y -= 6;

  // Totals (right aligned)
  const tlx = M + 360;
  const totalsRow = (label, val) => {
    text(label, tlx, y, 9, bold);
    const v = money(val);
    text(v, R - font.widthOfTextAtSize(v, 9), y, 9);
    y -= 14;
  };
  totalsRow('Subtotal', po.subtotal);
  totalsRow('Tax', po.tax);
  totalsRow('Total', po.total);
  y -= 4;

  text('Must include (attach): Quote, Incident Reports, Incident Photos for parts replacement.', M, y, 7, font, gray);
  y -= 10;
  text('Include ONE page Fixed Asset Report for Fixed Asset purchases only.', M, y, 7, font, gray);
  y -= 22;

  // Signature block
  const sigLabel = { requestor: 'Requestor Signature', manager: 'Manager Signature',
                     coordinator: 'Coordinator Confirmation', vp: 'Vice President Confirmation' };
  async function drawSignature(step) {
    const labelTxt = sigLabel[step.role] + ':';
    text(labelTxt, M, y, 9, bold);
    const sigX = M + 150, sigW = 200;
    // signature image or blank line
    if (step.signed && step.signatureDataUrl) {
      try {
        const b64 = step.signatureDataUrl.split(',')[1];
        const png = await doc.embedPng(Buffer.from(b64, 'base64'));
        const h = 28, w = Math.min(sigW, (png.width / png.height) * h);
        page.drawImage(png, { x: sigX, y: y - 6, width: w, height: h });
      } catch (e) { /* ignore bad image */ }
    }
    line(sigX, y - 2, sigX + sigW, 0.7);
    if (step.name) text(step.name, sigX, y - 14, 7, font, gray);
    // date
    text('Date:', sigX + sigW + 12, y, 9, bold);
    text(step.signedDate || '', sigX + sigW + 40, y, 9);
    line(sigX + sigW + 40, y - 2, R, 0.7);
    y -= 34;
  }
  for (const step of po.flow) { await drawSignature(step); }

  if (po.flow.some(s => s.role === 'vp')) {
    y -= 2;
    text('Internal Office Only (Fixed Asset / $1,000 and over) - PLEASE DO NOT FILL OUT', M, y, 7, font, gray);
  }

  // footer status
  page.drawText('Status: ' + po.status.replace(/_/g, ' '), { x: M, y: 28, size: 7, font, color: gray });
  page.drawText('PO ' + po.id, { x: R - font.widthOfTextAtSize('PO ' + po.id, 7), y: 28, size: 7, font, color: gray });

  return await doc.save();
}

/* ---------------------------------------------------------------------------
   6) EMAIL via Resend (HTTPS REST - no SMTP, no Microsoft)
   --------------------------------------------------------------------------- */
async function sendEmail({ to, subject, html, pdfBytes, pdfName }) {
  if (!CONFIG.RESEND_API_KEY || CONFIG.RESEND_API_KEY.includes('PASTE_YOUR')) {
    console.warn('[email skipped] No RESEND_API_KEY set. Would have emailed:', to, '-', subject);
    return { skipped: true };
  }
  const body = { from: CONFIG.FROM_EMAIL, to: [to], subject, html };
  if (pdfBytes) {
    body.attachments = [{ filename: pdfName || 'purchase-order.pdf',
                          content: Buffer.from(pdfBytes).toString('base64') }];
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + CONFIG.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('[email error]', res.status, t);
    throw new Error('Email send failed: ' + res.status);
  }
  return await res.json();
}

function signLink(tok) { return CONFIG.BASE_URL.replace(/\/$/, '') + '/sign/' + tok; }

/* ---------------------------------------------------------------------------
   7) WORKFLOW: email the next pending signer, or finalize
   --------------------------------------------------------------------------- */
async function advance(po) {
  const next = po.flow.find(s => !s.signed);
  if (next) {
    po.status = 'awaiting_' + next.role;
    const link = signLink(next.token);
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Hello ${next.name || next.label},</p>
        <p>A purchase order needs your signature (${next.label}).</p>
        <p><b>Requester:</b> ${po.requesterName}<br>
           <b>Vendor:</b> ${po.vendor || '-'}<br>
           <b>Total:</b> ${money(po.total)}<br>
           <b>Reason:</b> ${po.reason || '-'}</p>
        <p><a href="${link}" style="background:#1a56db;color:#fff;padding:10px 18px;
           border-radius:6px;text-decoration:none">Review &amp; Sign</a></p>
        <p style="color:#666;font-size:12px">Or paste this link: ${link}</p>
      </div>`;
    const pdfBytes = await buildPdf(po);
    await sendEmail({ to: next.email, subject: `Signature needed: PO for ${po.vendor || po.requesterName}`,
                      html, pdfBytes, pdfName: `PO-${po.id}.pdf` });
  } else {
    // All signed -> finalize, email everyone the completed PDF
    po.status = 'completed';
    const pdfBytes = await buildPdf(po);
    const recipients = [...new Set(po.flow.map(s => s.email).filter(Boolean))];
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>This purchase order is fully signed and complete.</p>
        <p><b>Requester:</b> ${po.requesterName} &nbsp; <b>Vendor:</b> ${po.vendor || '-'} &nbsp;
           <b>Total:</b> ${money(po.total)}</p>
        <p>The signed PDF is attached.</p>
      </div>`;
    for (const to of recipients) {
      await sendEmail({ to, subject: `Completed PO: ${po.vendor || po.requesterName}`,
                        html, pdfBytes, pdfName: `PO-${po.id}-SIGNED.pdf` });
    }
  }
}

/* ---------------------------------------------------------------------------
   8) WEB SERVER
   --------------------------------------------------------------------------- */
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// config for the form (coordinator dropdown)
app.get('/api/config', (req, res) => {
  res.json({ coordinators: Object.keys(CONFIG.COORDINATORS), vpThreshold: CONFIG.VP_THRESHOLD });
});

// create a new PO (requester has already signed in the browser)
app.post('/api/po', async (req, res) => {
  try {
    const b = req.body;
    const items = (b.items || []).filter(it => it.partNumber || it.description || it.qty || it.unitPrice);
    const { subtotal, tax, total } = computeTotals(items, b.taxRate);
    const id = token().slice(0, 8);
    const coordinatorEmail = CONFIG.COORDINATORS[b.coordinatorName] || b.coordinatorEmail;

    const po = {
      id,
      category: b.category,
      hmaOrderNumber: b.hmaOrderNumber,
      requesterName: b.requesterName,
      requesterEmail: b.requesterEmail,
      requestDate: b.requestDate,
      vendor: b.vendor,
      partsNeededDate: b.partsNeededDate,
      vehicleYear: b.vehicleYear, vehicleModel: b.vehicleModel, vin: b.vin,
      orderNumber: b.orderNumber, willCall: !!b.willCall,
      reason: b.reason,
      items, subtotal, tax, total, taxRate: b.taxRate,
      requestorSignature: b.requestorSignature,
      managerName: b.managerName, managerEmail: b.managerEmail,
      coordinatorName: b.coordinatorName, coordinatorEmail,
      vpName: b.vpName, vpEmail: b.vpEmail,
      status: 'created',
      createdAt: new Date().toISOString()
    };

    // validation for conditional VP
    const needsVP = po.category === 'Fixed Asset' || po.total >= CONFIG.VP_THRESHOLD;
    if (!po.requesterName || !po.requestorSignature) return res.status(400).json({ error: 'Requester name and signature are required.' });
    if (!po.managerEmail) return res.status(400).json({ error: 'Manager email is required.' });
    if (!coordinatorEmail) return res.status(400).json({ error: 'Coordinator email is required.' });
    if (needsVP && !po.vpEmail) return res.status(400).json({ error: 'VP email is required for Fixed Asset or totals of $' + CONFIG.VP_THRESHOLD + '+.' });

    po.flow = buildFlow(po);
    await advance(po); // emails the manager (first pending step)

    const db = loadDB();
    db.orders[id] = po;
    saveDB(db);
    res.json({ ok: true, id, status: po.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// helper to find a PO + step by signing token
function findByToken(tok) {
  const db = loadDB();
  for (const id in db.orders) {
    const po = db.orders[id];
    const step = (po.flow || []).find(s => s.token === tok);
    if (step) return { db, po, step };
  }
  return null;
}

// signing page
app.get('/sign/:tok', (req, res) => {
  const found = findByToken(req.params.tok);
  if (!found) return res.status(404).send(page('Link not found', '<p>This signing link is invalid.</p>'));
  const { po, step } = found;
  if (step.signed) return res.send(page('Already signed', `<p>You already signed this purchase order as <b>${step.label}</b>. Thank you.</p>`));
  const current = po.flow.find(s => !s.signed);
  if (current.token !== step.token) {
    return res.send(page('Not your turn yet',
      `<p>This order is currently waiting on the <b>${current.label}</b>. You'll get an email when it's your turn.</p>`));
  }
  res.send(signPage(po, step));
});

// serve current PDF (for the preview iframe)
app.get('/pdf/:tok', async (req, res) => {
  const found = findByToken(req.params.tok);
  if (!found) return res.status(404).end();
  const bytes = await buildPdf(found.po);
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(bytes));
});

// submit a signature
app.post('/api/sign/:tok', async (req, res) => {
  try {
    const found = findByToken(req.params.tok);
    if (!found) return res.status(404).json({ error: 'Invalid link.' });
    const { db, po, step } = found;
    if (step.signed) return res.status(400).json({ error: 'Already signed.' });
    const current = po.flow.find(s => !s.signed);
    if (current.token !== step.token) return res.status(400).json({ error: 'It is not your turn to sign yet.' });
    if (!req.body.signatureDataUrl) return res.status(400).json({ error: 'Signature is required.' });

    step.signed = true;
    step.signatureDataUrl = req.body.signatureDataUrl;
    step.signedDate = new Date().toLocaleDateString('en-US');
    if (req.body.name) step.name = req.body.name;

    await advance(po);          // email next signer OR finalize
    db.orders[po.id] = po;
    saveDB(db);
    res.json({ ok: true, status: po.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* -------- small HTML helpers for server-rendered pages -------- */
function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#222}
  h1{font-size:20px}</style></head><body><h1>${title}</h1>${inner}</body></html>`;
}

function signPage(po, step) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign Purchase Order</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;background:#f3f4f6;color:#222}
  .wrap{max-width:760px;margin:0 auto;padding:16px}
  h1{font-size:20px;margin:8px 0}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:16px}
  iframe{width:100%;height:520px;border:1px solid #ddd;border-radius:8px}
  canvas{border:1px dashed #9ca3af;border-radius:8px;width:100%;height:160px;touch-action:none;background:#fff}
  label{font-weight:bold;font-size:13px;display:block;margin:10px 0 4px}
  input{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box}
  button{font-size:15px;padding:10px 16px;border:0;border-radius:8px;cursor:pointer}
  .primary{background:#1a56db;color:#fff}.ghost{background:#e5e7eb}
  .row{display:flex;gap:10px;margin-top:10px}
</style></head><body><div class="wrap">
  <h1>Signature needed: ${step.label}</h1>
  <div class="card">
    <div><b>Requester:</b> ${po.requesterName} &nbsp; | &nbsp; <b>Vendor:</b> ${po.vendor || '-'} &nbsp; | &nbsp; <b>Total:</b> ${money(po.total)}</div>
    <p style="color:#555;margin:8px 0 0">Review the document below, then sign and submit.</p>
  </div>
  <div class="card"><iframe src="/pdf/${step.token}"></iframe></div>
  <div class="card">
    <label>Your name (as it should appear)</label>
    <input id="name" value="${step.name || ''}" placeholder="Full name">
    <label>Draw your signature</label>
    <canvas id="pad"></canvas>
    <div class="row">
      <button class="ghost" id="clear">Clear</button>
      <button class="primary" id="submit">Sign &amp; Submit</button>
    </div>
    <p id="msg" style="color:#b91c1c"></p>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js"></script>
<script>
  const canvas=document.getElementById('pad');
  function fit(){const r=window.devicePixelRatio||1;canvas.width=canvas.offsetWidth*r;canvas.height=canvas.offsetHeight*r;canvas.getContext('2d').scale(r,r);}
  fit();
  const pad=new SignaturePad(canvas,{penColor:'#0b2161'});
  window.addEventListener('resize',()=>{const d=pad.toData();fit();pad.fromData(d);});
  document.getElementById('clear').onclick=()=>pad.clear();
  document.getElementById('submit').onclick=async()=>{
    const msg=document.getElementById('msg');
    if(pad.isEmpty()){msg.textContent='Please draw your signature first.';return;}
    msg.textContent='Submitting...';
    const r=await fetch('/api/sign/${step.token}',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({signatureDataUrl:pad.toDataURL('image/png'),name:document.getElementById('name').value})});
    const j=await r.json();
    if(j.ok){document.querySelector('.wrap').innerHTML='<div class="card"><h1>Thank you!</h1><p>Your signature was recorded.'+
      (j.status==='completed'?' The order is now complete and a signed copy has been emailed to everyone.':' It has been forwarded to the next approver.')+'</p></div>';}
    else{msg.textContent=j.error||'Something went wrong.';}
  };
</script></body></html>`;
}

app.listen(CONFIG.PORT, () => {
  console.log('NAQC PO workflow running on ' + CONFIG.BASE_URL + ' (port ' + CONFIG.PORT + ')');
  if (CONFIG.RESEND_API_KEY.includes('PASTE_YOUR')) {
    console.log('NOTE: No Resend key set yet - emails will be logged to the console instead of sent.');
  }
});
