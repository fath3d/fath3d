/*
 * Local prototype for revision-guarded persistence of the existing Manager
 * document. No migration is automatic; the caller must explicitly request it.
 */
export function createManagerVersionedPersistence({ db, docRef, sdk, recoveryStore }) {
  if (!db || !docRef || !sdk || typeof sdk.getDocFromServer !== 'function'
      || typeof sdk.runTransaction !== 'function' || typeof recoveryStore?.read !== 'function'
      || typeof recoveryStore?.write !== 'function') {
    throw new Error('MANAGER_VERSIONED_PERSISTENCE_CONFIG_INVALID');
  }

  let loaded = false;
  let exists = false;
  let revision = null;
  let lastPayload = null;

  function pendingRecords() {
    const value = recoveryStore.read();
    return Array.isArray(value) ? value : [];
  }
  function persistPending(record) {
    const records = pendingRecords();
    records.push(record);
    recoveryStore.write(records);
  }
  function removePending(id) {
    recoveryStore.write(pendingRecords().filter(item => item.id !== id));
  }
  function parseEnvelope(snapshot) {
    if (!snapshot || !snapshot.exists()) return { exists: false, data: null, revision: 0, payload: null };
    const envelope = snapshot.data();
    if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.updated !== 'string') {
      throw new Error('MANAGER_ENVELOPE_INVALID');
    }
    let data;
    try { data = JSON.parse(envelope.payload); }
    catch { throw new Error('MANAGER_PAYLOAD_INVALID'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('MANAGER_PAYLOAD_INVALID');
    const validRevision = Number.isSafeInteger(envelope.revision) && envelope.revision >= 1;
    return { exists: true, data, revision: validRevision ? envelope.revision : null, payload: envelope.payload, envelope };
  }
  async function load() {
    const snapshot = await sdk.getDocFromServer(docRef);
    const parsed = parseEnvelope(snapshot);
    loaded = true;
    exists = parsed.exists;
    revision = parsed.revision;
    lastPayload = parsed.payload;
    return { exists, data: parsed.data, revision, revisionInitialized: Number.isSafeInteger(revision) };
  }
  async function observeSnapshot(snapshot) {
    const parsed = parseEnvelope(snapshot);
    if (!parsed.exists) return null;
    loaded = true;
    exists = true;
    revision = parsed.revision;
    lastPayload = parsed.payload;
    return parsed.data;
  }
  function observeCommittedEnvelope(payload, committedRevision) {
    if (typeof payload !== 'string' || !Number.isSafeInteger(committedRevision) || committedRevision < 1) {
      throw new Error('MANAGER_ENVELOPE_INVALID');
    }
    JSON.parse(payload);
    loaded = true;
    exists = true;
    revision = committedRevision;
    lastPayload = payload;
    return getState();
  }
  async function initializeRevision({ confirmed = false } = {}) {
    if (confirmed !== true) throw new Error('MANAGER_REVISION_INITIALIZATION_CONFIRMATION_REQUIRED');
    if (pendingRecords().length) throw new Error('MANAGER_RECOVERY_REQUIRED');
    const before = parseEnvelope(await sdk.getDocFromServer(docRef));
    if (!before.exists) throw new Error('MANAGER_DOCUMENT_NOT_FOUND');
    if (Number.isSafeInteger(before.revision)) throw new Error('MANAGER_REVISION_ALREADY_INITIALIZED');
    const result = await sdk.runTransaction(db, async transaction => {
      const current = parseEnvelope(await transaction.get(docRef));
      if (!current.exists || Number.isSafeInteger(current.revision)) throw new Error('MANAGER_REVISION_INITIALIZATION_CONFLICT');
      if (current.payload !== before.payload || current.envelope.updated !== before.envelope.updated) {
        throw new Error('MANAGER_REVISION_INITIALIZATION_CONFLICT');
      }
      transaction.update(docRef, { revision: 1 });
      return { payload: current.payload, revision: 1 };
    });
    loaded = true;
    exists = true;
    revision = result.revision;
    lastPayload = result.payload;
    return { ok: true, revision, payloadUnchanged: true };
  }
  async function commitPayload(data, { expectedRevision = revision, reason = 'manager.save' } = {}) {
    const payload = JSON.stringify(data);
    if (typeof payload !== 'string' || payload.length === 0) throw new Error('MANAGER_PAYLOAD_INVALID');
    if (loaded && exists && payload === lastPayload) return { ok: true, skipped: true, revision };

    const recovery = {
      id: `manager-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      expectedRevision,
      reason,
      createdAt: new Date().toISOString(),
      payload,
      status: 'pending'
    };
    persistPending(recovery);
    let preflightError = null;
    if (!loaded) preflightError = 'MANAGER_REVISION_NOT_LOADED';
    else if (!exists) preflightError = 'MANAGER_DOCUMENT_NOT_INITIALIZED';
    else if (!Number.isSafeInteger(revision) || revision < 1) preflightError = 'MANAGER_REVISION_NOT_INITIALIZED';
    else if (pendingRecords().some(item => item.id !== recovery.id)) preflightError = 'MANAGER_RECOVERY_REQUIRED';
    else if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== revision) preflightError = 'MANAGER_REVISION_CONFLICT';
    if (preflightError) {
      recovery.status = 'blocked';
      recovery.error = preflightError;
      recoveryStore.write(pendingRecords().map(item => item.id === recovery.id ? recovery : item));
      throw new Error(preflightError);
    }
    try {
      const result = await sdk.runTransaction(db, async transaction => {
        const current = parseEnvelope(await transaction.get(docRef));
        if (!current.exists || !Number.isSafeInteger(current.revision)) throw new Error('MANAGER_REVISION_NOT_INITIALIZED');
        if (current.revision !== expectedRevision) throw new Error('MANAGER_REVISION_CONFLICT');
        if (current.payload !== lastPayload) throw new Error('MANAGER_REVISION_CONFLICT');
        transaction.update(docRef, {
          payload,
          updated: new Date().toISOString(),
          revision: expectedRevision + 1
        });
        return { revision: expectedRevision + 1 };
      });
      revision = result.revision;
      exists = true;
      loaded = true;
      lastPayload = payload;
      removePending(recovery.id);
      return { ok: true, skipped: false, revision };
    } catch (error) {
      const errorText=String(error&&error.message||'');
      recovery.status = errorText==='MANAGER_REVISION_CONFLICT'||/PERMISSION_DENIED|permission-denied/.test(errorText) ? 'conflict' : 'uncertain';
      recovery.error = error && error.message || 'MANAGER_WRITE_FAILED';
      recoveryStore.write(pendingRecords().map(item => item.id === recovery.id ? recovery : item));
      throw error;
    }
  }
  async function save(data, options = {}) {
    return commitPayload(data, options);
  }
  function getState() {
    return { loaded, exists, revision, revisionInitialized: Number.isSafeInteger(revision), recoveryCount: pendingRecords().length };
  }
  return Object.freeze({ load, observeSnapshot, observeCommittedEnvelope, initializeRevision, save, commitPayload, getState });
}

/*
 * Atomic preparation transfer: the helper changes only products[].stocks
 * in a freshly loaded Manager payload, then delegates the single document
 * transaction/revision check to the existing versioned persistence service.
 * The caller owns the live-write gate; it is deliberately closed in Manager.
 */
export function createMarketToHomeTransferService({ persistence, isWriteEnabled = () => false, now = () => Date.now(), createId = () => globalThis.crypto?.randomUUID?.() }) {
  if (!persistence || typeof persistence.load !== 'function' || typeof persistence.save !== 'function'
      || typeof isWriteEnabled !== 'function' || typeof now !== 'function' || typeof createId !== 'function') {
    throw new Error('MARKET_TO_HOME_TRANSFER_CONFIG_INVALID');
  }
  const ttlMs = 600000;
  let current = null;
  let inFlight = false;
  const consumed = new Set();

  function analyze(snapshot) {
    const anomalies = [];
    if (!snapshot?.exists) anomalies.push({ code: 'MANAGER_DOCUMENT_NOT_INITIALIZED', message: 'Le document Manager n’existe pas.' });
    if (snapshot?.revisionInitialized !== true || !Number.isSafeInteger(snapshot?.revision) || snapshot.revision < 1) {
      anomalies.push({ code: 'MANAGER_REVISION_NOT_INITIALIZED', message: 'La révision sécurisée du Manager n’est pas initialisée.' });
    }
    const products = snapshot?.data?.products;
    if (!Array.isArray(products) || products.length === 0) {
      anomalies.push({ code: 'MANAGER_PRODUCTS_INVALID', message: 'La liste des produits est absente ou vide.' });
      return { anomalies, items: [], pieces: 0 };
    }
    const seenIds = new Set();
    const items = [];
    let pieces = 0;
    for (let index = 0; index < products.length; index++) {
      const product = products[index];
      const label = String(product?.name || product?.id || `ligne ${index + 1}`);
      if (!product || (typeof product.id !== 'string' && typeof product.id !== 'number') || String(product.id).trim() === '') {
        anomalies.push({ code: 'PRODUCT_ID_INVALID', message: `${label} : identifiant produit absent ou invalide.` });
        continue;
      }
      const productKey = String(product.id);
      if (seenIds.has(productKey)) {
        anomalies.push({ code: 'PRODUCT_ID_DUPLICATE', message: `${label} : identifiant produit dupliqué (${productKey}).` });
        continue;
      }
      seenIds.add(productKey);
      const stocks = product.stocks;
      if (!stocks || typeof stocks !== 'object' || Array.isArray(stocks)) {
        anomalies.push({ code: 'STOCKS_INVALID', message: `${label} : données de stock absentes ou incohérentes.` });
        continue;
      }
      let invalid = false;
      for (const field of ['maison', 'marche']) {
        const value = stocks[field];
        if (!Object.prototype.hasOwnProperty.call(stocks, field) || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
          anomalies.push({ code: 'STOCK_QUANTITY_INVALID', message: `${label} : quantité ${field} inconnue, négative ou non entière.` });
          invalid = true;
        }
      }
      if (invalid) continue;
      const total = stocks.maison + stocks.marche;
      if (!Number.isSafeInteger(total)) {
        anomalies.push({ code: 'STOCK_TOTAL_INVALID', message: `${label} : total Maison + Marché hors plage sûre.` });
        continue;
      }
      if (stocks.marche > 0) {
        const nextHome = stocks.maison + stocks.marche;
        if (!Number.isSafeInteger(nextHome)) {
          anomalies.push({ code: 'STOCK_TRANSFER_OVERFLOW', message: `${label} : transfert hors plage sûre.` });
          continue;
        }
        pieces += stocks.marche;
        if (!Number.isSafeInteger(pieces)) {
          anomalies.push({ code: 'TRANSFER_TOTAL_OVERFLOW', message: 'Le total de pièces à transférer dépasse la plage sûre.' });
          pieces = 0;
          continue;
        }
        items.push({ id: product.id, name: label, marketBefore: stocks.marche, homeBefore: stocks.maison, homeAfter: nextHome, totalBefore: total });
      }
    }
    return { anomalies, items, pieces };
  }

  function validateSingleProduct(snapshot, productId) {
    if (!snapshot?.exists) throw new Error('MANAGER_DOCUMENT_NOT_INITIALIZED');
    if (snapshot.revisionInitialized !== true || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new Error('MANAGER_REVISION_NOT_INITIALIZED');
    if (typeof productId !== 'string' && typeof productId !== 'number') throw new Error('PRODUCT_ID_INVALID');
    const products = snapshot.data?.products;
    if (!Array.isArray(products)) throw new Error('MANAGER_PRODUCTS_INVALID');
    const key = String(productId);
    const matches = products.filter(product => String(product?.id) === key);
    if (matches.length !== 1) throw new Error(matches.length ? 'PRODUCT_ID_DUPLICATE' : 'PRODUCT_NOT_FOUND');
    const product = matches[0];
    const stocks = product?.stocks;
    if (!stocks || typeof stocks !== 'object' || Array.isArray(stocks)) throw new Error('STOCKS_INVALID');
    for (const field of ['maison', 'marche']) {
      if (!Object.prototype.hasOwnProperty.call(stocks, field) || typeof stocks[field] !== 'number' || !Number.isSafeInteger(stocks[field]) || stocks[field] < 0) throw new Error('STOCK_QUANTITY_INVALID');
    }
      if (!Number.isSafeInteger(stocks.maison + stocks.marche)) throw new Error('STOCK_TOTAL_INVALID');
    return product;
  }

  function proposal(snapshot, kind, items, pieces = 0) {
    if (!items.length) return { ok: true, noOp: true, references: 0, pieces: 0, items: [], revision: snapshot.revision };
    const proposalId = createId();
    if (typeof proposalId !== 'string' || !proposalId) throw new Error('TRANSFER_PROPOSAL_ID_INVALID');
    current = { proposalId, kind, revision: snapshot.revision, payload: JSON.stringify(snapshot.data), createdAt: now(), items, pieces };
    return { ok: true, noOp: false, proposalId, operation: kind, revision: current.revision, createdAt: current.createdAt, references: items.length, pieces,
      items: current.items.map(item => ({ ...item,
        maisonBefore: item.maisonBefore ?? item.homeBefore,
        marcheBefore: item.marcheBefore ?? item.marketBefore,
        maisonAfter: item.maisonAfter ?? item.homeAfter,
        marcheAfter: item.marcheAfter ?? 0,
        homeAfter: item.homeAfter ?? item.maisonAfter,
        marketAfter: item.marketAfter ?? item.marcheAfter ?? 0
      })) };
  }

  async function preview() {
    if (inFlight) throw new Error('TRANSFER_EXECUTION_IN_PROGRESS');
    const snapshot = await persistence.load();
    const checked = analyze(snapshot);
    current = null;
    if (checked.anomalies.length) return { ok: false, anomalies: checked.anomalies, references: 0, pieces: 0, items: [], revision: snapshot?.revision ?? null };
    if (checked.items.length === 0) return { ok: true, noOp: true, references: 0, pieces: 0, items: [], revision: snapshot.revision };
    return proposal(snapshot, 'global_market_to_home', checked.items, checked.pieces);
  }

  async function previewTransfer({ productId, quantity, source, destination } = {}) {
    if (inFlight) throw new Error('TRANSFER_EXECUTION_IN_PROGRESS');
    if (!['maison', 'marche'].includes(source) || !['maison', 'marche'].includes(destination) || source === destination) throw new Error('TRANSFER_DIRECTION_INVALID');
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('TRANSFER_QUANTITY_INVALID');
    const snapshot = await persistence.load();
    current = null;
    try {
      const product = validateSingleProduct(snapshot, productId);
      if (product.stocks[source] < quantity) throw new Error('INSUFFICIENT_STOCK');
      const nextDestination = product.stocks[destination] + quantity;
      if (!Number.isSafeInteger(nextDestination)) throw new Error('STOCK_TRANSFER_OVERFLOW');
      return proposal(snapshot, 'individual_transfer', [{
        id: product.id, name: String(product.name || product.id), quantity, source, destination,
        maisonBefore: product.stocks.maison, marcheBefore: product.stocks.marche,
        maisonAfter: source === 'maison' ? product.stocks.maison - quantity : nextDestination,
        marcheAfter: source === 'marche' ? product.stocks.marche - quantity : nextDestination,
        totalBefore: product.stocks.maison + product.stocks.marche
      }], quantity);
    } catch (error) {
      return { ok: false, anomalies: [{ code: error.message, message: transferErrorMessage(error.message) }], references: 0, pieces: 0, items: [], revision: snapshot?.revision ?? null };
    }
  }

  async function previewCounts({ productId, maison, marche } = {}) {
    if (inFlight) throw new Error('TRANSFER_EXECUTION_IN_PROGRESS');
    for (const [field, value] of [['maison', maison], ['marche', marche]]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`COUNT_${field.toUpperCase()}_INVALID`);
    }
    const snapshot = await persistence.load();
    current = null;
    try {
      const product = validateSingleProduct(snapshot, productId);
      if (!Number.isSafeInteger(maison + marche)) throw new Error('COUNT_TOTAL_INVALID');
      const changed = product.stocks.maison !== maison || product.stocks.marche !== marche;
      if (!changed) return { ok: true, noOp: true, references: 0, pieces: 0, items: [], revision: snapshot.revision };
      return proposal(snapshot, 'physical_count', [{
        id: product.id, name: String(product.name || product.id), maisonBefore: product.stocks.maison,
        marcheBefore: product.stocks.marche, maisonAfter: maison, marcheAfter: marche,
        totalBefore: product.stocks.maison + product.stocks.marche, totalAfter: maison + marche
      }], 0);
    } catch (error) {
      return { ok: false, anomalies: [{ code: error.message, message: transferErrorMessage(error.message) }], references: 0, pieces: 0, items: [], revision: snapshot?.revision ?? null };
    }
  }

  async function previewCount({ productId, location, quantity } = {}) {
    if (inFlight) throw new Error('TRANSFER_EXECUTION_IN_PROGRESS');
    if (!['maison', 'marche'].includes(location)) throw new Error('COUNT_LOCATION_INVALID');
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('COUNT_QUANTITY_INVALID');
    const snapshot = await persistence.load();
    current = null;
    try {
      const product = validateSingleProduct(snapshot, productId);
      const maison = location === 'maison' ? quantity : product.stocks.maison;
      const marche = location === 'marche' ? quantity : product.stocks.marche;
      if (!Number.isSafeInteger(maison + marche)) throw new Error('COUNT_TOTAL_INVALID');
      if (product.stocks[location] === quantity) return { ok: true, noOp: true, references: 0, pieces: 0, items: [], revision: snapshot.revision };
      return proposal(snapshot, 'physical_count', [{ id: product.id, name: String(product.name || product.id), maisonBefore: product.stocks.maison,
        marcheBefore: product.stocks.marche, maisonAfter: maison, marcheAfter: marche,
        totalBefore: product.stocks.maison + product.stocks.marche, totalAfter: maison + marche }], 0);
    } catch (error) {
      return { ok: false, anomalies: [{ code: error.message, message: transferErrorMessage(error.message) }], references: 0, pieces: 0, items: [], revision: snapshot?.revision ?? null };
    }
  }

  function cancel(proposalId, { explicit = false } = {}) {
    if (explicit !== true) throw new Error('EXPLICIT_CANCELLATION_REQUIRED');
    if (!current || proposalId !== current.proposalId || consumed.has(proposalId)) throw new Error('TRANSFER_PROPOSAL_INVALID');
    consumed.add(proposalId);
    current = null;
    return { status: 'cancelled', writePerformed: false };
  }

  async function confirm(proposalId, { explicit = false } = {}) {
    if (explicit !== true) throw new Error('EXPLICIT_CONFIRMATION_REQUIRED');
    if (inFlight) throw new Error('TRANSFER_EXECUTION_IN_PROGRESS');
    if (!current || proposalId !== current.proposalId || consumed.has(proposalId)) throw new Error('TRANSFER_PROPOSAL_INVALID');
    if (now() - current.createdAt > ttlMs) { consumed.add(proposalId); current = null; throw new Error('TRANSFER_PROPOSAL_EXPIRED'); }
    if (!isWriteEnabled()) throw new Error('MANAGER_VERSIONED_WRITES_DISABLED');
    inFlight = true;
    consumed.add(proposalId);
    const proposal = current;
    current = null;
    try {
      const latest = await persistence.load();
      if (!latest?.exists || latest.revisionInitialized !== true || latest.revision !== proposal.revision
          || JSON.stringify(latest.data) !== proposal.payload) throw new Error('MANAGER_REVISION_CONFLICT');
      if (proposal.kind === 'global_market_to_home') {
        const checked = analyze(latest);
        if (checked.anomalies.length) throw new Error(checked.anomalies[0].code);
        if (!checked.items.length || checked.items.length !== proposal.items.length || checked.pieces !== proposal.pieces) throw new Error('TRANSFER_PREVIEW_MISMATCH');
      } else {
        const item = proposal.items[0];
        const product = validateSingleProduct(latest, item.id);
        if (product.stocks.maison !== item.maisonBefore || product.stocks.marche !== item.marcheBefore) throw new Error('TRANSFER_PREVIEW_MISMATCH');
        if (proposal.kind === 'individual_transfer' && product.stocks[item.source] < item.quantity) throw new Error('INSUFFICIENT_STOCK');
      }
      const next = JSON.parse(proposal.payload);
      const beforeById = new Map(proposal.items.map(item => [String(item.id), item]));
      for (const product of next.products) {
        const item = beforeById.get(String(product.id));
        if (!item) continue;
        const oldTotal = product.stocks.maison + product.stocks.marche;
        if (proposal.kind === 'global_market_to_home') {
          product.stocks.maison += product.stocks.marche;
          product.stocks.marche = 0;
          if (!Number.isSafeInteger(product.stocks.maison) || product.stocks.maison + product.stocks.marche !== oldTotal) throw new Error('TRANSFER_TOTAL_CONSERVATION_FAILED');
        } else if (proposal.kind === 'individual_transfer') {
          product.stocks.maison = item.maisonAfter;
          product.stocks.marche = item.marcheAfter;
          if (!Number.isSafeInteger(product.stocks.maison) || !Number.isSafeInteger(product.stocks.marche) || product.stocks.maison + product.stocks.marche !== oldTotal) throw new Error('TRANSFER_TOTAL_CONSERVATION_FAILED');
        } else if (proposal.kind === 'physical_count') {
          product.stocks.maison = item.maisonAfter;
          product.stocks.marche = item.marcheAfter;
          if (!Number.isSafeInteger(product.stocks.maison) || !Number.isSafeInteger(product.stocks.marche) || product.stocks.maison < 0 || product.stocks.marche < 0) throw new Error('COUNT_RESULT_INVALID');
        } else {
          throw new Error('TRANSFER_OPERATION_INVALID');
        }
      }
      const reason = proposal.kind === 'global_market_to_home' ? 'stock.transfer.market_to_home'
        : proposal.kind === 'individual_transfer' ? 'stock.transfer.individual' : 'stock.physical_count';
      const saved = await persistence.save(next, { expectedRevision: proposal.revision, reason });
      if (!saved || saved.ok !== true || saved.revision !== proposal.revision + 1) throw new Error('TRANSFER_COMMIT_NOT_CONFIRMED');
      const resultItems = proposal.items.map(item => proposal.kind === 'global_market_to_home'
        ? ({ id: item.id, name: item.name, marketBefore: item.marketBefore, homeAfter: item.homeAfter, total: item.totalBefore })
        : ({ id: item.id, name: item.name, maisonBefore: item.maisonBefore, marcheBefore: item.marcheBefore, homeAfter: item.maisonAfter, marketAfter: item.marcheAfter, totalBefore: item.totalBefore, totalAfter: item.maisonAfter + item.marcheAfter }));
      return { status: 'executed', references: proposal.items.length, pieces: proposal.pieces, revision: saved.revision,
        operation: proposal.kind, items: resultItems, writePerformed: !saved.skipped };
    } finally {
      inFlight = false;
    }
  }

  return Object.freeze({ preview, previewTransfer, previewCounts, previewCount, confirm, cancel, getState: () => ({ pendingProposal: !!current, inFlight, consumedCount: consumed.size, ttlMs }) });
}

function transferErrorMessage(code) {
  const messages = {
    MANAGER_DOCUMENT_NOT_INITIALIZED: 'Le document Manager n’est pas initialisé.',
    MANAGER_REVISION_NOT_INITIALIZED: 'La révision sécurisée du Manager n’est pas initialisée.',
    MANAGER_PRODUCTS_INVALID: 'La liste des produits est absente ou invalide.',
    PRODUCT_ID_INVALID: 'Identifiant produit invalide.', PRODUCT_ID_DUPLICATE: 'Cet identifiant produit est ambigu dans les données.',
    PRODUCT_NOT_FOUND: 'Produit introuvable dans le Manager.', STOCKS_INVALID: 'Les données de stock sont absentes ou incohérentes.',
    STOCK_QUANTITY_INVALID: 'Une quantité de stock est inconnue, négative ou non entière.',
    TRANSFER_DIRECTION_INVALID: 'La direction du transfert est invalide.', TRANSFER_QUANTITY_INVALID: 'La quantité à transférer doit être un entier positif.',
    INSUFFICIENT_STOCK: 'La quantité demandée dépasse le stock disponible à l’origine.', STOCK_TRANSFER_OVERFLOW: 'La quantité résultante dépasse la limite autorisée.',
    COUNT_MAISON_INVALID: 'Le comptage Maison doit être un entier positif ou nul.', COUNT_MARCHE_INVALID: 'Le comptage Marché doit être un entier positif ou nul.',
    COUNT_LOCATION_INVALID: 'L’emplacement de comptage est invalide.', COUNT_QUANTITY_INVALID: 'Le comptage doit être un entier positif ou nul.', COUNT_TOTAL_INVALID: 'Le total compté dépasse la limite autorisée.', STOCK_TOTAL_INVALID: 'Le total des stocks dépasse la limite autorisée.'
  };
  return messages[code] || code;
}
