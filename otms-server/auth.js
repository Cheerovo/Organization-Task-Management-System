const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getUser, setUser } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'otms-secret-key-change-in-production';
const JWT_EXPIRES = '7d';

async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const user = await getUser(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { username: user.username, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        name: user.name,
        modules: user.modules ? JSON.parse(user.modules) : undefined,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function me(req, res) {
  try {
    const user = await getUser(req.user.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({
      username: user.username,
      role: user.role,
      name: user.name,
      modules: user.modules ? JSON.parse(user.modules) : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function register(req, res) {
  try {
    const { username, password, name } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }
    const existing = await getUser(username);
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    const hashedPw = bcrypt.hashSync(password, 10);
    await setUser(username, { password: hashedPw, role: 'user', name: name || username });
    res.status(201).json({ message: '注册成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

module.exports = { login, me, register, authMiddleware, JWT_SECRET };
