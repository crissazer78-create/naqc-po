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
    <label>Photos (optional, up to 10)</label>
    <input type="file" id="photos" accept="image/*" multiple>
    <div id="photoPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
    <div class="hint" id="photoHint"></div>
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
      <div><label>Coordinator Name *</label><input id="coordinatorName"></div>
      <div><label>Coordinator Email *</label><input id="coordinatorEmail" type="email"></div>
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

// load VP threshold from server config
fetch('/api/config').then(r=>r.json()).then(cfg=>{
  VP_THRESHOLD=cfg.vpThreshold||1000;
});

// photo upload (resize in-browser, store as compressed JPEG data URLs)
let photoData=[];
function resizeToDataURL(file){return new Promise((resolve,reject)=>{
  const img=new Image();const url=URL.createObjectURL(file);
  img.onload=()=>{URL.revokeObjectURL(url);
    const max=1100;let w=img.width,h=img.height;
    if(w>max||h>max){if(w>=h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;}}
    const c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    resolve(c.toDataURL('image/jpeg',0.72));};
  img.onerror=reject;img.src=url;});}
function renderPhotos(){const pv=$('photoPreview');pv.innerHTML='';
  photoData.forEach((d,i)=>{const wrap=document.createElement('div');wrap.style.position='relative';
    const im=document.createElement('img');im.src=d;im.style.height='56px';im.style.borderRadius='6px';im.style.border='1px solid #ccc';
    const x=document.createElement('button');x.textContent='\u00d7';x.title='Remove';
    x.style.cssText='position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:0;background:#ef4444;color:#fff;cursor:pointer;line-height:1;padding:0';
    x.onclick=()=>{photoData.splice(i,1);renderPhotos();};
    wrap.appendChild(im);wrap.appendChild(x);pv.appendChild(wrap);});
  $('photoHint').textContent=photoData.length?photoData.length+' of 10 photos attached':'';}
