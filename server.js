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

// Form page is embedded here so there is no separate /public folder to go missing.
const FORM_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NAQC Parts/Purchases Request</title>
<style>
  :root{--blue:#1a56db}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;color:#1f2937;margin:0}
  .wrap{max-width:860px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:22px;margin:6px 0 2px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#374151;margin:22px 0 8px;border-bottom:2px solid #d1d5db;padding-bottom:4px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-top:14px}
  label{font-weight:bold;font-size:12px;display:block;margin:10px 0 4px}
  input,select,textarea{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;font-family:inherit}
  textarea{min-height:60px;resize:vertical}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 16px}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
  .chip{border:1px solid #cbd5e1;border-radius:20px;padding:6px 14px;cursor:pointer;font-size:13px;user-select:none}
  .chip.sel{background:var(--blue);color:#fff;border-color:var(--blue)}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{border:1px solid #e5e7eb;padding:4px}
  th{background:#f1f5f9;font-size:11px}
  td input{border:0;padding:6px}
  .totals{margin-top:10px;margin-left:auto;width:260px}
  .totals div{display:flex;justify-content:space-between;padding:3px 0}
  .totals .total{font-weight:bold;border-top:1px solid #cbd5e1;margin-top:4px;padding-top:6px}
  canvas{border:1px dashed #9ca3af;border-radius:8px;width:100%;height:160px;touch-action:none;background:#fff}
  button{font-size:15px;padding:11px 18px;border:0;border-radius:8px;cursor:pointer}
  .primary{background:var(--blue);color:#fff}.ghost{background:#e5e7eb}
  .row{display:flex;gap:10px;align-items:center;margin-top:12px}
  .hint{color:#6b7280;font-size:12px;margin-top:4px}
  .vp{display:none}
  #msg{margin-top:12px;font-weight:bold}
  .check{display:flex;align-items:center;gap:8px}.check input{width:auto}
</style>
</head>
<body>
<div class="wrap">
  <h1>NAQC Parts/Purchases Request</h1>
  <div class="hint">Fill out the form, sign at the bottom, and submit. It will be emailed to the Manager, then the Coordinator, in order.</div>

  <div class="card">
    <h2>Category</h2>
    <div class="chips" id="cats"></div>
    <label>Purchasing Assigned Order Number (HMA only)</label>
    <input id="hmaOrderNumber" placeholder="Leave blank if N/A">
  </div>

  <div class="card">
    <h2>Request Info</h2>
    <div class="grid2">
      <div><label>Requester Full Name *</label><input id="requesterName"></div>
      <div><label>Requester Email *</label><input id="requesterEmail" type="email"></div>
      <div><label>Request Date</label><input id="requestDate" type="date"></div>
      <div><label>Parts Needed Date</label><input id="partsNeededDate" type="date"></div>
    </div>
    <label>Order From (Vendor, Contact Information)</label>
    <input id="vendor" placeholder="e.g. Home Depot">
  </div>

  <div class="card">
    <h2>For Vehicle Repair Only</h2>
    <div class="grid3">
      <div><label>Year</label><input id="vehicleYear"></div>
      <div><label>Model</label><input id="vehicleModel"></div>
      <div><label>Order Number</label><input id="orderNumber"></div>
    </div>
    <label>Full VIN</label><input id="vin">
    <div class="check" style="margin-top:10px"><input type="checkbox" id="willCall"><label style="margin:0">Will Call</label></div>
    <label>Reason for Purchase (details)</label>
    <textarea id="reason" placeholder="For vehicle parts: include detailed repair description, photos, and VIN(s)."></textarea>
  </div>

  <div class="card">
    <h2>Items</h2>
    <table>
      <thead><tr><th style="width:28px">#</th><th>Part Number</th><th>Part Description</th><th style="width:60px">QTY</th><th style="width:90px">Unit Price</th><th style="width:90px">Price</th></tr></thead>
      <tbody id="items"></tbody>
    </table>
    <div class="row" style="justify-content:space-between">
      <div><label style="display:inline">Tax rate</label>
        <input id="taxRate" style="width:90px;display:inline" value="0.0775"> <span class="hint">(e.g. 0.0775 = 7.75%)</span></div>
    </div>
    <div class="totals">
      <div><span>Subtotal</span><span id="subtotal">$0.00</span></div>
      <div><span>Tax</span><span id="tax">$0.00</span></div>
      <div class="total"><span>Total</span><span id="total">$0.00</span></div>
    </div>
  </div>

  <div class="card">
    <h2>Approval Routing</h2>
    <div class="grid2">
      <div><label>Manager Name</label><input id="managerName"></div>
      <div><label>Manager Email *</label><input id="managerEmail" type="email"></div>
      <div><label>Coordinator *</label><select id="coordinatorName"></select></div>
      <div></div>
    </div>
    <div class="vp" id="vpBlock">
      <div class="hint" style="color:#b45309;font-weight:bold">This order requires Vice President confirmation (Fixed Asset or total $1,000+).</div>
      <div class="grid2">
        <div><label>VP Name</label><input id="vpName"></div>
        <div><label>VP Email *</label><input id="vpEmail" type="email"></div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Requestor Signature</h2>
    <canvas id="pad"></canvas>
    <div class="row"><button class="ghost" id="clear">Clear</button></div>
  </div>

  <div class="row"><button class="primary" id="submit">Submit &amp; Send for Signatures</button></div>
  <div id="msg"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js"></script>
<script>
const CATS=['Parts (New)','Parts (Replace)','Fixed Asset','General','Shop Supplies'];
let category='General', VP_THRESHOLD=1000;
const $=id=>document.getElementById(id);

// category chips
const catWrap=$('cats');
CATS.forEach(c=>{const d=document.createElement('div');d.className='chip'+(c===category?' sel':'');d.textContent=c;
  d.onclick=()=>{category=c;[...catWrap.children].forEach(x=>x.classList.toggle('sel',x.textContent===c));checkVP();};
  catWrap.appendChild(d);});

// coordinator dropdown
fetch('/api/config').then(r=>r.json()).then(cfg=>{
  VP_THRESHOLD=cfg.vpThreshold||1000;
  const sel=$('coordinatorName');
  (cfg.coordinators||[]).forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);});
});

// items table
const itemsBody=$('items');
for(let i=0;i<10;i++){
  const tr=document.createElement('tr');
  tr.innerHTML='<td>'+(i+1)+'</td>'+
    '<td><input data-f="partNumber"></td>'+
    '<td><input data-f="description"></td>'+
    '<td><input data-f="qty" inputmode="decimal"></td>'+
    '<td><input data-f="unitPrice" inputmode="decimal"></td>'+
    '<td class="lineTotal">$0.00</td>';
  itemsBody.appendChild(tr);
}
function readItems(){return [...itemsBody.children].map(tr=>{
  const o={};tr.querySelectorAll('input').forEach(inp=>o[inp.dataset.f]=inp.value);return o;});}
function recompute(){
  let sub=0;
  [...itemsBody.children].forEach(tr=>{
    const q=parseFloat(tr.querySelector('[data-f=qty]').value)||0;
    const p=parseFloat(tr.querySelector('[data-f=unitPrice]').value)||0;
    const lt=q*p;sub+=lt;tr.querySelector('.lineTotal').textContent='$'+lt.toFixed(2);
  });
  const rate=parseFloat($('taxRate').value)||0;const tax=sub*rate;
  $('subtotal').textContent='$'+sub.toFixed(2);
  $('tax').textContent='$'+tax.toFixed(2);
  $('total').textContent='$'+(sub+tax).toFixed(2);
  checkVP(sub+tax);
}
function checkVP(total){
  if(total===undefined){const t=$('total').textContent.replace('$','');total=parseFloat(t)||0;}
  const need=category==='Fixed Asset'||total>=VP_THRESHOLD;
  $('vpBlock').style.display=need?'block':'none';
}
itemsBody.addEventListener('input',recompute);
$('taxRate').addEventListener('input',recompute);
$('requestDate').value=new Date().toISOString().slice(0,10);
recompute();

// signature pad
const canvas=$('pad');
function fit(){const r=window.devicePixelRatio||1;canvas.width=canvas.offsetWidth*r;canvas.height=canvas.offsetHeight*r;canvas.getContext('2d').scale(r,r);}
fit();const pad=new SignaturePad(canvas,{penColor:'#0b2161'});
window.addEventListener('resize',()=>{const d=pad.toData();fit();pad.fromData(d);});
$('clear').onclick=()=>pad.clear();

$('submit').onclick=async()=>{
  const msg=$('msg');msg.style.color='#b91c1c';
  if(!$('requesterName').value){msg.textContent='Requester name is required.';return;}
  if(!$('requesterEmail').value){msg.textContent='Requester email is required.';return;}
  if(!$('managerEmail').value){msg.textContent='Manager email is required.';return;}
  if(pad.isEmpty()){msg.textContent='Please sign at the bottom.';return;}
  const fmt=d=>d?new Date(d).toLocaleDateString('en-US'):'';
  const payload={
    category,hmaOrderNumber:$('hmaOrderNumber').value,
    requesterName:$('requesterName').value,requesterEmail:$('requesterEmail').value,
    requestDate:fmt($('requestDate').value),partsNeededDate:fmt($('partsNeededDate').value),
    vendor:$('vendor').value,vehicleYear:$('vehicleYear').value,vehicleModel:$('vehicleModel').value,
    vin:$('vin').value,orderNumber:$('orderNumber').value,willCall:$('willCall').checked,
    reason:$('reason').value,items:readItems(),taxRate:parseFloat($('taxRate').value)||0,
    requestorSignature:pad.toDataURL('image/png'),
    managerName:$('managerName').value,managerEmail:$('managerEmail').value,
    coordinatorName:$('coordinatorName').value,
    vpName:$('vpName').value,vpEmail:$('vpEmail').value
  };
  msg.style.color='#374151';msg.textContent='Submitting...';
  const r=await fetch('/api/po',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json();
  if(j.ok){document.querySelector('.wrap').innerHTML=
    '<div class="card"><h1>Submitted!</h1><p>Your purchase order (#'+j.id+') has been signed and emailed to the Manager for signature. '+
    'It will route automatically to the Coordinator'+($('vpBlock').style.display==='block'?', then the Vice President,':'')+' next.</p>'+
    '<p><a href="/">Submit another</a></p></div>';}
  else{msg.style.color='#b91c1c';msg.textContent=j.error||'Something went wrong.';}
};
</script>
</body>
</html>
`;

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
    // After the VP signs, route back to the coordinator for a final confirmation.
    steps.push({ role: 'coordinator_final', label: 'Coordinator (final confirmation)',
      name: po.coordinatorName, email: po.coordinatorEmail,
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
                     coordinator: 'Coordinator Confirmation', vp: 'Vice President Confirmation',
                     coordinator_final: 'Coordinator Final Confirmation' };
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

// Serve the embedded form at the root URL (robust even if /public is absent)
app.get('/', (req, res) => res.type('html').send(FORM_HTML));

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
