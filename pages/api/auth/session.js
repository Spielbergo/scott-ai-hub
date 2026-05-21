/**
 * pages/api/auth/session.js
 *
 * POST  { idToken }  →  verify Firebase ID token, set HttpOnly session cookie
 * DELETE             →  clear session cookie (sign out)
 */

import { getAuth } from 'firebase-admin/auth';
import { getDb }   from '../../../lib/firebase'; // ensures Admin SDK is initialized

// getDb() initialises firebase-admin as a side-effect
getDb();

const SESSION_COOKIE_NAME = '__session';
const FIVE_DAYS_MS        = 60 * 60 * 24 * 5 * 1000;
const ALLOWED_EMAILS      = ['scott@yopie.ca', 'mike@yopie.ca'];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    try {
      // Verify the token and check the email before issuing a session cookie
      const decoded = await getAuth().verifyIdToken(idToken);
      if (!ALLOWED_EMAILS.includes((decoded.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const sessionCookie = await getAuth().createSessionCookie(idToken, {
        expiresIn: FIVE_DAYS_MS,
      });

      const isProd  = process.env.NODE_ENV === 'production';
      const cookie  = [
        `${SESSION_COOKIE_NAME}=${sessionCookie}`,
        'Path=/',
        'HttpOnly',
        `Max-Age=${FIVE_DAYS_MS / 1000}`,
        'SameSite=Strict',
        isProd ? 'Secure' : '',
      ].filter(Boolean).join('; ');

      res.setHeader('Set-Cookie', cookie);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[session] createSessionCookie failed:', err.message);
      return res.status(401).json({ error: 'Invalid or expired ID token' });
    }
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
