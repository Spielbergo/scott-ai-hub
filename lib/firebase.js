'use strict';

/**
 * lib/firebase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Firebase Admin SDK singleton.
 * Initialises once; subsequent calls return the cached Firestore instance.
 *
 * Required env vars:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (PEM string; use "\n" literal in GitHub Secrets)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

let _db = null;

function getDb() {
  if (_db) return _db;

  let credential;

  // Prefer the single base64-encoded JSON secret (avoids PEM newline corruption)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    const sa   = JSON.parse(json);
    credential = cert(sa);
  } else {
    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Firebase credentials not set. Add FIREBASE_SERVICE_ACCOUNT_BASE64 (recommended) or ' +
        'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to your environment.'
      );
    }
    credential = cert({ projectId, clientEmail, privateKey });
  }

  if (getApps().length === 0) {
    initializeApp({ credential });
  }

  _db = getFirestore();
  return _db;
}

module.exports = { getDb };
