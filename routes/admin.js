const express = require('express');
const crypto = require('crypto');

const db = require('../db/init');
const { requireAdmin, checkPassword } = require('../lib/auth');
const { pickRoundRobinAgent, markAgentAssigned } = require('../lib/routing');
const email = require('../lib/email');

const router = express.Router();
router.use(express.urlencoded({ extended: true }));

// --- Login / Logout --------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/admin');
  res.render('layout', { page: 'admin/login', title: 'Broker Login', error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (checkPassword(password)) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('layout', {
    page: 'admin/login',
    title: 'Broker Login',
    error: 'Incorrect password.'
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Everything below requires admin
router.use(requireAdmin);

// --- Dashboard -------------------------------------------------------------

function getCounts() {
  const c = {};
  c.inbox    = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE status IN ('new','broker_review')`).get().n;
  c.buyer    = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE type='buyer'`).get().n;
  c.seller   = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE type='seller'`).get().n;
  c.agent    = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE type='agent'`).get().n;
  c.flagged  = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE listed_flag=1 OR status='broker_review'`).get().n;
  c.assigned = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE status='assigned' OR status='in_progress'`).get().n;
  c.closed   = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE status='closed'`).get().n;
  return c;
}

router.get('/', (req, res) => {
  const view = (req.query.view || 'inbox').toString();

  let where = '';
  const params = [];

  switch (view) {
    case 'buyer':    where = `WHERE s.type='buyer'`; break;
    case 'seller':   where = `WHERE s.type='seller'`; break;
    case 'agent':    where = `WHERE s.type='agent'`; break;
    case 'flagged':  where = `WHERE s.listed_flag=1 OR s.status='broker_review'`; break;
    case 'assigned': where = `WHERE s.status='assigned' OR s.status='in_progress'`; break;
    case 'closed':   where = `WHERE s.status='closed'`; break;
    case 'inbox':
    default:         where = `WHERE s.status IN ('new','broker_review')`; break;
  }

  const rows = db.prepare(`
    SELECT s.*, a.full_name AS assigned_agent_name
    FROM submissions s
    LEFT JOIN agents a ON a.id = s.assigned_agent_id
    ${where}
    ORDER BY s.submitted_at DESC
    LIMIT 200
  `).all(...params);

  res.render('layout', {
    page: 'admin/dashboard',
    title: 'Dashboard — Gorilla Intake',
    submissions: rows,
    view,
    counts: getCounts()
  });
});

// --- Submission detail -----------------------------------------------------

function loadSubmission(id) {
  const s = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
  if (!s) return null;
  const uploads = db.prepare(`SELECT * FROM uploads WHERE submission_id = ? ORDER BY uploaded_at`).all(id);
  const assignedAgent = s.assigned_agent_id
    ? db.prepare(`SELECT * FROM agents WHERE id = ?`).get(s.assigned_agent_id)
    : null;
  return { s, uploads, assignedAgent };
}

router.get('/submissions/:id', (req, res) => {
  const loaded = loadSubmission(req.params.id);
  if (!loaded) return res.status(404).send('Not found');

  const agents = db.prepare(`SELECT * FROM agents ORDER BY active DESC, full_name ASC`).all();
  const notifiedTo = email.recipientsFor(loaded.s);

  res.render('layout', {
    page: 'admin/submission',
    title: `Submission — ${loaded.s.type}`,
    s: loaded.s,
    uploads: loaded.uploads,
    assignedAgent: loaded.assignedAgent,
    agents,
    notifiedTo,
    flash: req.query.flash || null
  });
});

router.post('/submissions/:id/status', (req, res) => {
  const { status } = req.body;
  const allowed = ['new','broker_review','assigned','in_progress','closed'];
  if (!allowed.includes(status)) return res.status(400).send('Bad status');

  const closedAt = status === 'closed' ? `, closed_at = datetime('now')` : '';
  db.prepare(`UPDATE submissions SET status = ? ${closedAt} WHERE id = ?`).run(status, req.params.id);
  res.redirect(`/admin/submissions/${req.params.id}?flash=${encodeURIComponent('Status updated.')}`);
});

router.post('/submissions/:id/notes', (req, res) => {
  db.prepare(`UPDATE submissions SET broker_notes = ? WHERE id = ?`).run(req.body.broker_notes || '', req.params.id);
  res.redirect(`/admin/submissions/${req.params.id}?flash=${encodeURIComponent('Notes saved.')}`);
});

router.post('/submissions/:id/assign', async (req, res) => {
  const { agent_id } = req.body;
  const submission = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(req.params.id);
  if (!submission) return res.status(404).send('Not found');
  if (submission.type === 'agent') return res.status(400).send('Cannot assign agent-join submissions.');

  let agent;
  if (agent_id) {
    agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent_id);
    if (!agent) return res.status(400).send('Unknown agent.');
  } else {
    agent = pickRoundRobinAgent();
    if (!agent) {
      return res.redirect(`/admin/submissions/${req.params.id}?flash=${encodeURIComponent('No active agents available.')}`);
    }
  }

  db.prepare(`
    UPDATE submissions
    SET assigned_agent_id = ?, status = 'assigned', assigned_at = datetime('now')
    WHERE id = ?
  `).run(agent.id, req.params.id);

  markAgentAssigned(agent.id);

  const updated = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(req.params.id);
  try {
    await email.notifyAgentAssigned(updated, agent);
  } catch (err) {
    console.error('[admin] notifyAgentAssigned failed:', err.message);
  }

  res.redirect(`/admin/submissions/${req.params.id}?flash=${encodeURIComponent('Assigned to ' + agent.full_name + '.')}`);
});

router.post('/submissions/:id/close', (req, res) => {
  db.prepare(`UPDATE submissions SET status='closed', closed_at=datetime('now') WHERE id = ?`).run(req.params.id);
  res.redirect(`/admin/submissions/${req.params.id}?flash=${encodeURIComponent('Closed.')}`);
});

router.post('/submissions/:id/delete', (req, res) => {
  db.prepare(`DELETE FROM submissions WHERE id = ?`).run(req.params.id);
  res.redirect('/admin');
});

// --- Agents ----------------------------------------------------------------

router.get('/agents', (req, res) => {
  const agents = db.prepare(`
    SELECT * FROM agents
    ORDER BY active DESC, (last_assigned_at IS NULL) DESC, last_assigned_at ASC, full_name ASC
  `).all();

  // Mark the next-up agent for round-robin
  const next = pickRoundRobinAgent();
  agents.forEach(a => { a.is_next_up = !!(next && a.id === next.id); });

  res.render('layout', {
    page: 'admin/agents',
    title: 'Agents — Gorilla Intake',
    agents,
    flash: req.query.flash || null
  });
});

router.post('/agents', (req, res) => {
  const { full_name, email: em, phone } = req.body;
  if (!full_name || !em) return res.status(400).send('Name and email required.');
  db.prepare(`
    INSERT INTO agents (id, full_name, email, phone, active) VALUES (?, ?, ?, ?, 1)
  `).run(crypto.randomUUID(), full_name.trim(), em.trim(), (phone || '').trim());
  res.redirect(`/admin/agents?flash=${encodeURIComponent('Agent added.')}`);
});

router.post('/agents/:id', (req, res) => {
  const { full_name, email: em, phone } = req.body;
  db.prepare(`UPDATE agents SET full_name=?, email=?, phone=? WHERE id = ?`)
    .run((full_name || '').trim(), (em || '').trim(), (phone || '').trim(), req.params.id);
  res.redirect(`/admin/agents?flash=${encodeURIComponent('Agent updated.')}`);
});

router.post('/agents/:id/toggle', (req, res) => {
  const a = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
  if (!a) return res.status(404).send('Not found');
  db.prepare(`UPDATE agents SET active = ? WHERE id = ?`).run(a.active ? 0 : 1, req.params.id);
  res.redirect(`/admin/agents?flash=${encodeURIComponent(a.active ? 'Deactivated.' : 'Activated.')}`);
});

router.post('/agents/:id/delete', (req, res) => {
  db.prepare(`DELETE FROM agents WHERE id = ?`).run(req.params.id);
  res.redirect(`/admin/agents?flash=${encodeURIComponent('Deleted.')}`);
});

module.exports = router;
