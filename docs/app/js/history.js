// Per-user content history & viral library, backed by Postgres + RLS.
// Replaces the rr_history / rr_viral localStorage blobs, which only ever existed
// on one browser. Reads/writes go straight through the existing `sb` client
// (anon key + the signed-in user's JWT); RLS scopes everything to the user.
//
// Load order in index.html: after auth.js (needs `sb` and `currentUser`).

// --- read: newest first -----------------------------------------------------
async function fetchHistory(limit = 30) {
  const { data, error } = await sb
    .from('generations')
    .select('id, tool, input, output, preview, saved, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('fetchHistory', error); return []; }
  return data;
}

// --- write: optimistic --------------------------------------------------------
// The UI renders the result immediately from the structured output the proxy
// returned; this insert runs in the background. We only surface an error if the
// save itself fails, so a slow DB never blocks the creator's flow.
async function recordGeneration(tool, input, output, preview) {
  const { data, error } = await sb
    .from('generations')
    .insert({ tool, input, output, preview }) // user_id defaults to auth.uid()
    .select('id, created_at')
    .single();
  if (error) { console.error('recordGeneration', error); showToast("Couldn't save to your history"); return null; }
  return data;
}

async function setSaved(id, saved) {
  const { error } = await sb.from('generations').update({ saved }).eq('id', id);
  if (error) { console.error('setSaved', error); showToast("Couldn't update that"); }
}

async function deleteGeneration(id) {
  const { error } = await sb.from('generations').delete().eq('id', id);
  if (error) { console.error('deleteGeneration', error); showToast("Couldn't delete that"); }
}

// --- viral library ----------------------------------------------------------
async function fetchViral() {
  const { data, error } = await sb
    .from('viral_posts')
    .select('id, platform, text, note, created_at')
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchViral', error); return []; }
  return data;
}
async function saveViral(platform, text, note) {
  const { data, error } = await sb
    .from('viral_posts')
    .insert({ platform, text, note })
    .select('id')
    .single();
  if (error) { console.error('saveViral', error); showToast("Couldn't save that"); return null; }
  return data.id;
}
async function deleteViral(id) {
  const { error } = await sb.from('viral_posts').delete().eq('id', id);
  if (error) console.error('deleteViral', error);
}

// --- one-time migration of legacy localStorage data -------------------------
// Run once after the first authenticated load. Lifts any old per-browser
// history/library into Postgres, then clears it so we never double-import.
async function migrateLocalData() {
  if (!currentUser) return;

  const legacyHist = localStorage.getItem('rr_history');
  if (legacyHist) {
    try {
      const rows = JSON.parse(legacyHist)
        .filter(r => r && (r.output || r.preview))
        .map(r => ({
          tool: r.tool ?? 'caption',
          input: null,
          // old rows stored text; wrap it so the column stays valid jsonb
          output: typeof r.output === 'string' ? { text: r.output } : (r.output ?? { text: r.preview ?? '' }),
          preview: r.preview ?? null,
          created_at: r.ts ? new Date(r.ts).toISOString() : new Date().toISOString(),
        }));
      if (rows.length) await sb.from('generations').insert(rows);
    } catch (e) { console.error('history migration', e); }
    localStorage.removeItem('rr_history');
  }

  const legacyViral = localStorage.getItem('rr_viral');
  if (legacyViral) {
    try {
      const rows = JSON.parse(legacyViral)
        .filter(p => p && p.text)
        .map(p => ({ platform: p.platform ?? null, text: p.text, note: p.note ?? null }));
      if (rows.length) await sb.from('viral_posts').insert(rows);
    } catch (e) { console.error('viral migration', e); }
    localStorage.removeItem('rr_viral');
  }
}
