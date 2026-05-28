const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFY_STEVE_EMAILS = '',
  NOTIFY_RYAN_EMAIL = '',
  NOTIFY_STORAGE_EMAIL = '',
  APP_BASE_URL = 'http://localhost:3001'
} = process.env;

const STEVE = NOTIFY_STEVE_EMAILS.split(',').map(s => s.trim()).filter(Boolean);
const RYAN = NOTIFY_RYAN_EMAIL.trim();
const STORAGE = NOTIFY_STORAGE_EMAIL.trim();
const FROM = SMTP_FROM || 'notifications@gorillarealty.local';

let transporter = null;
const smtpReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

if (smtpReady) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  console.log(`[email] SMTP configured via ${SMTP_HOST}:${SMTP_PORT || 587}`);
} else {
  console.log('[email] SMTP creds not set — emails will be logged to console only.');
}

async function send({ to, subject, html, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) return { skipped: 'no recipients' };

  if (!smtpReady) {
    console.log('\n================ [EMAIL — CONSOLE FALLBACK] ================');
    console.log('From:   ', FROM);
    console.log('To:     ', recipients.join(', '));
    console.log('Subject:', subject);
    console.log('------------------------------------------------------------');
    console.log(text || html);
    console.log('============================================================\n');
    return { logged: true };
  }

  try {
    const info = await transporter.sendMail({
      from: FROM,
      to: recipients.join(', '),
      subject,
      text,
      html
    });
    console.log(`[email] sent to ${recipients.join(', ')} (messageId=${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return { error: err.message };
  }
}

function renderSummary(submission) {
  const payload = typeof submission.payload === 'string'
    ? JSON.parse(submission.payload)
    : submission.payload;

  const lines = [
    `Type: ${submission.type.toUpperCase()}`,
    `Submitted: ${submission.submitted_at}`,
    `ID: ${submission.id}`,
    submission.listed_flag ? '*** LISTED PROPERTY — BROKER REVIEW REQUIRED ***' : null,
    submission.storage_flag ? '*** STORAGE VERTICAL ***' : null,
    '',
    '----- SUBMISSION DETAILS -----'
  ].filter(Boolean);

  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined || v === '') continue;
    const value = Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    lines.push(`${k}: ${value}`);
  }

  lines.push('');
  lines.push(`Dashboard: ${APP_BASE_URL}/admin/submissions/${submission.id}`);
  return lines.join('\n');
}

function recipientsFor(submission) {
  if (submission.type === 'buyer') return STEVE;
  if (submission.type === 'agent') return STEVE;
  if (submission.type === 'seller') {
    if (submission.listed_flag) return [...STEVE, RYAN].filter(Boolean);
    if (submission.storage_flag) return [STORAGE].filter(Boolean);
    return [...STEVE, RYAN].filter(Boolean);
  }
  return STEVE;
}

async function notifyNewSubmission(submission) {
  const to = recipientsFor(submission);
  const typeLabel = submission.type === 'seller' ? 'Seller / Deal'
                  : submission.type === 'buyer' ? 'Buyer Introduction'
                  : 'Agent Join Application';
  const tags = [];
  if (submission.listed_flag) tags.push('LISTED');
  if (submission.storage_flag) tags.push('STORAGE');
  const subject = `[Gorilla Intake] New ${typeLabel}${tags.length ? ' — ' + tags.join(' / ') : ''}`;
  const text = renderSummary(submission);
  return send({ to, subject, text });
}

async function notifyAgentAssigned(submission, agent) {
  const subject = `[Gorilla Realty] New lead assigned to you — ${submission.type}`;
  const text = [
    `Hi ${agent.full_name},`,
    '',
    `You've been assigned a new ${submission.type} submission from the Gorilla intake system.`,
    '',
    renderSummary(submission),
    '',
    'Please reach out and log activity in the dashboard.'
  ].join('\n');
  return send({ to: agent.email, subject, text });
}

module.exports = {
  send,
  notifyNewSubmission,
  notifyAgentAssigned,
  renderSummary,
  recipientsFor,
  smtpReady
};
