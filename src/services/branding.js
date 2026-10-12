const { query } = require('../db');
const DEFAULT_NAME = 'MOMS — Multichannel Order Management System';
function validateBranding(body) {
  const fail = () => { const error = new Error('Enter a name (1–100 characters) and a PNG, JPEG or WebP logo up to 1 MB.'); error.statusCode = 400; throw error; };
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || /[\x00-\x1f]/.test(body.name)) fail();
  const result = { name: body.name.trim() };
  if (Object.prototype.hasOwnProperty.call(body, 'logo')) {
    if (body.logo === null) result.logo = null;
    else {
      if (typeof body.logo !== 'string' || body.logo.length > 1400000) fail();
      const match = body.logo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) fail();
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 1048576 || bytes.length < 12) fail();
      const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
      if (!valid) fail();
      result.logo = body.logo;
    }
  }
  return result;
}
async function getBranding() {
  const result = await query('SELECT name, logo FROM app_branding WHERE id = true');
  return result.rows[0] || { name: DEFAULT_NAME, logo: null };
}
async function saveBranding(body) {
  const value = validateBranding(body);
  const changedLogo = Object.prototype.hasOwnProperty.call(value, 'logo');
  await query('UPDATE app_branding SET name = $1, logo = CASE WHEN $2 THEN $3 ELSE logo END WHERE id = true', [value.name, changedLogo, value.logo || null]);
  return getBranding();
}
module.exports = { DEFAULT_NAME, validateBranding, getBranding, saveBranding };
