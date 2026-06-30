const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch(e) {}

const { initDb } = require('./db');
const { login, me, register, authMiddleware } = require('./auth');
const { setupRoutes } = require('./routes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3456;
const APP_KEY = process.env.DINGTALK_APP_KEY;
const APP_SECRET = process.env.DINGTALK_APP_SECRET;

// ---------- Serve frontend ----------
const FRONTEND_PATH = path.join(__dirname, '..', '..', 'otms-pages', 'index.html');
app.get('/', (req, res) => res.sendFile(FRONTEND_PATH));

// ---------- Auth routes (public) ----------
app.post('/api/auth/login', login);
app.post('/api/auth/register', register);
app.get('/api/auth/me', authMiddleware, me);

// ---------- Protected API routes ----------
app.use('/api/okrs', authMiddleware);
app.use('/api/kpis', authMiddleware);
app.use('/api/reports', authMiddleware);
app.use('/api/meetings', authMiddleware);
app.use('/api/employees', authMiddleware);
app.use('/api/departments', authMiddleware);
app.use('/api/permissions', authMiddleware);
app.use('/api/attendance', authMiddleware);
app.use('/api/users', authMiddleware);
app.use('/api/sync', authMiddleware);

setupRoutes(app);

// ---------- DingTalk token ----------
let accessToken = null;
let tokenExpireAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpireAt - 60000) return accessToken;
  if (!APP_KEY || !APP_SECRET) throw new Error('请先配置 DINGTALK_APP_KEY 和 DINGTALK_APP_SECRET');
  const res = await axios.get('https://oapi.dingtalk.com/gettoken', {
    params: { appkey: APP_KEY, appsecret: APP_SECRET }
  });
  if (res.data.errcode !== 0) throw new Error('获取钉钉 Token 失败: ' + res.data.errmsg);
  accessToken = res.data.access_token;
  tokenExpireAt = Date.now() + 7200 * 1000;
  return accessToken;
}

// ---------- DingTalk API Routes ----------

app.get('/api/dingtalk/users', async (req, res) => {
  try {
    const token = await getAccessToken();
    const resp = await axios.post(
      'https://oapi.dingtalk.com/topapi/user/listsimple',
      { dept_id: 1, offset: 0, size: 100 },
      { params: { access_token: token } }
    );
    if (resp.data.errcode !== 0) return res.status(400).json({ error: resp.data.errmsg });
    const list = (resp.data.result && resp.data.result.list) || [];
    res.json({ users: list.map(u => ({ userId: u.userid, name: u.name })), hasMore: resp.data.result ? resp.data.result.has_more : false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/batch', async (req, res) => {
  try {
    const token = await getAccessToken();
    const { date, users } = req.body;
    if (!date || !users || !users.length) return res.status(400).json({ error: '缺少 date 或 users' });

    const mappedUsers = users.filter(u => u.dingId);
    if (!mappedUsers.length) return res.json({ statuses: {} });

    const resp = await axios.post(
      'https://oapi.dingtalk.com/attendance/list',
      { workDateFrom: date, workDateTo: date, userIdList: mappedUsers.map(u => u.dingId), offset: 0, limit: 50 },
      { params: { access_token: token } }
    );
    if (resp.data.errcode !== 0) return res.status(400).json({ error: resp.data.errmsg });

    const statusMap = {
      'Normal': '在岗','Early': '在岗','Late': '迟到','SeriousLate': '迟到',
      'Absenteeism': '请假(无薪)','NotSigned': '外出公干','Leave': '请假(带薪)',
      'BusinessTravel': '出差','OffDutyRest': '调休',
    };

    const statuses = {};
    (resp.data.recordresult || []).forEach(r => {
      const emp = mappedUsers.find(u => u.dingId === r.userId);
      if (emp) statuses[emp.id] = { status: statusMap[r.timeResult] || r.timeResult || '其他', checkIn: r.userCheckTime || '' };
    });
    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ configured: !!(APP_KEY && APP_SECRET), appKey: APP_KEY ? APP_KEY.substring(0, 4) + '****' : '(未配置)' });
});

// ---------- Start ----------
const os = require('os');
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

async function start() {
  // Initialize database (creates tables + seeds from data.json on first run)
  await initDb();

  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('╔══════════════════════════════════════╗');
    console.log('║  OTMS Server 已启动                  ║');
    console.log('║  本机访问: http://localhost:' + PORT + '      ║');
    console.log('║  局域网:   http://' + ip + ':' + PORT + '      ║');
    console.log('╚══════════════════════════════════════╝');
    if (!APP_KEY || !APP_SECRET) console.log('提示: 配置 .env 后可启用钉钉同步');
  });
}

start().catch(err => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
