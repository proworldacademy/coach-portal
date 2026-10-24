/* The one Firestore handle the engine writes the roster with (the admin SDK: it is not bound by firestore.rules, so every
   write here is deliberate and listed in lib/roster.js). The tests pass a stand-in instead (test/fake-db.js). */
'use strict';
const admin = require('firebase-admin');   // kept for the namespace types; calls go through the modular API (firebase-admin 14)
if (!require('firebase-admin/app').getApps().length) require('firebase-admin/app').initializeApp();
let db = null;
function get() {
  if (!db) { db = require('firebase-admin/firestore').getFirestore(); try { db.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* already in use */ } }
  return db;
}
module.exports = { get };
