/* The database rules of the team's messaging (firestore.rules, teamChats / teamReads), checked on the Firestore emulator with invented people.
   Not part of `npm test` (it needs Java and the emulator): .github/workflows/rules.yml runs it on every change to firestore.rules. */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-pw', firestore: { rules: fs.readFileSync(process.env.RULES || 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8787 } });
  const U = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore();
  const dee = U('u1', 'dee@x.test'), kim = U('u2', 'kim@x.test'), lee = U('u3', 'lee@x.test'), out = U('u4', 'out@x.test'), off = U('u5', 'off@x.test'), own = U('PDKJkouns6g6zA1jrABJijEr3oq2', 'ops@x.test');
  await env.withSecurityRulesDisabled(async (c) => { const d = c.firestore();
    await d.doc('staff/dee@x.test').set({ active: true, role: 'director', pages: ['coach-portal'] }); await d.doc('staff/kim@x.test').set({ active: true, role: 'coach', pages: [] });
    await d.doc('staff/lee@x.test').set({ active: true, role: 'coach' }); await d.doc('staff/off@x.test').set({ active: false, role: 'coach' });
    await d.doc('teamChats/general').set({ kind: 'channel', name: 'general', private: false, everyone: true, members: ['dee@x.test'], createdBy: 'dee@x.test' });
    await d.doc('teamChats/core').set({ kind: 'channel', name: 'core', private: true, members: ['dee@x.test'], createdBy: 'dee@x.test' });
    await d.doc('teamChats/dm1').set({ kind: 'dm', members: ['dee@x.test', 'kim@x.test'], createdBy: 'kim@x.test' });
    await d.doc('teamChats/dm1/messages/m1').set({ by: 'kim@x.test', name: 'Kim', text: 'hi', at: 5 });
    await d.doc('teamChats/general/messages/g1').set({ by: 'dee@x.test', name: 'Dee', text: 'hello', at: 5 });
    await d.doc('teamChats/core/messages/c1').set({ by: 'dee@x.test', name: 'Dee', text: 'secret', at: 5 }); });
  const fails = []; const T = async (name, p) => { try { await p; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + ' — ' + String(e.message).slice(0, 140)); fails.push(name); } };
  const FV = require('firebase/compat/app').default.firestore.FieldValue;
  // reading
  await T('a coach lists the chats they are in', assertSucceeds(kim.collection('teamChats').where('members', 'array-contains', 'kim@x.test').get()));
  await T('a coach lists the open channels', assertSucceeds(kim.collection('teamChats').where('kind', '==', 'channel').where('private', '==', false).get()));
  await T('nobody lists every chat', assertFails(kim.collection('teamChats').get()));
  await T('a coach cannot open a private channel they are not in', assertFails(kim.doc('teamChats/core').get()));
  await T('the owner cannot open a direct message they are not in', assertFails(own.doc('teamChats/dm1').get()));
  await T('the owner cannot read its messages', assertFails(own.collection('teamChats/dm1/messages').orderBy('at').limitToLast(300).get()));
  await T('a coach cannot read a private channel\'s messages', assertFails(kim.collection('teamChats/core/messages').orderBy('at').get()));
  await T('a coach reads an open channel before joining', assertSucceeds(kim.collection('teamChats/general/messages').orderBy('at').limitToLast(300).get()));
  await T('a thread query works', assertSucceeds(dee.collection('teamChats/general/messages').where('th', '==', 'g1').get()));
  await T('someone not on the team list reads nothing', assertFails(out.collection('teamChats').where('kind', '==', 'channel').where('private', '==', false).get()));
  await T('someone switched off reads nothing', assertFails(off.collection('teamChats').where('members', 'array-contains', 'off@x.test').get()));
  // joining, writing
  await T('a coach cannot write in an open channel before joining', assertFails(kim.doc('teamChats/general/messages/k1').set({ by: 'kim@x.test', name: 'Kim', text: 'x', at: 6 })));
  await T('a coach joins an open channel', assertSucceeds(kim.doc('teamChats/general').update({ members: FV.arrayUnion('kim@x.test') })));
  await T('a coach cannot add someone else to a channel they are not in', assertFails(lee.doc('teamChats/general').update({ members: FV.arrayUnion('lee@x.test', 'out@x.test') })));
  await T('a coach cannot join a private channel', assertFails(kim.doc('teamChats/core').update({ members: FV.arrayUnion('kim@x.test') })));
  await T('after joining, a coach writes', assertSucceeds(kim.doc('teamChats/general/messages/k1').set({ by: 'kim@x.test', name: 'Kim', text: 'x', at: 6 })));
  await T('and sets the last line', assertSucceeds(kim.doc('teamChats/general').update({ last: { at: 6, by: 'kim@x.test', name: 'Kim', text: 'x' } })));
  await T('nobody writes under someone else\'s name', assertFails(kim.doc('teamChats/general/messages/k2').set({ by: 'dee@x.test', name: 'Dee', text: 'x', at: 6 })));
  await T('nobody writes as the system', assertFails(kim.doc('teamChats/general/messages/k3').set({ by: 'kim@x.test', name: 'K', text: 'x', at: 6, bot: true })));
  await T('a message over the limit is refused', assertFails(kim.doc('teamChats/general/messages/k4').set({ by: 'kim@x.test', name: 'K', text: 'x'.repeat(4001), at: 6 })));
  await T('the author edits', assertSucceeds(kim.doc('teamChats/general/messages/k1').update({ text: 'y', edited: 7, mentions: [] })));
  await T('someone else cannot edit it', assertFails(dee.doc('teamChats/general/messages/k1').update({ text: 'z' })));
  await T('someone else reacts', assertSucceeds(dee.doc('teamChats/general/messages/k1').update({ ['reactions.👍']: FV.arrayUnion('dee@x.test') })));
  await T('someone else counts a thread answer', assertSucceeds(dee.doc('teamChats/general/messages/k1').update({ replies: 1, lastReply: 8 })));
  await T('the author marks it deleted', assertSucceeds(kim.doc('teamChats/general/messages/k1').update({ deleted: true, text: '' })));
  await T('nobody removes a message', assertFails(kim.doc('teamChats/general/messages/k1').delete()));
  await T('nobody changes who wrote it', assertFails(kim.doc('teamChats/general/messages/k1').update({ by: 'dee@x.test' })));
  // making chats
  await T('a coach starts a direct message', assertSucceeds(kim.doc('teamChats/dm2').set({ kind: 'dm', members: ['kim@x.test', 'lee@x.test'], createdBy: 'kim@x.test', createdAt: 1 })));
  await T('a direct message is two people', assertFails(kim.doc('teamChats/dm3').set({ kind: 'dm', members: ['kim@x.test', 'lee@x.test', 'dee@x.test'], createdBy: 'kim@x.test' })));
  await T('a direct message keeps its two people', assertFails(kim.doc('teamChats/dm2').update({ members: FV.arrayUnion('dee@x.test') })));
  await T('a coach starts a group', assertSucceeds(kim.doc('teamChats/g2').set({ kind: 'group', members: ['kim@x.test', 'lee@x.test', 'dee@x.test'], createdBy: 'kim@x.test', createdAt: 1 })));
  await T('a group member adds someone', assertSucceeds(lee.doc('teamChats/g2').update({ members: FV.arrayUnion('off@x.test') })));
  await T('a group member leaves', assertSucceeds(lee.doc('teamChats/g2').update({ members: FV.arrayRemove('lee@x.test') })));
  await T('nobody starts a chat they are not in', assertFails(kim.doc('teamChats/g3').set({ kind: 'group', members: ['lee@x.test', 'dee@x.test'], createdBy: 'kim@x.test' })));
  await T('a coach cannot make a channel', assertFails(kim.doc('teamChats/ch2').set({ kind: 'channel', name: 'ch2', private: false, members: ['kim@x.test'], createdBy: 'kim@x.test' })));
  await T('a director makes a channel', assertSucceeds(dee.doc('teamChats/ch2').set({ kind: 'channel', name: 'ch2', private: false, everyone: false, members: ['dee@x.test', 'kim@x.test'], createdBy: 'dee@x.test', createdAt: 1 })));
  await T('the owner makes a channel (the first visit)', assertSucceeds(own.doc('teamChats/ch3').set({ kind: 'channel', name: 'ch3', private: true, everyone: false, members: ['ops@x.test', 'dee@x.test'], createdBy: 'ops@x.test', createdAt: 1, seed: 's' })));
  await T('a coach in a channel cannot make it private', assertFails(kim.doc('teamChats/ch2').update({ private: true })));
  await T('a coach in a channel changes its topic', assertSucceeds(kim.doc('teamChats/ch2').update({ topic: 'x' })));
  await T('nobody deletes a chat', assertFails(dee.doc('teamChats/ch2').delete()));
  await T('a chat cannot change its kind', assertFails(dee.doc('teamChats/ch2').update({ kind: 'group' })));
  // reads
  await T('your own read marks', assertSucceeds(kim.doc('teamReads/kim@x.test').set({ r: { general: 9 } }, { merge: true })));
  await T('nobody else\'s', assertFails(kim.doc('teamReads/dee@x.test').get()));
  await T('the staff list stays closed to a coach', assertFails(kim.collection('staff').get()));
  await env.cleanup(); console.log(fails.length ? fails.length + ' FAILED' : 'all rules checks passed'); process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