$('photos').addEventListener('change',async e=>{
  const files=[...e.target.files];
  for(const f of files){ if(photoData.length>=10){$('photoHint').textContent='Maximum 10 photos.';break;}
    if(!f.type.startsWith('image/'))continue;
    try{photoData.push(await resizeToDataURL(f));}catch(_){}}
  e.target.value='';renderPhotos();});

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
  if(!$('coordinatorName').value){msg.textContent='Coordinator name is required.';return;}
  if(!$('coordinatorEmail').value){msg.textContent='Coordinator email is required.';return;}
  if(pad.isEmpty()){msg.textContent='Please sign at the bottom.';return;}
  const fmt=d=>d?new Date(d).toLocaleDateString('en-US'):'';
  const payload={
    category,hmaOrderNumber:$('hmaOrderNumber').value,
    requesterName:$('requesterName').value,requesterEmail:$('requesterEmail').value,
    requestDate:fmt($('requestDate').value),partsNeededDate:fmt($('partsNeededDate').value),
    vendor:$('vendor').value,vehicleYear:$('vehicleYear').value,vehicleModel:$('vehicleModel').value,
    vin:$('vin').value,orderNumber:$('orderNumber').value,willCall:$('willCall').checked,
    reason:$('reason').value,photos:photoData,items:readItems(),taxRate:parseFloat($('taxRate').value)||0,
    requestorSignature:pad.toDataURL('image/png'),
    managerName:$('managerName').value,managerEmail:$('managerEmail').value,
    coordinatorName:$('coordinatorName').value,coordinatorEmail:$('coordinatorEmail').value,
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

  // Optional: comma-separated emails to receive copies.
  // Do NOT copy approval/signing-link emails, because each signing link is private.
  SUBMISSION_COPY_EMAILS: process.env.SUBMISSION_COPY_EMAILS || '',
  FINAL_COPY_EMAILS: process.env.FINAL_COPY_EMAILS || '',

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
const LOGO_JPG_B64 = "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";

async function buildPdf(po) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const bi   = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

  const black = rgb(0,0,0), gray = rgb(0.84,0.84,0.84), green = rgb(0.56,0.80,0.45), red = rgb(0.85,0,0);
  const M = 20, R = 592, MID = 306;
  const photos = (po.photos || []).filter(p => typeof p === 'string' && p.startsWith('data:image')).slice(0,10);
  const embedAny = async (durl) => { const b = Buffer.from(durl.split(',')[1],'base64'); return durl.includes('image/png') ? await doc.embedPng(b) : await doc.embedJpg(b); };

  const T = (s,x,y,sz,f,c)=>page.drawText(String(s==null?'':s),{x,y,size:sz,font:f||font,color:c||black});
  const line=(x1,y,x2,w)=>page.drawLine({start:{x:x1,y},end:{x:x2,y},thickness:w||0.8,color:black});
  const vline=(x,y1,y2,w)=>page.drawLine({start:{x,y:y1},end:{x,y:y2},thickness:w||0.8,color:black});
  const rect=(x,y,w,h,fill)=>page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:black,borderWidth:0.8});
  const fillRect=(x,y,w,h,fill)=>page.drawRectangle({x,y,width:w,height:h,color:fill});
  const wrap=(str,f,sz,max)=>{const ws=String(str||'').split(/\s+/);const ls=[];let c='';for(const w of ws){if(f.widthOfTextAtSize((c+' '+w).trim(),sz)>max){if(c)ls.push(c);c=w;}else c=(c+' '+w).trim();}if(c)ls.push(c);return ls.length?ls:[''];};

  let y = 770;
  const top = y;

  // Title
  const title='NAQC Parts/Purchases Request';
  T(title,(612-bold.widthOfTextAtSize(title,16))/2,y-19,16,bold);
  const tw=bold.widthOfTextAtSize(title,16); line((612-tw)/2,y-22,(612+tw)/2,1.1);
  y-=28; line(M,y,R,1);

  // CHOOSE ONE / green HMA banner
  const rowTop=y;
  fillRect(MID, y-30, R-MID, 30, green);
  T('Purchasing Assigned Order Number (HMA ONLY):', MID+4, y-11, 8, bi);
  T(po.hmaOrderNumber||'', MID+4, y-24, 9, font);
  T('CHOOSE ONE:', M+2, y-11, 8.5, bi);
  const cats=['Parts (New)','Parts (Replace)','Fixed Asset','General','Shop Supplies'];
  let cx=M+2, cyy=y-24;
  for(const c of cats){ const sel=po.category===c; const f=sel?bold:bold; const col=sel?red:black;
    T(c,cx,cyy,7.5,f,col); cx+=bold.widthOfTextAtSize(c,7.5)+4;
    if(sel){T('x',cx,cyy,7.5,bold,red); cx+=bold.widthOfTextAtSize('x',7.5)+8;} else {cx+=8;} }
  y-=30; line(M,y,R,0.8); vline(MID,rowTop,y);

  // helper: two-column labeled row
  const tworow=(h, ll, lv, rl, rv)=>{
    const rt=y;
    T(ll, M+2, y-10, 8, bi);
    if(lv){ T(lv, M+2, y-21, 9, font); }
    T(rl, MID+4, y-10, 8, bi);
    if(rv){ T(rv, MID+90, y-10, 9, font); }
    y-=h; line(M,y,R,0.8); vline(MID,rt,y);
  };
  tworow(24,'Requester  Full Name :', po.requesterName, 'Request Date :', po.requestDate);
  tworow(24,'Order From (VENDOR, CONTACT INFORMATION):', po.vendor, 'Parts Needed Date :', po.partsNeededDate);

  // For Vehicle Repair Only
  const vt=y;
  T('For Vehicle Repair Only:', M+2, y-10, 8, bi);
  T('Order Number :', MID+4, y-10, 8, bi); T(po.orderNumber||'', MID+90, y-10, 9, font);
  y-=14;
  // YEAR / MODEL / FULL VIN with gray value cells
  const grayCell=(lbl,val)=>{ fillRect(M+90,y-13,MID-(M+90),13,gray); T(lbl,M+2,y-10,8,bi); T(val||'',M+94,y-10,9,font); y-=13; line(M,y,R,0.4); };
  T('YEAR:',M+2,y-10,8,bi); fillRect(M+90,y-13,MID-(M+90),13,gray); T(po.vehicleYear||'',M+94,y-10,9,font); y-=13;
  T('MODEL:',M+2,y-10,8,bi); fillRect(M+90,y-13,MID-(M+90),13,gray); T(po.vehicleModel||'',M+94,y-10,9,font); y-=13;
  T('FULL VIN :',M+2,y-10,8,bi); fillRect(M+90,y-13,MID-(M+90),13,gray); T(po.vin||'',M+94,y-10,9,font); y-=13;
  line(M,y,R,0.8); vline(MID,vt,y);

  // Reason
  T('REASON FOR PURCHASE (DETAILS) (For Vehicle parts purchases include detailed repair description, photos, and VIN):', M+2, y-9, 6.2, bi);
  y-=11;
  for(const ln of wrap(po.reason,font,8.5,R-M-6).slice(0,3)){ T(ln,M+2,y-9,8.5,font); y-=11; }
  if (photos.length) {
    const ph = 58; let px = M+2; let shown = 0;
    for (const p of photos) {
      try { const img = await embedAny(p); const w = (img.width/img.height)*ph;
        if (px + w > R-4) break;
        page.drawImage(img,{x:px, y:y-ph-1, width:w, height:ph}); px += w+4; shown++;
      } catch(e){}
    }
    if (photos.length > shown) T('(+' + (photos.length-shown) + ' more on attached photos page)', px+2, y-ph+2, 7, ital, gray);
    y -= ph + 4;
  }
  y-=2; line(M,y,R,0.8);

  // Items table
  const cols=[M, M+26, M+150, M+360, M+418, M+498, R];
  const heads=['#','Part Number','Part Description','QTY','Unit Price','Price'];
  const rh=15, tt=y;
  fillRect(M,y-rh,R-M,rh,gray);
  for(let i=0;i<heads.length;i++){ const cw=cols[i+1]-cols[i]; const tw2=bold.widthOfTextAtSize(heads[i],8); T(heads[i], cols[i]+(cw-tw2)/2, y-11, 8, bold); }
  y-=rh;
  const items=(po.items||[]).slice(0,10); while(items.length<10) items.push({});
  const money=n=>'$'+(Number(n)||0).toFixed(2);
  items.forEach((it,idx)=>{ const lt=(Number(it.qty)||0)*(Number(it.unitPrice)||0);
    const cell=(s,ci,al)=>{ const cw=cols[ci+1]-cols[ci]; const w=font.widthOfTextAtSize(String(s),8); let x=cols[ci]+3; if(al==='c')x=cols[ci]+(cw-w)/2; T(s,x,y-11,8,idx<99?font:font); };
    cell(idx+1,0,'c'); cell(it.partNumber||'',1); cell(it.description||'',2);
    cell(it.qty!=null&&it.qty!==''?it.qty:'',3,'c'); cell(it.unitPrice?money(it.unitPrice):'',4,'c'); cell(lt?money(lt):'$0.00',5,'c');
    y-=rh; });
  rect(M,y,R-M,tt-y); for(let i=1;i<cols.length-1;i++) vline(cols[i],tt,y,0.6);
  for(let r=1;r<=10;r++) line(M,tt-rh*r,R,0.4);
  y-=4;

  // Totals box (right) + Must Include (left)
  const tlx=M+418, boxY=y;
  const trow=(lbl,val,bw)=>{ rect(tlx, y-15, R-tlx, 15, undefined); T(lbl, cols[4]+3, y-11, 8.5, bold); const v=money(val); T(v, R-font.widthOfTextAtSize(v,8.5)-3, y-11, 8.5, bold); y-=15; };
  // labels sit in the unit-price column, values in price column box
  const totRow=(lbl,val,thick)=>{ rect(cols[5], y-15, R-cols[5], 15); T(lbl, cols[4]+3, y-11, 8.5, bold); const v=money(val); T(v, R-font.widthOfTextAtSize(v,8.5)-3, y-11, 8.5, bold); if(thick){rect(cols[5],y-15,R-cols[5],15);} y-=15; };
  totRow('Subtotal', po.subtotal);
  totRow('Tax', po.tax);
  totRow('Total', po.total, true);
  // Must include text (left side)
  let my=boxY-2;
  T('Must Include (ATTACH):', M+2, my-9, 9, bold); line(M+2, my-11, M+2+bold.widthOfTextAtSize('Must Include (ATTACH):',9), 0.6); my-=14;
  T('Quote, Incident Reports, Incident Photos for PARTS REPLACEMENT', M+2, my-9, 8, bold); my-=11;
  T('Include ONE page Fixed Asset Report for Fixed Asset Purchase Request Only', M+2, my-9, 8, bold);
  y=Math.min(y, my-16);

  // Signature block
  const sigLabel={requestor:'Requestor Signature', manager:'Manager Signature', coordinator:'Coordinator Confirmation', vp:'Vice President Confirmation', coordinator_final:'Coordinator Final Confirmation'};
  async function drawSig(step){
    if(step.role==='vp'){ T('Internal Office Only  (Fixed asset/1,000 over) :', M+2, y-9, 7.5, bold); y-=9; T('PLEASE DO NOT FILL OUT', M+2, y-9, 7.5, bold); y-=14; }
    const lbl=sigLabel[step.role]||step.label; T(lbl, M+60, y, 9, bold); T(':', M+200, y, 9, bold);
    const sx=M+215, sw=170;
    if(step.signed && step.signatureDataUrl && step.signatureDataUrl.startsWith('data:image')){
      try{ const png=await doc.embedPng(Buffer.from(step.signatureDataUrl.split(',')[1],'base64')); const hh=24,ww=Math.min(sw,(png.width/png.height)*hh); page.drawImage(png,{x:sx,y:y-4,width:ww,height:hh}); }catch(e){}
    }
    line(sx,y-2,sx+sw,0.8); if(step.name) T(step.name,sx,y-12,6.5,font,gray);
    T('Date :', sx+sw+14, y, 9, bold); T(step.signedDate||'', sx+sw+48, y, 9, font); line(sx+sw+48, y-2, R-4, 0.8);
    y-=26;
  }
  y-=6;
  for(const step of po.flow){ await drawSig(step); }

  // Logo bottom-right
  try{ const lg=await doc.embedJpg(Buffer.from(LOGO_JPG_B64,'base64')); const lw=120, lh=(lg.height/lg.width)*lw; page.drawImage(lg,{x:R-lw, y:24, width:lw, height:lh}); }catch(e){}

  // Outer border + status footer
  rect(M, y-4, R-M, top-(y-4));
  page.drawText('Status: '+po.status.replace(/_/g,' '),{x:M,y:14,size:7,font,color:gray});
  page.drawText('PO '+po.id,{x:R-font.widthOfTextAtSize('PO '+po.id,7),y:14,size:7,font,color:gray});

  // Appended photo page(s) — full-size grid, 2 columns x 3 rows per page
  if (photos.length) {
    const cols2 = 2, cellW = (R - M - 14) / cols2, cellH = 215, gap = 12;
    let i = 0;
    while (i < photos.length) {
      const pg = doc.addPage([612, 792]);
      pg.drawText('Reason for Purchase — Attached Photos (PO ' + po.id + ')', { x: M, y: 760, size: 12, font: bold });
      let col = 0, ry = 740;
      for (; i < photos.length; i++) {
        try {
          const img = await embedAny(photos[i]);
          const scale = Math.min(cellW / img.width, cellH / img.height);
          const w = img.width * scale, h = img.height * scale;
          const cx = M + col * (cellW + 14) + (cellW - w) / 2;
          pg.drawImage(img, { x: cx, y: ry - h, width: w, height: h });
          pg.drawText('Photo ' + (i + 1), { x: M + col * (cellW + 14), y: ry + 3, size: 8, font, color: gray });
        } catch (e) {}
        col++;
        if (col >= cols2) { col = 0; ry -= cellH + gap; if (ry - cellH < 40) { i++; break; } }
      }
    }
  }

  return await doc.save();
}

