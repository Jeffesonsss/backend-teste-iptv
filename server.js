// Backend - 1 teste por aparelho usando /trial_create/{token}
// Rode: npm install express node-fetch@2
// Depois: node server.js
// Nunca coloque TOKEN/SECRET no app, só aqui no servidor

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const PANEL_BASE = 'https://api.painelcliente.com';
const PANEL_TOKEN = process.env.PANEL_TOKEN || 'SEU_TOKEN_AQUI';
const PANEL_SECRET = process.env.PANEL_SECRET || 'SEU_SECRET_AQUI';

// Opcional: IDs separados por vírgula. Sem configuração, usa todos os bouquets
// disponíveis para esta revenda, para incluir ao vivo, filmes e séries no teste.
const ID_BOUQUET_CONFIGURADO = process.env.PANEL_BOUQUET_IDS || '';

const DB_FILE = './devices.json';
function loadDb(){ try{ return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){ return {}; } }
function saveDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }

function genUser(deviceId){
  const h = crypto.createHash('md5').update(deviceId).digest('hex').slice(0,6);
  return `tst-${h}`;
}
function genPass(){
  return crypto.randomBytes(4).toString('hex');
}

async function requestPanel(endpoint, payload){
  const r = await fetch(`${PANEL_BASE}/${endpoint}/${PANEL_TOKEN}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ secret: PANEL_SECRET, ...payload })
  });
  const json = await r.json();
  if(!r.ok || !json.result) throw new Error('Painel recusou a operação');
  return json;
}

async function getBouquetIds(){
  const configured = ID_BOUQUET_CONFIGURADO
    .split(',').map(id => id.trim()).filter(Boolean);
  if(configured.length) return configured;

  const json = await requestPanel('bouquets', {});
  const ids = (Array.isArray(json.data) ? json.data : [])
    .map(item => String(item.id ?? '').trim())
    .filter(Boolean);
  if(!ids.length) throw new Error('O painel não retornou bouquets disponíveis');
  return ids;
}

async function updateAccountBouquets(username){
  const idbouquet = await getBouquetIds();
  await requestPanel('update_client', { username, idbouquet });
}

app.post('/gerar-teste', async (req,res)=>{
  const { deviceId, whatsapp } = req.body;
  if(!deviceId) return res.status(400).json({error:'deviceId obrigatorio'});

  const db = loadDb();
  if(db[deviceId]){
    return res.status(403).json({error:'Este aparelho ja usou o teste de 4h', anterior: db[deviceId]});
  }

  const username = genUser(deviceId);
  const password = genPass();

  let idbouquet;
  try{
    idbouquet = await getBouquetIds();
  }catch(err){
    console.error('Não foi possível consultar os bouquets disponíveis no painel.');
    return res.status(502).json({error:'Não foi possível preparar o catálogo completo do teste.'});
  }

  const url = `${PANEL_BASE}/trial_create/${PANEL_TOKEN}`;
  const payload = {
    secret: PANEL_SECRET,
    username: username,
    password: password,
    idbouquet,
    email: `${username}@teste.app`,
    whatsapp: whatsapp || "",
    notes: `deviceId:${deviceId}`
  };

  try{
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const json = await r.json();

    if(!json.result){
      return res.status(400).json({error:'Painel recusou criar teste', detalhe: json});
    }

    db[deviceId] = { username, password, createdAt: Date.now(), panelData: json.data, bouquetsUpdated: true };
    saveDb(db);

    return res.json({ ok: true, username, password, duracao: "4 horas", dados: json.data });
  }catch(err){
    console.error(err);
    return res.status(500).json({error:'erro ao falar com painel'});
  }
});

app.get('/', (req,res)=> res.send('Backend rodando'));

// Endpoint para o app verificar se ainda está no teste ou já expirou
app.get('/status/:deviceId', async (req,res)=>{
  const db = loadDb();
  const info = db[req.params.deviceId];
  if(!info) return res.json({ hasTest: false });

  // Migra testes já criados para o catálogo completo sem estender suas 4 horas.
  if(!info.bouquetsUpdated){
    try{
      await updateAccountBouquets(info.username);
      info.bouquetsUpdated = true;
      db[req.params.deviceId] = info;
      saveDb(db);
    }catch(err){
      console.error('Não foi possível atualizar os bouquets do teste existente.');
    }
  }

  const expiraEm = info.createdAt + 4*60*60*1000; // 4h em ms
  const agora = Date.now();
  res.json({ 
    hasTest: true, 
    username: info.username,
    expirou: agora > expiraEm,
    expiraEm,
    tempoRestanteMs: Math.max(0, expiraEm - agora)
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Rodando na porta '+PORT));
