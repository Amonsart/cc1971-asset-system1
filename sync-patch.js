async function uploadAssetPhotoToStorage(asset) {
  const image = String(asset?.imageUrl || '').trim();
  if (!/^data:image\//i.test(image)) return asset;
  const accessToken = await ensureSupabaseSession();
  const blob = await fetch(image).then(response => response.blob());
  const stamp = asset.photoUpdatedAt || new Date().toISOString();
  const path = 'asset-photos/' + encodeURIComponent(asset.id) + '.jpg';
  const uploadUrl = normalizeSupabaseUrl(supabaseConfig.url) + '/storage/v1/object/cc1971-app/' + path;
  const response = await fetch(uploadUrl, { method: 'POST', headers: { apikey: supabaseConfig.key, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob });
  if (!response.ok) throw new Error(await response.text() || 'Asset photo upload failed');
  return { ...asset, imageUrl: normalizeSupabaseUrl(supabaseConfig.url) + '/storage/v1/object/public/cc1971-app/' + path + '?v=' + encodeURIComponent(stamp), photoUpdatedAt: stamp };
}
async function prepareAssetsForCloudSync() {
  const prepared = [];
  for (const asset of assets) prepared.push(await uploadAssetPhotoToStorage(asset));
  const changed = prepared.some((asset, index) => asset.imageUrl !== assets[index]?.imageUrl);
  if (changed) {
    prepared.forEach((asset, index) => { assets[index] = asset; });
    try { localStorage.setItem('cc1971.assets', JSON.stringify(assets)); } catch (e) {}
  }
  return prepared;
}
async function pullAssetRecords() {
  const idRows = await supabaseRest('asset_records?select=id&order=id.asc');
  if (!Array.isArray(idRows) || !idRows.length) return [];
  const records = [];
  for (const row of idRows) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    const payloadRows = await supabaseRest('asset_records?select=payload&id=eq.' + encodeURIComponent(id) + '&limit=1');
    if (Array.isArray(payloadRows) && payloadRows[0]?.payload) records.push({ payload: payloadRows[0].payload });
  }
  return records;
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
    updateCloudStatus('ซิงก์ล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (e) {
    console.warn('Supabase sync failed', e);
    updateCloudStatus('ซิงก์ไม่สำเร็จ — ตรวจสอบ URL, Key และตาราง Supabase', true);
  } finally { cloudSyncInFlight = false; }
}
async function pullFromSupabase() {
  if (!hasSupabaseConfig() || cloudSyncInFlight) return;
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
    if (assets.some(asset => /^data:image\//i.test(String(asset.imageUrl || '')))) void syncAllToSupabase();
  } catch (e) {
    console.warn('Supabase pull failed', e);
    updateCloudStatus('ดึงข้อมูลไม่สำเร็จ — ตรวจสอบสิทธิ์และตาราง Supabase', true);
  }
}
window.syncAllToSupabase = syncAllToSupabase;
window.pullFromSupabase = pullFromSupabase;
