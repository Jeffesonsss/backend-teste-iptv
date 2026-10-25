const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());
const PANEL_BASE = 'https://api.painelcliente.com';
const PANEL_TOKEN = process.env.PANEL_TOKEN || 'SEU_TOKEN_AQUI';
const PANEL_SECRET = process.env.PANEL_SECRET || 'SEU_SECRET_AQUI';
const ID_BOUQUET_PADRAO = [1];
const DB_FILE = './devices.json';
function loadDb(){ try{ return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){ return {}; } }
function saveDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
app.post('/gerar-teste', async (req,res)=>{
  const { deviceId } = req.body;
  if(!deviceId) return res.status(400).json({error:'deviceId obrigatorio'});
  const db = loadDb();
  if(db[deviceId]) return res.status(403).json({error:'Este aparelho ja usou o teste'});
  const h = crypto.createHash('md5').update(deviceId).digest('hex').slice(0,6);
  const username = `tst${h}`;
  const password = crypto.randomBytes(4).toString('hex');
  const url = `${PANEL_BASE}/trial_create/${PANEL_TOKEN}`;
  const payload = { secret: PANEL_SECRET, username, password, idbouquet: ID_BOUQUET_PADRAO, email: `${username}@teste.app`, notes: `deviceId:${deviceId}` };
  try{
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const json = await r.json();
    if(!json.result) return res.status(400).json({error:'Painel recusou', detalhe: json});
    db[deviceId] = { username, password, createdAt: Date.now(), panelData: json.data };
    saveDb(db);
    return res.json({ ok:true, username, password, dados: json.data });
  }catch(e){ return res.status(500).json({error:'erro painel'}); }
});
app.get('/', (req,res)=> res.send('Backend rodando'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Rodando na porta '+PORT));
