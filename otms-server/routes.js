const { query, transaction, getAllUsers } = require('./db');
const bcrypt = require('bcryptjs');

function okrFromRow(o) {
  return {
    id: o.id, title: o.title, desc: o.description, type: o.type,
    quarter: o.quarter, start: o.start_date, end: o.end_date,
    owner: o.owner, status: o.status, approval: o.approval,
    parent: o.parent_id, archived: !!o.archived,
    raci: { R: o.raci_r, A: o.raci_a, C: o.raci_c, I: o.raci_i },
    review: o.review_self_score != null ? {
      selfScore: o.review_self_score, managerScore: o.review_manager_score,
      selfNote: o.review_self_note, managerNote: o.review_manager_note,
      reviewDate: o.review_date
    } : undefined,
    public: !!o.public,
    visibleTo: o.visible_to ? JSON.parse(o.visible_to) : undefined,
    source: o.source_type ? {
      type: o.source_type, meetingId: o.source_meeting_id,
      taskId: o.source_task_id, meetingTitle: o.source_meeting_title,
      meetingDate: o.source_meeting_date
    } : undefined,
    krs: [],
    checkins: [],
    cat: parseInt(o.created_at) || 0, upd: parseInt(o.updated_at) || 0
  };
}

function setupRoutes(app) {

  // ==================== OKRs ====================
  app.get('/api/okrs', async (req, res) => {
    try {
      const okrs = (await query('SELECT * FROM okrs')).rows;
      for (const o of okrs) {
        const krs = (await query('SELECT * FROM key_results WHERE okr_id = $1', [o.id])).rows;
        for (const kr of krs) {
          kr.log = (await query('SELECT date, from_val as "from", to_val as "to", operator FROM kr_logs WHERE kr_id = $1 AND okr_id = $2', [kr.id, kr.okr_id])).rows;
          kr.t = kr.title; kr.cur = kr.current; kr.u = kr.unit; kr.s = kr.status;
        }
        o.krs = krs;
        o.checkins = (await query('SELECT * FROM okr_checkins WHERE okr_id = $1', [o.id])).rows;
      }
      res.json(okrs.map(okrFromRow));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/okrs/:id', async (req, res) => {
    try {
      req.body.id = req.params.id;
      await saveOkrData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/okrs', async (req, res) => {
    try {
      await saveOkrData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/okrs/:id', async (req, res) => {
    try {
      await query('DELETE FROM okrs WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  async function saveOkrData(o) {
    await query(
      `INSERT INTO okrs (id,title,description,type,quarter,start_date,end_date,owner,status,approval,parent_id,archived,raci_r,raci_a,raci_c,raci_i,review_self_score,review_manager_score,review_self_note,review_manager_note,review_date,public,visible_to,source_type,source_meeting_id,source_task_id,source_meeting_title,source_meeting_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) ON CONFLICT (id) DO UPDATE SET title=$2,description=$3,type=$4,quarter=$5,start_date=$6,end_date=$7,owner=$8,status=$9,approval=$10,parent_id=$11,archived=$12,raci_r=$13,raci_a=$14,raci_c=$15,raci_i=$16,review_self_score=$17,review_manager_score=$18,review_self_note=$19,review_manager_note=$20,review_date=$21,public=$22,visible_to=$23,source_type=$24,source_meeting_id=$25,source_task_id=$26,source_meeting_title=$27,source_meeting_date=$28,created_at=$29,updated_at=$30`,
      [o.id, o.title, o.desc, o.type, o.quarter, o.start, o.end, o.owner, o.status, o.approval, o.parent, o.archived ? 1 : 0, o.raci?.R || '', o.raci?.A || '', o.raci?.C || '', o.raci?.I || '', o.review?.selfScore ?? null, o.review?.managerScore ?? null, o.review?.selfNote || '', o.review?.managerNote || '', o.review?.reviewDate || null, o.public !== false ? 1 : 0, o.visibleTo ? JSON.stringify(o.visibleTo) : null, o.source?.type || null, o.source?.meetingId || null, o.source?.taskId || null, o.source?.meetingTitle || null, o.source?.meetingDate || null, o.cat || Date.now(), o.upd || Date.now()]
    );
    await query('DELETE FROM kr_logs WHERE okr_id = $1', [o.id]);
    await query('DELETE FROM key_results WHERE okr_id = $1', [o.id]);
    await query('DELETE FROM okr_checkins WHERE okr_id = $1', [o.id]);
    if (o.krs) {
      for (const kr of o.krs) {
        await query(
          'INSERT INTO key_results (id,okr_id,title,target,current,unit,owner,status,source_type,source_meeting_id,source_task_id,source_meeting_title,source_meeting_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id,okr_id) DO UPDATE SET title=$3,target=$4,current=$5,unit=$6,owner=$7,status=$8',
          [kr.id || kr.krId, o.id, kr.t || kr.title, kr.target, kr.cur != null ? kr.cur : kr.current, kr.u || kr.unit || '%', kr.owner, kr.s || kr.status || 'active', kr.source?.type || null, kr.source?.meetingId || null, kr.source?.taskId || null, kr.source?.meetingTitle || null, kr.source?.meetingDate || null]
        );
        if (kr.log) {
          for (const l of kr.log) {
            await query('INSERT INTO kr_logs (kr_id,okr_id,date,from_val,to_val,operator) VALUES ($1,$2,$3,$4,$5,$6)', [kr.id || kr.krId, o.id, l.date, l.from, l.to, l.operator || '']);
          }
        }
      }
    }
    if (o.checkins) {
      for (const c of o.checkins) {
        await query(
          'INSERT INTO okr_checkins (id,okr_id,date,note,risks,plans,operator) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id,okr_id) DO UPDATE SET date=$3,note=$4,risks=$5,plans=$6,operator=$7',
          [c.id, o.id, c.date, c.note || '', c.risks || '', c.plans || '', c.operator || '']
        );
      }
    }
  }

  // ==================== KPIs ====================
  app.get('/api/kpis', async (req, res) => {
    try {
      const rows = (await query('SELECT * FROM kpis')).rows;
      res.json(rows.map(k => ({
        id: k.id, name: k.name, cat: k.category, bu: k.bu,
        target: parseFloat(k.target), cur: parseFloat(k.current), u: k.unit,
        owner: k.owner, cycle: k.cycle,
        history: JSON.parse(k.history || '{}')
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/kpis', async (req, res) => {
    try {
      await saveKpiData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/kpis/:id', async (req, res) => {
    try {
      req.body.id = req.params.id;
      await saveKpiData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/kpis/:id', async (req, res) => {
    try {
      await query('DELETE FROM kpis WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  async function saveKpiData(k) {
    await query(
      'INSERT INTO kpis (id,name,category,bu,target,current,unit,owner,cycle,history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=$2,category=$3,bu=$4,target=$5,current=$6,unit=$7,owner=$8,cycle=$9,history=$10',
      [k.id, k.name, k.cat || 'revenue', k.bu || '', k.target || 0, k.cur || 0, k.u || '%', k.owner || '', k.cycle || 'monthly', JSON.stringify(k.history || {})]
    );
  }

  // ==================== Reports ====================
  app.get('/api/reports', async (req, res) => {
    try {
      const reports = (await query('SELECT * FROM reports')).rows;
      for (const r of reports) {
        r.subs = {};
        const subs = (await query('SELECT * FROM report_submissions WHERE report_id = $1', [r.id])).rows;
        for (const s of subs) { r.subs[s.period] = { status: s.status, files: JSON.parse(s.files || '[]') }; }
      }
      res.json(reports.map(r => ({
        id: r.id, name: r.name, desc: r.description, freq: r.freq,
        deadlineDay: r.deadline_day, deadlineMonth: r.deadline_month,
        owner: r.owner, companies: r.companies, group: r.group_name,
        viewers: r.viewers ? JSON.parse(r.viewers) : undefined, subs: r.subs
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/reports', async (req, res) => {
    try {
      await saveReportData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/reports/:id', async (req, res) => {
    try {
      req.body.id = req.params.id;
      await saveReportData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/reports/:id', async (req, res) => {
    try {
      await query('DELETE FROM reports WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  async function saveReportData(r) {
    await query(
      'INSERT INTO reports (id,name,description,freq,deadline_day,deadline_month,owner,companies,group_name,viewers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,freq=$4,deadline_day=$5,deadline_month=$6,owner=$7,companies=$8,group_name=$9,viewers=$10',
      [r.id, r.name, r.desc || '', r.freq || 'monthly', r.deadlineDay || 1, r.deadlineMonth || null, r.owner || '', r.companies || '', r.group || null, r.viewers ? JSON.stringify(r.viewers) : null]
    );
    await query('DELETE FROM report_submissions WHERE report_id = $1', [r.id]);
    if (r.subs) {
      for (const [period, sub] of Object.entries(r.subs)) {
        await query('INSERT INTO report_submissions (report_id,period,status,files) VALUES ($1,$2,$3,$4)', [r.id, period, sub.status || 'ok', JSON.stringify(sub.files || [])]);
      }
    }
  }

  // ==================== Meetings ====================
  app.get('/api/meetings', async (req, res) => {
    try {
      const meetings = (await query('SELECT * FROM meetings')).rows;
      for (const m of meetings) {
        m.tempTasks = (await query('SELECT * FROM meeting_tasks WHERE meeting_id = $1', [m.id])).rows;
        for (const t of m.tempTasks) {
          t.syncToOKR = !!t.sync_to_okr;
          t.linkOkrId = t.link_okr_id; t.linkKrId = t.link_kr_id;
          t.syncStatus = t.sync_status;
        }
        m.files = (await query('SELECT * FROM meeting_files WHERE meeting_id = $1', [m.id])).rows;
        m.minutesLog = (await query('SELECT date, operator, before_text as "before", after_text as "after" FROM minutes_logs WHERE meeting_id = $1', [m.id])).rows;
      }
      res.json(meetings.map(m => ({
        id: m.id, date: m.date, title: m.title, attendees: m.attendees,
        minutes: m.minutes, tempTasks: m.tempTasks, files: m.files,
        minutesLog: m.minutesLog, cat: parseInt(m.created_at) || 0
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/meetings', async (req, res) => {
    try {
      await saveMeetingData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/meetings/:id', async (req, res) => {
    try {
      req.body.id = req.params.id;
      await saveMeetingData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/meetings/:id', async (req, res) => {
    try {
      await query('DELETE FROM meetings WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  async function saveMeetingData(m) {
    await query(
      'INSERT INTO meetings (id,date,title,attendees,minutes,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET date=$2,title=$3,attendees=$4,minutes=$5,created_at=$6',
      [m.id, m.date, m.title, m.attendees || '', m.minutes || '', m.cat || Date.now()]
    );
    await query('DELETE FROM meeting_tasks WHERE meeting_id = $1', [m.id]);
    await query('DELETE FROM meeting_files WHERE meeting_id = $1', [m.id]);
    await query('DELETE FROM minutes_logs WHERE meeting_id = $1', [m.id]);
    if (m.tempTasks) {
      for (const t of m.tempTasks) {
        await query(
          'INSERT INTO meeting_tasks (id,meeting_id,title,owner,deadline,status,sync_to_okr,link_okr_id,link_kr_id,sync_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id,meeting_id) DO UPDATE SET title=$3,owner=$4,deadline=$5,status=$6,sync_to_okr=$7,link_okr_id=$8,link_kr_id=$9,sync_status=$10',
          [t.id, m.id, t.title, t.owner || '', t.deadline || '', t.status || 'pending', t.syncToOKR ? 1 : 0, t.linkOkrId || null, t.linkKrId || null, t.syncStatus || 'none']
        );
      }
    }
    if (m.files) {
      for (const f of m.files) {
        await query('INSERT INTO meeting_files (id,meeting_id,name,file_id) VALUES ($1,$2,$3,$4) ON CONFLICT (id,meeting_id) DO UPDATE SET name=$3,file_id=$4', [f.id, m.id, f.name, f.fileId]);
      }
    }
    if (m.minutesLog) {
      for (const l of m.minutesLog) {
        await query('INSERT INTO minutes_logs (meeting_id,date,operator,before_text,after_text) VALUES ($1,$2,$3,$4,$5)', [m.id, l.date, l.operator || '', l.before || '', l.after || '']);
      }
    }
  }

  // ==================== Organization ====================
  app.get('/api/employees', async (req, res) => {
    try {
      const rows = (await query('SELECT * FROM employees')).rows;
      res.json(rows.map(e => ({
        id: e.id, name: e.name, bu: e.bu, department: e.department,
        reportsTo: e.reports_to, position: e.position, rank: e.rank,
        hireDate: e.hire_date, phone: e.phone
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/employees', async (req, res) => {
    try {
      await saveEmployeeData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/employees/:id', async (req, res) => {
    try {
      req.body.id = req.params.id;
      await saveEmployeeData(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/employees/:id', async (req, res) => {
    try {
      await query('DELETE FROM employees WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  async function saveEmployeeData(e) {
    await query(
      'INSERT INTO employees (id,name,bu,department,reports_to,position,rank,hire_date,phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=$2,bu=$3,department=$4,reports_to=$5,position=$6,rank=$7,hire_date=$8,phone=$9',
      [e.id, e.name, e.bu || '', e.department || '', e.reportsTo || '', e.position || '', e.rank || '', e.hireDate || '', e.phone || '']
    );
  }

  app.get('/api/departments', async (req, res) => {
    try {
      const rows = (await query('SELECT name FROM departments')).rows;
      res.json(rows.map(d => d.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/departments', async (req, res) => {
    try {
      const list = req.body;
      await query('DELETE FROM departments');
      for (const d of list) {
        await query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [d]);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==================== Permissions ====================
  app.get('/api/permissions', async (req, res) => {
    try {
      const rows = (await query('SELECT * FROM permissions')).rows;
      const data = {};
      for (const p of rows) {
        data[p.module] = { view: JSON.parse(p.view_users || '[]'), edit: JSON.parse(p.edit_users || '[]') };
      }
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/permissions', async (req, res) => {
    try {
      const data = req.body;
      await query('DELETE FROM permissions');
      for (const [mod, perm] of Object.entries(data)) {
        await query(
          'INSERT INTO permissions (module,view_users,edit_users) VALUES ($1,$2,$3) ON CONFLICT (module) DO UPDATE SET view_users=$2,edit_users=$3',
          [mod, JSON.stringify(perm.view || []), JSON.stringify(perm.edit || [])]
        );
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==================== Attendance ====================
  app.get('/api/attendance', async (req, res) => {
    try {
      const rows = (await query('SELECT * FROM attendance')).rows;
      const data = {};
      for (const a of rows) {
        if (!data[a.date]) data[a.date] = {};
        data[a.date][a.employee_name] = a.status;
      }
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/attendance', async (req, res) => {
    try {
      const data = req.body;
      await query('DELETE FROM attendance');
      for (const [date, employees] of Object.entries(data)) {
        for (const [name, status] of Object.entries(employees)) {
          await query('INSERT INTO attendance (date,employee_name,status) VALUES ($1,$2,$3) ON CONFLICT (date,employee_name) DO UPDATE SET status=$3', [date, name, status]);
        }
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==================== Users ====================
  app.get('/api/users', async (req, res) => {
    try {
      const users = await getAllUsers();
      const safe = {};
      for (const [k, v] of Object.entries(users)) {
        safe[k] = { role: v.role, name: v.name, modules: v.modules };
      }
      res.json(safe);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==================== Sync (pull all data) ====================
  app.get('/api/sync/all', async (req, res) => {
    try {
      const users = await getAllUsers();
      const okrs = (await query('SELECT * FROM okrs')).rows;
      for (const o of okrs) {
        const krs = (await query('SELECT * FROM key_results WHERE okr_id = $1', [o.id])).rows;
        for (const kr of krs) {
          kr.log = (await query('SELECT date, from_val as "from", to_val as "to", operator FROM kr_logs WHERE kr_id = $1 AND okr_id = $2', [kr.id, kr.okr_id])).rows;
          kr.t = kr.title; kr.cur = kr.current; kr.u = kr.unit; kr.s = kr.status;
        }
        o.krs = krs;
        o.checkins = (await query('SELECT * FROM okr_checkins WHERE okr_id = $1', [o.id])).rows;
      }

      const kpis = (await query('SELECT * FROM kpis')).rows.map(k => ({
        id: k.id, name: k.name, cat: k.category, bu: k.bu,
        target: parseFloat(k.target), cur: parseFloat(k.current), u: k.unit,
        owner: k.owner, cycle: k.cycle,
        history: JSON.parse(k.history || '{}')
      }));

      const reports = (await query('SELECT * FROM reports')).rows;
      for (const r of reports) {
        r.subs = {};
        const subs = (await query('SELECT * FROM report_submissions WHERE report_id = $1', [r.id])).rows;
        for (const s of subs) { r.subs[s.period] = { status: s.status, files: JSON.parse(s.files || '[]') }; }
      }

      const meetings = (await query('SELECT * FROM meetings')).rows;
      for (const m of meetings) {
        m.tempTasks = (await query('SELECT * FROM meeting_tasks WHERE meeting_id = $1', [m.id])).rows;
        for (const t of m.tempTasks) {
          t.syncToOKR = !!t.sync_to_okr; t.linkOkrId = t.link_okr_id;
          t.linkKrId = t.link_kr_id; t.syncStatus = t.sync_status;
        }
        m.files = (await query('SELECT * FROM meeting_files WHERE meeting_id = $1', [m.id])).rows;
        m.minutesLog = (await query('SELECT date, operator, before_text as "before", after_text as "after" FROM minutes_logs WHERE meeting_id = $1', [m.id])).rows;
      }

      const employees = (await query('SELECT * FROM employees')).rows.map(e => ({
        id: e.id, name: e.name, bu: e.bu, department: e.department,
        reportsTo: e.reports_to, position: e.position, rank: e.rank,
        hireDate: e.hire_date, phone: e.phone
      }));

      const depts = (await query('SELECT name FROM departments')).rows.map(d => d.name);

      const permRows = (await query('SELECT * FROM permissions')).rows;
      const perms = {};
      for (const p of permRows) { perms[p.module] = { view: JSON.parse(p.view_users || '[]'), edit: JSON.parse(p.edit_users || '[]') }; }

      const attRows = (await query('SELECT * FROM attendance')).rows;
      const attendance = {};
      for (const a of attRows) {
        if (!attendance[a.date]) attendance[a.date] = {};
        attendance[a.date][a.employee_name] = a.status;
      }

      const frontendUsers = {};
      for (const [k, v] of Object.entries(users)) {
        frontendUsers[k] = { pw: '', role: v.role, name: v.name };
        if (v.modules) frontendUsers[k].modules = v.modules;
      }

      const nudgeData = (await query('SELECT * FROM nudge_logs')).rows.map(n => ({
        id: n.id, oid: n.okr_id, title: n.title, from: n.from_user,
        to: n.to_user, action: n.action, date: n.date
      }));
      const gsRows = (await query('SELECT * FROM report_group_subs')).rows;
      const gsData = {};
      for (const r of gsRows) { gsData[r.group_key] = { status: r.status, files: JSON.parse(r.files || '[]') }; }

      res.json({
        okr_users: frontendUsers,
        okr_data: okrs.map(okrFromRow),
        okr_version: '7',
        kpi_data: kpis,
        rpt_data: reports.map(r => ({
          id: r.id, name: r.name, desc: r.description, freq: r.freq,
          deadlineDay: r.deadline_day, deadlineMonth: r.deadline_month,
          owner: r.owner, companies: r.companies, group: r.group_name,
          viewers: r.viewers ? JSON.parse(r.viewers) : undefined, subs: r.subs
        })),
        rpt_version: '6',
        meeting_data: meetings.map(m => ({
          id: m.id, date: m.date, title: m.title, attendees: m.attendees,
          minutes: m.minutes, tempTasks: m.tempTasks, files: m.files,
          minutesLog: m.minutesLog, cat: parseInt(m.created_at) || 0
        })),
        okr_employees: employees,
        okr_depts: depts,
        okr_permissions: perms,
        okr_attendance: attendance,
        nudge_log: nudgeData,
        rpt_group_subs: gsData
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==================== Sync (push all data) ====================
  app.post('/api/sync/all', async (req, res) => {
    try {
      const data = req.body;
      await transaction(async (db) => {
        // Users — preserve existing bcrypt passwords
        if (data.okr_users) {
          const existingUsers = {};
          (await db.query('SELECT username, password FROM users')).rows.forEach(u => { existingUsers[u.username] = u.password; });
          for (const [username, user] of Object.entries(data.okr_users)) {
            const pw = existingUsers[username] || bcrypt.hashSync(user.pw || '123123', 10);
            await db.query(
              'INSERT INTO users (username, password, role, name, modules) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO UPDATE SET password=$2,role=$3,name=$4,modules=$5',
              [username, pw, user.role || 'user', user.name || username, user.modules ? JSON.stringify(user.modules) : null]
            );
          }
        }

        // Clear existing data
        const tables = ['okrs','kpis','reports','report_submissions','meetings','meeting_tasks','meeting_files','minutes_logs','employees','departments','permissions','attendance','nudge_logs','report_group_subs'];
        for (const t of tables) { await db.query('DELETE FROM ' + t); }

        // OKRs
        if (data.okr_data) {
          for (const o of data.okr_data) {
            await db.query(
              `INSERT INTO okrs (id,title,description,type,quarter,start_date,end_date,owner,status,approval,parent_id,archived,raci_r,raci_a,raci_c,raci_i,review_self_score,review_manager_score,review_self_note,review_manager_note,review_date,public,visible_to,source_type,source_meeting_id,source_task_id,source_meeting_title,source_meeting_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
              [o.id, o.title, o.desc || '', o.type || 'company', o.quarter || '', o.start || '', o.end || '', o.owner || '', o.status || 'active', o.approval || 'draft', o.parent || null, o.archived ? 1 : 0, o.raci?.R || '', o.raci?.A || '', o.raci?.C || '', o.raci?.I || '', o.review?.selfScore ?? null, o.review?.managerScore ?? null, o.review?.selfNote || '', o.review?.managerNote || '', o.review?.reviewDate || null, o.public !== false ? 1 : 0, o.visibleTo ? JSON.stringify(o.visibleTo) : null, o.source?.type || null, o.source?.meetingId || null, o.source?.taskId || null, o.source?.meetingTitle || null, o.source?.meetingDate || null, o.cat || Date.now(), o.upd || Date.now()]
            );
            if (o.krs) { for (const kr of o.krs) { await db.query('INSERT INTO key_results (id,okr_id,title,target,current,unit,owner,status,source_type,source_meeting_id,source_task_id,source_meeting_title,source_meeting_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [kr.id||kr.krId, o.id, kr.t||kr.title, kr.target||0, kr.cur!=null?kr.cur:kr.current||0, kr.u||kr.unit||'%', kr.owner||'', kr.s||kr.status||'active', kr.source?.type||null, kr.source?.meetingId||null, kr.source?.taskId||null, kr.source?.meetingTitle||null, kr.source?.meetingDate||null]); if (kr.log) { for (const l of kr.log) { await db.query('INSERT INTO kr_logs (kr_id,okr_id,date,from_val,to_val,operator) VALUES ($1,$2,$3,$4,$5,$6)', [kr.id||kr.krId, o.id, l.date, l.from, l.to, l.operator||'']); } } } }
            if (o.checkins) { for (const c of o.checkins) { await db.query('INSERT INTO okr_checkins (id,okr_id,date,note,risks,plans,operator) VALUES ($1,$2,$3,$4,$5,$6,$7)', [c.id, o.id, c.date, c.note||'', c.risks||'', c.plans||'', c.operator||'']); } }
          }
        }

        // KPIs
        if (data.kpi_data) { for (const k of data.kpi_data) { await db.query('INSERT INTO kpis (id,name,category,bu,target,current,unit,owner,cycle,history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [k.id, k.name, k.cat||'revenue', k.bu||'', k.target||0, k.cur||0, k.u||'%', k.owner||'', k.cycle||'monthly', JSON.stringify(k.history||{})]); } }

        // Reports
        if (data.rpt_data) { for (const r of data.rpt_data) { await db.query('INSERT INTO reports (id,name,description,freq,deadline_day,deadline_month,owner,companies,group_name,viewers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [r.id, r.name, r.desc||'', r.freq||'monthly', r.deadlineDay||1, r.deadlineMonth||null, r.owner||'', r.companies||'', r.group||null, r.viewers?JSON.stringify(r.viewers):null]); if (r.subs) { for (const [period, sub] of Object.entries(r.subs)) { await db.query('INSERT INTO report_submissions (report_id,period,status,files) VALUES ($1,$2,$3,$4)', [r.id, period, sub.status||'ok', JSON.stringify(sub.files||[])]); } } } }

        // Meetings
        if (data.meeting_data) { for (const m of data.meeting_data) { await db.query('INSERT INTO meetings (id,date,title,attendees,minutes,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [m.id, m.date, m.title, m.attendees||'', m.minutes||'', m.cat||Date.now()]); if (m.tempTasks) { for (const t of m.tempTasks) { await db.query('INSERT INTO meeting_tasks (id,meeting_id,title,owner,deadline,status,sync_to_okr,link_okr_id,link_kr_id,sync_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t.id, m.id, t.title, t.owner||'', t.deadline||'', t.status||'pending', t.syncToOKR?1:0, t.linkOkrId||null, t.linkKrId||null, t.syncStatus||'none']); } } if (m.files) { for (const f of m.files) { await db.query('INSERT INTO meeting_files (id,meeting_id,name,file_id) VALUES ($1,$2,$3,$4)', [f.id, m.id, f.name, f.fileId]); } } if (m.minutesLog) { for (const l of m.minutesLog) { await db.query('INSERT INTO minutes_logs (meeting_id,date,operator,before_text,after_text) VALUES ($1,$2,$3,$4,$5)', [m.id, l.date, l.operator||'', l.before||'', l.after||'']); } } } }

        // Employees & Departments
        if (data.okr_employees) { for (const e of data.okr_employees) { await db.query('INSERT INTO employees (id,name,bu,department,reports_to,position,rank,hire_date,phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [e.id, e.name, e.bu||'', e.department||'', e.reportsTo||'', e.position||'', e.rank||'', e.hireDate||'', e.phone||'']); } }
        if (data.okr_depts) { for (const d of data.okr_depts) { await db.query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [d]); } }

        // Permissions
        if (data.okr_permissions) { for (const [mod, perm] of Object.entries(data.okr_permissions)) { await db.query('INSERT INTO permissions (module,view_users,edit_users) VALUES ($1,$2,$3)', [mod, JSON.stringify(perm.view||[]), JSON.stringify(perm.edit||[])]); } }

        // Attendance
        if (data.okr_attendance) { for (const [date, employees] of Object.entries(data.okr_attendance)) { for (const [name, status] of Object.entries(employees)) { await db.query('INSERT INTO attendance (date,employee_name,status) VALUES ($1,$2,$3)', [date, name, status]); } } }

        // Nudge logs
        if (data.nudge_log) { for (const n of data.nudge_log) { await db.query('INSERT INTO nudge_logs (id,okr_id,title,from_user,to_user,action,date) VALUES ($1,$2,$3,$4,$5,$6,$7)', [n.id, n.oid||'', n.title||'', n.from||'', n.to||'', n.action||'ding', n.date||'']); } }

        // Report group subs
        if (data.rpt_group_subs) { for (const [key, val] of Object.entries(data.rpt_group_subs)) { await db.query('INSERT INTO report_group_subs (group_key,status,files) VALUES ($1,$2,$3)', [key, val.status||'ok', JSON.stringify(val.files||[])]); } }
      });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = { setupRoutes };
