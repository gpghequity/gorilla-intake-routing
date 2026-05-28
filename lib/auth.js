function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

function checkPassword(submitted) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.warn('[auth] ADMIN_PASSWORD not set in env — rejecting all login attempts.');
    return false;
  }
  if (typeof submitted !== 'string') return false;
  // Constant-time compare
  if (submitted.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < submitted.length; i++) {
    mismatch |= submitted.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

module.exports = { requireAdmin, checkPassword };