/* ---------------------------------------------------------------------------
   6) EMAIL via Resend (HTTPS REST - no SMTP, no Microsoft)
   --------------------------------------------------------------------------- */
function emailList(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : String(value).split(/[;,]/);
  return [...new Set(arr.map(v => String(v).trim()).filter(Boolean))];
}

async function sendEmail({ to, cc, bcc, subject, html, pdfBytes, pdfName }) {
  const toList = emailList(to);
  const ccList = emailList(cc);
  const bccList = emailList(bcc);
  if (!toList.length) throw new Error('No recipient email address was provided.');

  if (!CONFIG.RESEND_API_KEY || CONFIG.RESEND_API_KEY.includes('PASTE_YOUR')) {
    console.warn('[email skipped] No RESEND_API_KEY set. Would have emailed:', toList, '-', subject);
    if (ccList.length) console.warn('  cc:', ccList);
    if (bccList.length) console.warn('  bcc:', bccList);
    return { skipped: true };
  }

  // Resend accepts multiple recipients as an array. Keep approval emails to one
  // signer, and use bcc only for non-private copies like submitted/completed PDFs.
  const body = { from: CONFIG.FROM_EMAIL, to: toList, subject, html };
  if (ccList.length) body.cc = ccList;
  if (bccList.length) body.bcc = bccList;
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
    const recipients = [...new Set([
      ...po.flow.map(s => s.email).filter(Boolean),
      ...emailList(CONFIG.FINAL_COPY_EMAILS)
    ])];
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>This purchase order is fully signed and complete.</p>
        <p><b>Requester:</b> ${po.requesterName} &nbsp; <b>Vendor:</b> ${po.vendor || '-'} &nbsp;
           <b>Total:</b> ${money(po.total)}</p>
        <p>The signed PDF is attached.</p>
      </div>`;
    await sendEmail({ to: recipients, subject: `Completed PO: ${po.vendor || po.requesterName}`,
                      html, pdfBytes, pdfName: `PO-${po.id}-SIGNED.pdf` });
  }
}

/* ---------------------------------------------------------------------------
   8) WEB SERVER
   --------------------------------------------------------------------------- */
const app = express();
app.use(express.json({ limit: '25mb' }));
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
    const coordinatorEmail = b.coordinatorEmail || CONFIG.COORDINATORS[b.coordinatorName];

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
      photos: Array.isArray(b.photos) ? b.photos.slice(0,10) : [],
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

    // Send the requester an immediate confirmation that it's been submitted
    try {
      const pdfBytes = await buildPdf(po);
      await sendEmail({
        to: po.requesterEmail,
        subject: `Submitted: PO for ${po.vendor || po.requesterName}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
          <p>Your purchase order has been submitted and sent to the Manager for signature.</p>
          <p><b>Vendor:</b> ${po.vendor || '-'} &nbsp; <b>Total:</b> ${money(po.total)}</p>
          <p>You'll receive the fully-signed PDF by email once everyone has signed. A copy as submitted is attached.</p>
        </div>`,
        bcc: CONFIG.SUBMISSION_COPY_EMAILS,
        pdfBytes, pdfName: `PO-${id}.pdf`
      });
    } catch (e) { console.error('requester confirmation failed', e.message); }

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
