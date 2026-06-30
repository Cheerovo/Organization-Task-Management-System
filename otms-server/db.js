const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/otms',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

// Run a query with automatic client release
async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

// Transaction helper
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      name TEXT NOT NULL,
      modules TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS okrs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'company',
      quarter TEXT DEFAULT '',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      approval TEXT DEFAULT 'draft',
      parent_id TEXT DEFAULT NULL,
      archived INTEGER DEFAULT 0,
      raci_r TEXT DEFAULT '',
      raci_a TEXT DEFAULT '',
      raci_c TEXT DEFAULT '',
      raci_i TEXT DEFAULT '',
      review_self_score DOUBLE PRECISION DEFAULT NULL,
      review_manager_score DOUBLE PRECISION DEFAULT NULL,
      review_self_note TEXT DEFAULT '',
      review_manager_note TEXT DEFAULT '',
      review_date TEXT DEFAULT NULL,
      public INTEGER DEFAULT 1,
      visible_to TEXT DEFAULT NULL,
      source_type TEXT DEFAULT NULL,
      source_meeting_id TEXT DEFAULT NULL,
      source_task_id TEXT DEFAULT NULL,
      source_meeting_title TEXT DEFAULT NULL,
      source_meeting_date TEXT DEFAULT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_results (
      id TEXT NOT NULL,
      okr_id TEXT NOT NULL,
      title TEXT NOT NULL,
      target DOUBLE PRECISION DEFAULT 0,
      current DOUBLE PRECISION DEFAULT 0,
      unit TEXT DEFAULT '%',
      owner TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      source_type TEXT DEFAULT NULL,
      source_meeting_id TEXT DEFAULT NULL,
      source_task_id TEXT DEFAULT NULL,
      source_meeting_title TEXT DEFAULT NULL,
      source_meeting_date TEXT DEFAULT NULL,
      PRIMARY KEY (id, okr_id),
      FOREIGN KEY (okr_id) REFERENCES okrs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kr_logs (
      id SERIAL PRIMARY KEY,
      kr_id TEXT NOT NULL,
      okr_id TEXT NOT NULL,
      date TEXT NOT NULL,
      from_val DOUBLE PRECISION DEFAULT 0,
      to_val DOUBLE PRECISION DEFAULT 0,
      operator TEXT DEFAULT '',
      FOREIGN KEY (kr_id, okr_id) REFERENCES key_results(id, okr_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS okr_checkins (
      id TEXT NOT NULL,
      okr_id TEXT NOT NULL,
      date TEXT NOT NULL,
      note TEXT DEFAULT '',
      risks TEXT DEFAULT '',
      plans TEXT DEFAULT '',
      operator TEXT DEFAULT '',
      PRIMARY KEY (id, okr_id),
      FOREIGN KEY (okr_id) REFERENCES okrs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kpis (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'revenue',
      bu TEXT DEFAULT '',
      target DOUBLE PRECISION DEFAULT 0,
      current DOUBLE PRECISION DEFAULT 0,
      unit TEXT DEFAULT '%',
      owner TEXT DEFAULT '',
      cycle TEXT DEFAULT 'monthly',
      history TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      freq TEXT DEFAULT 'monthly',
      deadline_day INTEGER DEFAULT 1,
      deadline_month INTEGER DEFAULT NULL,
      owner TEXT DEFAULT '',
      companies TEXT DEFAULT '',
      group_name TEXT DEFAULT NULL,
      viewers TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS report_submissions (
      id SERIAL PRIMARY KEY,
      report_id TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT DEFAULT 'ok',
      files TEXT DEFAULT '[]',
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      attendees TEXT DEFAULT '',
      minutes TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_tasks (
      id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      title TEXT NOT NULL,
      owner TEXT DEFAULT '',
      deadline TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      sync_to_okr INTEGER DEFAULT 0,
      link_okr_id TEXT DEFAULT NULL,
      link_kr_id TEXT DEFAULT NULL,
      sync_status TEXT DEFAULT 'none',
      PRIMARY KEY (id, meeting_id),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meeting_files (
      id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      name TEXT NOT NULL,
      file_id TEXT NOT NULL,
      PRIMARY KEY (id, meeting_id),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS minutes_logs (
      id SERIAL PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      date TEXT NOT NULL,
      operator TEXT DEFAULT '',
      before_text TEXT DEFAULT '',
      after_text TEXT DEFAULT '',
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bu TEXT DEFAULT '',
      department TEXT DEFAULT '',
      reports_to TEXT DEFAULT '',
      position TEXT DEFAULT '',
      rank TEXT DEFAULT '',
      hire_date TEXT DEFAULT '',
      phone TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS departments (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS permissions (
      module TEXT PRIMARY KEY,
      view_users TEXT DEFAULT '[]',
      edit_users TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS attendance (
      date TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      status TEXT DEFAULT '在岗',
      PRIMARY KEY (date, employee_name)
    );

    CREATE TABLE IF NOT EXISTS nudge_logs (
      id TEXT PRIMARY KEY,
      okr_id TEXT DEFAULT '',
      title TEXT DEFAULT '',
      from_user TEXT DEFAULT '',
      to_user TEXT DEFAULT '',
      action TEXT DEFAULT 'ding',
      date TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS report_group_subs (
      group_key TEXT PRIMARY KEY,
      status TEXT DEFAULT 'ok',
      files TEXT DEFAULT '[]'
    );
  `);

  // Seed initial data from data.json if database is empty
  const result = await query('SELECT COUNT(*) as cnt FROM users');
  if (parseInt(result.rows[0].cnt) === 0) {
    await seedFromJsonFile();
  }
}

async function seedFromJsonFile() {
  const jsonPath = path.join(__dirname, '..', '..', 'otms-pages', 'data.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('data.json 未找到，跳过初始数据导入。');
    return;
  }

  console.log('正在从 data.json 导入初始数据...');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const bcrypt = require('bcryptjs');

  await transaction(async (db) => {
    // Users
    if (data.okr_users) {
      for (const [username, user] of Object.entries(data.okr_users)) {
        const hashedPw = bcrypt.hashSync(user.pw || '123123', 10);
        await db.query(
          'INSERT INTO users (username, password, role, name, modules) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO UPDATE SET password=$2,role=$3,name=$4,modules=$5',
          [username, hashedPw, user.role || 'user', user.name || username, user.modules ? JSON.stringify(user.modules) : null]
        );
      }
    }

    // OKRs
    if (data.okr_data) {
      for (const o of data.okr_data) {
        await db.query(
          `INSERT INTO okrs (id,title,description,type,quarter,start_date,end_date,owner,status,approval,parent_id,archived,raci_r,raci_a,raci_c,raci_i,review_self_score,review_manager_score,review_self_note,review_manager_note,review_date,public,visible_to,source_type,source_meeting_id,source_task_id,source_meeting_title,source_meeting_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) ON CONFLICT (id) DO UPDATE SET title=$2,description=$3,type=$4,quarter=$5,start_date=$6,end_date=$7,owner=$8,status=$9,approval=$10,parent_id=$11,archived=$12,raci_r=$13,raci_a=$14,raci_c=$15,raci_i=$16,review_self_score=$17,review_manager_score=$18,review_self_note=$19,review_manager_note=$20,review_date=$21,public=$22,visible_to=$23,source_type=$24,source_meeting_id=$25,source_task_id=$26,source_meeting_title=$27,source_meeting_date=$28,created_at=$29,updated_at=$30`,
          [o.id, o.title, o.desc || '', o.type || 'company', o.quarter || '', o.start || '', o.end || '', o.owner || '', o.status || 'active', o.approval || 'draft', o.parent || null, o.archived ? 1 : 0, o.raci?.R || '', o.raci?.A || '', o.raci?.C || '', o.raci?.I || '', o.review?.selfScore ?? null, o.review?.managerScore ?? null, o.review?.selfNote || '', o.review?.managerNote || '', o.review?.reviewDate || null, o.public !== false ? 1 : 0, o.visibleTo ? JSON.stringify(o.visibleTo) : null, o.source?.type || null, o.source?.meetingId || null, o.source?.taskId || null, o.source?.meetingTitle || null, o.source?.meetingDate || null, o.cat || Date.now(), o.upd || Date.now()]
        );
        if (o.krs) {
          for (const kr of o.krs) {
            await db.query(
              'INSERT INTO key_results (id,okr_id,title,target,current,unit,owner,status,source_type,source_meeting_id,source_task_id,source_meeting_title,source_meeting_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id,okr_id) DO UPDATE SET title=$3,target=$4,current=$5,unit=$6,owner=$7,status=$8',
              [kr.id, o.id, kr.t, kr.target || 0, kr.cur || 0, kr.u || '%', kr.owner || '', kr.s || 'active', kr.source?.type || null, kr.source?.meetingId || null, kr.source?.taskId || null, kr.source?.meetingTitle || null, kr.source?.meetingDate || null]
            );
            if (kr.log) {
              for (const l of kr.log) {
                await db.query('INSERT INTO kr_logs (kr_id,okr_id,date,from_val,to_val,operator) VALUES ($1,$2,$3,$4,$5,$6)', [kr.id, o.id, l.date, l.from, l.to, l.operator || '']);
              }
            }
          }
        }
        if (o.checkins) {
          for (const c of o.checkins) {
            await db.query(
              'INSERT INTO okr_checkins (id,okr_id,date,note,risks,plans,operator) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id,okr_id) DO UPDATE SET date=$3,note=$4,risks=$5,plans=$6,operator=$7',
              [c.id, o.id, c.date, c.note || '', c.risks || '', c.plans || '', c.operator || '']
            );
          }
        }
      }
    }

    // KPIs
    if (data.kpi_data) {
      for (const k of data.kpi_data) {
        await db.query(
          'INSERT INTO kpis (id,name,category,bu,target,current,unit,owner,cycle,history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=$2,category=$3,bu=$4,target=$5,current=$6,unit=$7,owner=$8,cycle=$9,history=$10',
          [k.id, k.name, k.cat || 'revenue', k.bu || '', k.target || 0, k.cur || 0, k.u || '%', k.owner || '', k.cycle || 'monthly', JSON.stringify(k.history || {})]
        );
      }
    }

    // Reports
    if (data.rpt_data) {
      for (const r of data.rpt_data) {
        await db.query(
          'INSERT INTO reports (id,name,description,freq,deadline_day,deadline_month,owner,companies,group_name,viewers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,freq=$4,deadline_day=$5,deadline_month=$6,owner=$7,companies=$8,group_name=$9,viewers=$10',
          [r.id, r.name, r.desc || '', r.freq || 'monthly', r.deadlineDay || 1, r.deadlineMonth || null, r.owner || '', r.companies || '', r.group || null, r.viewers ? JSON.stringify(r.viewers) : null]
        );
        if (r.subs) {
          for (const [period, sub] of Object.entries(r.subs)) {
            await db.query('INSERT INTO report_submissions (report_id,period,status,files) VALUES ($1,$2,$3,$4)', [r.id, period, sub.status || 'ok', JSON.stringify(sub.files || [])]);
          }
        }
      }
    }

    // Meetings
    if (data.meeting_data) {
      for (const m of data.meeting_data) {
        await db.query(
          'INSERT INTO meetings (id,date,title,attendees,minutes,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET date=$2,title=$3,attendees=$4,minutes=$5,created_at=$6',
          [m.id, m.date, m.title, m.attendees || '', m.minutes || '', m.cat || Date.now()]
        );
        if (m.tempTasks) {
          for (const t of m.tempTasks) {
            await db.query(
              'INSERT INTO meeting_tasks (id,meeting_id,title,owner,deadline,status,sync_to_okr,link_okr_id,link_kr_id,sync_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id,meeting_id) DO UPDATE SET title=$3,owner=$4,deadline=$5,status=$6,sync_to_okr=$7,link_okr_id=$8,link_kr_id=$9,sync_status=$10',
              [t.id, m.id, t.title, t.owner || '', t.deadline || '', t.status || 'pending', t.syncToOKR ? 1 : 0, t.linkOkrId || null, t.linkKrId || null, t.syncStatus || 'none']
            );
          }
        }
        if (m.files) {
          for (const f of m.files) {
            await db.query('INSERT INTO meeting_files (id,meeting_id,name,file_id) VALUES ($1,$2,$3,$4) ON CONFLICT (id,meeting_id) DO UPDATE SET name=$3,file_id=$4', [f.id, m.id, f.name, f.fileId]);
          }
        }
        if (m.minutesLog) {
          for (const l of m.minutesLog) {
            await db.query('INSERT INTO minutes_logs (meeting_id,date,operator,before_text,after_text) VALUES ($1,$2,$3,$4,$5)', [m.id, l.date, l.operator || '', l.before || '', l.after || '']);
          }
        }
      }
    }

    // Employees
    if (data.okr_employees) {
      for (const e of data.okr_employees) {
        await db.query(
          'INSERT INTO employees (id,name,bu,department,reports_to,position,rank,hire_date,phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=$2,bu=$3,department=$4,reports_to=$5,position=$6,rank=$7,hire_date=$8,phone=$9',
          [e.id, e.name, e.bu || '', e.department || '', e.reportsTo || '', e.position || '', e.rank || '', e.hireDate || '', e.phone || '']
        );
      }
    }

    // Departments
    if (data.okr_depts) {
      for (const d of data.okr_depts) {
        await db.query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [d]);
      }
    }

    // Permissions
    if (data.okr_permissions) {
      for (const [mod, perm] of Object.entries(data.okr_permissions)) {
        await db.query(
          'INSERT INTO permissions (module,view_users,edit_users) VALUES ($1,$2,$3) ON CONFLICT (module) DO UPDATE SET view_users=$2,edit_users=$3',
          [mod, JSON.stringify(perm.view || []), JSON.stringify(perm.edit || [])]
        );
      }
    }

    // Attendance
    if (data.okr_attendance) {
      for (const [date, employees] of Object.entries(data.okr_attendance)) {
        for (const [name, status] of Object.entries(employees)) {
          await db.query('INSERT INTO attendance (date,employee_name,status) VALUES ($1,$2,$3) ON CONFLICT (date,employee_name) DO UPDATE SET status=$3', [date, name, status]);
        }
      }
    }

    // Nudge logs
    if (data.nudge_log) {
      for (const n of data.nudge_log) {
        await db.query('INSERT INTO nudge_logs (id,okr_id,title,from_user,to_user,action,date) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET okr_id=$2,title=$3,from_user=$4,to_user=$5,action=$6,date=$7', [n.id, n.oid || '', n.title || '', n.from || '', n.to || '', n.action || 'ding', n.date || '']);
      }
    }

    // Report group subs
    if (data.rpt_group_subs) {
      for (const [key, val] of Object.entries(data.rpt_group_subs)) {
        await db.query('INSERT INTO report_group_subs (group_key,status,files) VALUES ($1,$2,$3) ON CONFLICT (group_key) DO UPDATE SET status=$2,files=$3', [key, val.status || 'ok', JSON.stringify(val.files || [])]);
      }
    }
  });

  console.log('初始数据导入完成。');
}

// ---- Data access helpers (async) ----

async function getAllUsers() {
  const rows = (await query('SELECT username, password, role, name, modules FROM users')).rows;
  const users = {};
  for (const r of rows) {
    users[r.username] = { pw: r.password, role: r.role, name: r.name };
    if (r.modules) users[r.username].modules = JSON.parse(r.modules);
  }
  return users;
}

async function getUser(username) {
  const r = await query('SELECT * FROM users WHERE username = $1', [username]);
  return r.rows[0] || null;
}

async function setUser(username, data) {
  await query(
    'INSERT INTO users (username, password, role, name, modules) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO UPDATE SET password=$2,role=$3,name=$4,modules=$5',
    [username, data.password, data.role, data.name, data.modules ? JSON.stringify(data.modules) : null]
  );
}

module.exports = { pool, query, transaction, initDb, getAllUsers, getUser, setUser };
