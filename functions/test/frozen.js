'use strict';
/* Runs fn with the clock stopped at a moment (ms since the epoch): `new Date()` and `Date.now()` answer that moment, explicit
   dates are untouched. The engine reads "today" itself when it creates a plan or files an enrollment, so a test written in
   October that expects "the next 1st" to be Nov 1 must not drift once the calendar moves on. */
async function frozen(ms, fn) {
  const Real = Date;
  class Frozen extends Real { constructor(...a) { if (a.length) super(...a); else super(ms); } static now() { return ms; } }
  global.Date = Frozen;
  try { return await fn(); } finally { global.Date = Real; }
}
module.exports = { frozen };
