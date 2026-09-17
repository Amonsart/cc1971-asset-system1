// Preserve local changes until cloud sync succeeds; stale pulls must not overwrite a fresh save.
let localCloudDirty = localStorage.getItem('cc1971.cloudDirty') === '1';
function saveLocalData() {
  localCloudDirty = true;
  try {
    localStorage.setItem('cc1971.assets', JSON.stringify(assets));
    localStorage.setItem('cc1971.transactions', JSON.stringify(transactions));
    localStorage.setItem('cc1971.auditSession', JSON.stringify(auditSession));
    localStorage.setItem('cc1971.companies', JSON.stringify(companies));
    localStorage.setItem('cc1971.categories', JSON.stringify(assetCategories));
    localStorage.setItem('cc1971.cloudDirty', '1');
  } catch (e) {}
  if (hasSupabaseConfig()) void syncAllToSupabase();
}
async function syncAllToSupabase() {
  if (!hasSupabaseConfig() || cloudSyncInFlight) return;
  cloudSyncInFlight = true;
  try {
    const now = new Date().toISOString();
    const cloudAssets = await prepareAssetsForCloudSync();
    await Promise.all([
      supabaseRest('asset_records?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(cloudAssets.map(asset => ({ id: asset.id, payload: asset, updated_at: now }))) }),
      supabaseRest('company_records?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(companies.map(company => ({ id: company.id, payload: company, updated_at: now }))) }),
      supabaseRest('app_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'cc1971-audit-session', payload: auditSession, updated_at: now }, { key: 'cc1971-transactions', payload: transactions, updated_at: now }, { key: 'cc1971-categories', payload: assetCategories, updated_at: now }]) })
    ]);
    localCloudDirty = false;
    try { localStorage.setItem('cc1971.cloudDirty', '0'); } catch (e) {}
    updateCloudStatus('ซิงก์ล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (e) {
    console.warn('Supabase sync failed', e);
    updateCloudStatus('บันทึกในเครื่องแล้ว · รอซิงก์คลาวด์ใหม่อัตโนมัติ', true);
  } finally { cloudSyncInFlight = false; }
}
async function pullFromSupabase() {
  if (!hasSupabaseConfig() || cloudSyncInFlight || localCloudDirty) return;
  try {
    const [assetRows, companyRows, stateRows] = await Promise.all([pullAssetRecords(), supabaseRest('company_records?select=payload'), supabaseRest('app_state?select=key,payload')]);
    if (Array.isArray(assetRows) && assetRows.length) assets = assetRows.map(row => row.payload).filter(Boolean);
    if (Array.isArray(companyRows) && companyRows.length) companies = companyRows.map(row => row.payload).filter(Boolean);
    if (Array.isArray(stateRows)) {
      const audit = stateRows.find(row => row.key === 'cc1971-audit-session')?.payload;
      const transactionData = stateRows.find(row => row.key === 'cc1971-transactions')?.payload;
      const categoryData = stateRows.find(row => row.key === 'cc1971-categories')?.payload;
      if (audit) auditSession = { active: Boolean(audit.active), name: audit.name || '', startedAt: audit.startedAt || '', audited: audit.audited || {} };
      if (Array.isArray(transactionData)) transactions = transactionData;
      if (Array.isArray(categoryData)) assetCategories = normalizeAssetCategories(categoryData);
    }
    try { localStorage.setItem('cc1971.assets', JSON.stringify(assets)); localStorage.setItem('cc1971.companies', JSON.stringify(companies)); localStorage.setItem('cc1971.auditSession', JSON.stringify(auditSession)); localStorage.setItem('cc1971.transactions', JSON.stringify(transactions)); localStorage.setItem('cc1971.categories', JSON.stringify(assetCategories)); } catch (e) {}
    populateCompanySelectors(); populateCategorySelectors(); refreshActiveView(); renderCompanySettings(); renderCategorySettings();
    updateCloudStatus('ซิงก์ล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (e) { console.warn('Supabase pull failed', e); updateCloudStatus('ดึงข้อมูลไม่สำเร็จ — ข้อมูลในเครื่องยังปลอดภัย', true); }
}
window.syncAllToSupabase = syncAllToSupabase;
window.pullFromSupabase = pullFromSupabase;

// Retry pending local saves while cloud service is temporarily unavailable.
setInterval(() => {
  try {
    if (localStorage.getItem('cc1971.cloudDirty') === '1' && typeof window.syncAllToSupabase === 'function') void window.syncAllToSupabase();
  } catch (e) {}
}, 5000);
