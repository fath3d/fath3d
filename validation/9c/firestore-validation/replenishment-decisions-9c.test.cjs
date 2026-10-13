const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore');
const PROJECT='demo-jarvis-replenishment-9c',HOST='127.0.0.1',PORT=8785,UID='owner-9c-test',OTHER='other-9c-test';
if(process.env.FIRESTORE_EMULATOR_HOST!==HOST+':'+PORT||process.env.GCLOUD_PROJECT!==PROJECT||!PROJECT.startsWith('demo-'))throw new Error('ISOLATION_REQUIRED: emulator and fictitious demo project must be explicit');
const htmlPath=process.env.JARVIS_9C_CANDIDATE_PATH,rulesPath=process.env.JARVIS_9C_COMBINED_RULES_PATH;
if(!htmlPath||!fs.existsSync(htmlPath))throw new Error('EPHEMERAL_CANDIDATE_MANAGER_REQUIRED');
if(!rulesPath||!fs.existsSync(rulesPath))throw new Error('EPHEMERAL_COMBINED_RULES_REQUIRED');
const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script id="jarvis-replenishment-9c-decisions">([\s\S]*?)<\/script>/);
if(!match)throw new Error('9C_DECISION_MODULE_MISSING');
const candidateHash=crypto.createHash('sha256').update(html).digest('hex').toUpperCase();
if(candidateHash!=='C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76')throw new Error('CANDIDATE_MANAGER_HASH_MISMATCH');
const originalWindow=global.window,originalCrypto=global.crypto;
global.window=global;global.crypto=crypto.webcrypto;
let api;
const pathFor=id=>'fath3d/'+UID+'/replenishmentDecisions/'+id;
const parentPath='fath3d/'+UID+'/settings/replenishment';
const tests=[];let env,owner,other,anonymous;
const SAFE_CATEGORIES=new Set([
  'RULES_COMPILATION_FAILURE','RULES_LOAD_FAILURE','EMULATOR_CONNECTION_FAILURE','EMULATOR_SETUP_FAILURE',
  'PERMISSION_DENIED','PERMISSION_PROFILE_MISMATCH','FIXTURE_SETUP_FAILURE',
  'CLIENT_CONTEXT_INIT_FAILURE','UI_INIT_FAILURE','ASSERTION_FAILURE','CANDIDATE_INIT_FAILURE',
  'TEST_LOGIC_FAILURE','UNKNOWN_TEST_FAILURE'
]);
let currentStage='HARNESS_SETUP';
function categoryFor(error,stage=currentStage){
  if(error&&SAFE_CATEGORIES.has(error.safeCategory))return error.safeCategory;
  if(error&&error.name==='AssertionError')return 'ASSERTION_FAILURE';
  const code=String(error&&error.code||'').toLowerCase();
  if(code==='permission-denied'||code==='unauthenticated')return 'PERMISSION_DENIED';
  if(code==='unavailable'||code==='deadline-exceeded'||code==='cancelled')return 'EMULATOR_CONNECTION_FAILURE';
  const message=String(error&&error.message||'').toLowerCase();
  if(/syntax|compile|compil|parse|rules.*invalid|invalid.*rules/.test(message))return 'RULES_COMPILATION_FAILURE';
  if(/econnrefused|unavailable|emulator|connection|deadline/.test(message))return 'EMULATOR_CONNECTION_FAILURE';
  if(stage.includes('CLIENT_CONTEXT')||stage.includes('CONTEXT_INIT')||stage.includes('ADAPTER_INIT'))return 'CLIENT_CONTEXT_INIT_FAILURE';
  if(stage.includes('FIXTURE'))return 'FIXTURE_SETUP_FAILURE';
  if(stage.includes('PERMISSION_PROFILE'))return 'TEST_LOGIC_FAILURE';
  if(stage.includes('RULES_INIT'))return 'RULES_LOAD_FAILURE';
  if(stage.includes('CANDIDATE'))return 'CANDIDATE_INIT_FAILURE';
  if(stage.includes('UI'))return 'UI_INIT_FAILURE';
  return 'UNKNOWN_TEST_FAILURE';
}
async function atStage(id,fn){
  currentStage=id;
  try{return await fn();}
  catch(error){const wrapped=new Error('SAFE_DIAGNOSTIC');wrapped.safeStage=id;wrapped.safeCategory=categoryFor(error,id);if(Array.isArray(error&&error.safePermissionIds))wrapped.safePermissionIds=error.safePermissionIds;throw wrapped;}
}
async function test(name,fn){
  const testId='DECISION_TEST_'+String(tests.filter(item=>item.testId).length+1).padStart(2,'0');
  currentStage='TEST_DATA_RESET';
  try{await env.clearFirestore();currentStage='DECISION_INTEGRATION_TEST';await fn();tests.push({testId,name,status:'RÉUSSI'});}
  catch(error){tests.push({testId,name,status:'ÉCHEC',stage:error.safeStage||currentStage,category:categoryFor(error,error.safeStage||currentStage),permissionIds:Array.isArray(error.safePermissionIds)?error.safePermissionIds:undefined});}
}
async function readable(context,documentPath,stageId){
  return atStage(stageId,async()=>{
    try{await sdk.getDoc(sdk.doc(context,documentPath));return true;}
    catch(error){
      const code=String(error&&error.code||'').toLowerCase();
      if(code==='permission-denied'||code==='unauthenticated')return false;
      throw error;
    }
  });
}
async function existingPermissionProfile(rules,profileId){
  const profileEnv=await atStage(profileId+'_RULES_INIT',()=>initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules}}));
  try{
    await atStage(profileId+'_FIXTURE_RESET',()=>profileEnv.clearFirestore());
    await atStage(profileId+'_FIXTURE_SEED',()=>profileEnv.withSecurityRulesDisabled(async ctx=>{
      await sdk.setDoc(sdk.doc(ctx.firestore(),'fath3d/'+UID),{payload:'synthetic-manager-payload',revision:1});
      await sdk.setDoc(sdk.doc(ctx.firestore(),parentPath),{schemaVersion:1,revision:1,categoryRules:{},lastMutationId:'fixture-rule-mutation-0001'});
    }));
    const owner=await atStage(profileId+'_OWNER_CONTEXT_INIT',()=>profileEnv.authenticatedContext(UID).firestore());
    const other=await atStage(profileId+'_OTHER_CONTEXT_INIT',()=>profileEnv.authenticatedContext(OTHER).firestore());
    const anonymous=await atStage(profileId+'_ANONYMOUS_CONTEXT_INIT',()=>profileEnv.unauthenticatedContext().firestore());
    const profile={};
    profile.managerOwnerRead=await readable(owner,'fath3d/'+UID,profileId+'_PROFILE_MANAGER_OWNER_READ');
    profile.settingsOwnerRead=await readable(owner,parentPath,profileId+'_PROFILE_SETTINGS_OWNER_READ');
    profile.managerOtherRead=await readable(other,'fath3d/'+UID,profileId+'_PROFILE_MANAGER_OTHER_READ');
    profile.settingsOtherRead=await readable(other,parentPath,profileId+'_PROFILE_SETTINGS_OTHER_READ');
    profile.managerAnonymousRead=await readable(anonymous,'fath3d/'+UID,profileId+'_PROFILE_MANAGER_ANONYMOUS_READ');
    profile.settingsAnonymousRead=await readable(anonymous,parentPath,profileId+'_PROFILE_SETTINGS_ANONYMOUS_READ');
    return profile;
  }finally{await profileEnv.cleanup();}
}
function fixtureDb(database){return database;}
function adapterFor(database,userUid=UID){return api.createFirebaseEmulatorAdapter({db:fixtureDb(database),auth:{currentUser:{uid:userUid}},sdk,emulatorHost:HOST+':'+PORT});}
function runtimeFor(database,userUid=UID,now){return api.createRuntime({adapter:adapterFor(database,userUid),identity:{authenticated:true,uid:userUid},...(now?{now}:{})});}
function record(id,decision='reprint',revision=1,extra={}){return {schemaVersion:1,productId:id,decision,revision,lastMutationId:'fixture-mutation-id-'+String(revision).padStart(6,'0'),...extra};}
(async()=>{
  try{
    await atStage('CANDIDATE_MODULE_INIT',async()=>{
      vm.runInThisContext(match[1],{filename:'jarvis-replenishment-9c-decisions.js'});
      api=global.JarvisReplenishment9C;
      if(!api)throw Object.assign(new Error('module unavailable'),{name:'AssertionError'});
    });
    const combinedRules=await atStage('COMBINED_RULES_FILE_READ',async()=>fs.readFileSync(rulesPath,'utf8'));
    if(combinedRules.includes('86F10B4A')||combinedRules.includes('JARVIS_9C_RULES_TEMP'))throw Object.assign(new Error('marker'),{name:'AssertionError'});
    const deployedRulesPath=process.env.JARVIS_9C_DEPLOYED_RULES_PATH;
    if(!deployedRulesPath||!fs.existsSync(deployedRulesPath))throw Object.assign(new Error('baseline missing'),{name:'AssertionError'});
    const baselineText=await atStage('BASELINE_RULES_FILE_READ',async()=>fs.readFileSync(deployedRulesPath,'utf8'));
    const baselineProfile=await existingPermissionProfile(baselineText,'BASELINE');
    const combinedProfile=await existingPermissionProfile(combinedRules,'COMBINED');
    await atStage('PERMISSION_PROFILE_COMPARE',async()=>{const changed=Object.keys(baselineProfile).filter(key=>combinedProfile[key]!==baselineProfile[key]);if(changed.length)throw Object.assign(new Error('profile mismatch'),{safeCategory:'PERMISSION_PROFILE_MISMATCH',safePermissionIds:changed});});
    tests.push({name:'parité des permissions existantes Manager et 9A entre Rules fictives de référence et Rules fictives combinées',status:'RÉUSSI'});
    env=await atStage('COMBINED_RULES_INIT',()=>initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules:combinedRules}}));
    const clients=await atStage('FIRESTORE_CLIENT_CONTEXT_INIT',async()=>({
      owner:env.authenticatedContext(UID).firestore(),
      other:env.authenticatedContext(OTHER).firestore(),
      anonymous:env.unauthenticatedContext().firestore()
    }));
    owner=clients.owner;other=clients.other;anonymous=clients.anonymous;
    await test('diagnostic safe-stage categories self-check',async()=>{
      assert.equal(categoryFor(new Error('synthetic compilation failure'),'BASELINE_RULES_INIT'),'RULES_COMPILATION_FAILURE');
      assert.equal(categoryFor(new Error('synthetic load failure'),'COMBINED_RULES_INIT'),'RULES_LOAD_FAILURE');
      assert.equal(categoryFor(Object.assign(new Error('synthetic denied'),{code:'permission-denied'}),'BASELINE_PROFILE_SETTINGS_OWNER_READ'),'PERMISSION_DENIED');
      assert.equal(categoryFor(new Error('synthetic client failure'),'FIRESTORE_CLIENT_CONTEXT_INIT'),'CLIENT_CONTEXT_INIT_FAILURE');
      assert.equal(categoryFor(new Error('synthetic UI failure'),'UI_RENDER_INITIALIZATION'),'UI_INIT_FAILURE');
      assert.equal(categoryFor(Object.assign(new Error('synthetic mismatch'),{safeCategory:'PERMISSION_PROFILE_MISMATCH'}),'PERMISSION_PROFILE_COMPARE'),'PERMISSION_PROFILE_MISMATCH');
    });
    await test('émulateur compilé, chemins Firestore cohérents et adaptateur emulator-only',async()=>{assert.equal(api.decisionCollectionPath(UID),'fath3d/'+UID+'/replenishmentDecisions');assert.equal(api.decisionDocumentPath(UID,'path-check'),pathFor('path-check'));assert.equal(api.createRuntime({adapter:api.createMockAdapter(),identity:{uid:'mock',authenticated:true}}).getState().productionWritesEnabled,false);assert.throws(()=>api.createFirebaseEmulatorAdapter({db:owner,auth:{currentUser:{uid:UID}},sdk,emulatorHost:'prod'}),/DECISION_EMULATOR_REQUIRED/);});
    await test('lecture initiale vide et consultation sans écriture',async()=>{const runtime=runtimeFor(owner);assert.deepEqual({...await runtime.read()},{ });assert.equal(runtime.getState().persistent,true);});
    await test('propriétaire crée À réimprimer à révision 1 puis retrouve après nouvelle session',async()=>{const runtime=runtimeFor(owner);const proposal=await runtime.prepare({productId:'101',decision:'reprint'});assert.equal(proposal.expectedRevision,0);const committed=await runtime.confirm(proposal.proposalId,{explicit:true});assert.equal(committed.status,'committed',JSON.stringify(committed));assert.equal(committed.record.revision,1);assert.equal((await runtimeFor(owner).read())['101'].decision,'reprint');});
    await test('les quatre états, report daté/sans date, modification et retour à décider',async()=>{const runtime=runtimeFor(owner);for(const [decision,date] of [['deferred',null],['deferred','2026-12-25'],['stopped',null],['undecided',null]]){const proposal=await runtime.prepare({productId:'201',decision,reminderDate:date});assert.equal((await runtime.confirm(proposal.proposalId,{explicit:true})).status,'committed');}const rows=await runtime.read();assert.equal(rows['201'].decision,'undecided');assert.equal(rows['201'].revision,4);assert.equal(Object.hasOwn(rows['201'],'reminderDate'),false);});
    await test('deux IDs homonymes restent indépendants',async()=>{const runtime=runtimeFor(owner);for(const id of ['202','303']){const p=await runtime.prepare({productId:id,decision:'stopped'});await runtime.confirm(p.proposalId,{explicit:true});}const rows=await runtime.read();assert.equal(rows['202'].decision,'stopped');assert.equal(rows['303'].decision,'stopped');assert.notEqual(rows['202'].productId,rows['303'].productId);});
    await test('date invalide et date hors report refusées avant écriture',async()=>{const runtime=runtimeFor(owner);await assert.rejects(runtime.prepare({productId:'1',decision:'deferred',reminderDate:'2026-02-31'}),/DECISION_DATE_INVALID/);await assert.rejects(runtime.prepare({productId:'1',decision:'reprint',reminderDate:'2026-12-25'}),/DECISION_DATE_NOT_ALLOWED/);});
    await test('date de rappel civile conservée exactement sans décalage UTC',async()=>{const runtime=runtimeFor(owner);const p=await runtime.prepare({productId:'date-1',decision:'deferred',reminderDate:'2026-12-25'});await runtime.confirm(p.proposalId,{explicit:true});assert.equal((await runtime.read())['date-1'].reminderDate,'2026-12-25');});
    await test('révision périmée entre deux sessions refusée sans écrasement',async()=>{const a=runtimeFor(owner),b=runtimeFor(owner);const p1=await a.prepare({productId:'conflict',decision:'reprint'}),p2=await b.prepare({productId:'conflict',decision:'stopped'});assert.equal((await a.confirm(p1.proposalId,{explicit:true})).status,'committed');const stale=await b.confirm(p2.proposalId,{explicit:true});assert.equal(stale.status,'conflict');assert.equal((await a.read()).conflict.decision,'reprint');});
    await test('révision périmée ou rejouée sans incrément strict refusée par Rules',async()=>{const runtime=runtimeFor(owner),proposal=await runtime.prepare({productId:'401',decision:'reprint'});assert.equal((await runtime.confirm(proposal.proposalId,{explicit:true})).status,'committed');const ref=sdk.doc(owner,pathFor('401'));await assertFails(sdk.updateDoc(ref,{decision:'stopped',revision:1,lastMutationId:'another-valid-mutation-id'}));});
    await test('écriture transactionnelle valide puis incrémentation exacte +1',async()=>{const runtime=runtimeFor(owner);let p=await runtime.prepare({productId:'501',decision:'reprint'});await runtime.confirm(p.proposalId,{explicit:true});p=await runtime.prepare({productId:'501',decision:'deferred',reminderDate:'2026-11-01'});const result=await runtime.confirm(p.proposalId,{explicit:true});assert.equal(result.record.revision,2);});
    await test('anonyme et autre UID ne peuvent pas lire ni écrire la décision propriétaire',async()=>{await env.withSecurityRulesDisabled(async ctx=>sdk.setDoc(sdk.doc(ctx.firestore(),pathFor('601')),record('601')));await assertFails(sdk.getDoc(sdk.doc(anonymous,pathFor('601'))));await assertFails(sdk.getDoc(sdk.doc(other,pathFor('601'))));await assertFails(sdk.setDoc(sdk.doc(other,pathFor('601')),record('601')));});
    await test('champs, valeurs et types interdits refusés',async()=>{const ref=sdk.doc(owner,pathFor('701'));const cases=[['champ stock',{...record('701'),stocks:{maison:8}}],['champ financier',{...record('701'),sales:4}],['décision inconnue',{...record('701'),decision:'planned_print'}],['révision de type incorrect',{...record('701'),revision:'1'}],['champ inconnu',{...record('701'),unknown:true}],['date civile impossible',{...record('701','deferred',1,{reminderDate:'2026-02-31'})}],['29 février année non bissextile',{...record('701','deferred',1,{reminderDate:'2025-02-29'})}],['jour 31 dans un mois de 30 jours',{...record('701','deferred',1,{reminderDate:'2026-04-31'})}]];for(const [label,bad] of cases){try{await assertFails(sdk.setDoc(ref,bad));}catch(error){throw new Error(label+': '+error.message);}}await assertSucceeds(sdk.setDoc(ref,record('701','deferred',1,{reminderDate:'2024-02-29'})));});
    await test('mise à jour +1 valide, ancien ID et révision sautée refusés',async()=>{const ref=sdk.doc(owner,pathFor('801'));await assertSucceeds(sdk.setDoc(ref,record('801')));await assertSucceeds(sdk.updateDoc(ref,{decision:'stopped',revision:2,lastMutationId:'mutation-two-identifier'}));await assertFails(sdk.updateDoc(ref,{revision:4,lastMutationId:'mutation-four-identifier'}));await assertFails(sdk.updateDoc(ref,{productId:'other-id',revision:3,lastMutationId:'mutation-three-identifier'}));});
    await test('suppression et sous-chemin supplémentaire refusés',async()=>{const ref=sdk.doc(owner,pathFor('901'));await assertSucceeds(sdk.setDoc(ref,record('901')));await assertFails(sdk.deleteDoc(ref));await assertFails(sdk.setDoc(sdk.doc(owner,pathFor('901')+'/private/nested'),{value:1}));});
    await test('écriture 9C ne modifie ni document 9A ni document Manager',async()=>{const manager=sdk.doc(owner,'fath3d/'+UID),settings=sdk.doc(owner,parentPath);await env.withSecurityRulesDisabled(async ctx=>{await sdk.setDoc(sdk.doc(ctx.firestore(),'fath3d/'+UID),{payload:'synthetic-manager-payload',updated:'test',revision:1});await sdk.setDoc(sdk.doc(ctx.firestore(),parentPath),{schemaVersion:1,revision:1,categoryRules:{hueforge:{targetStock:{value:1,scope:'maison_marche'}}},lastMutationId:'fixture-rule-mutation-0001'});});const beforeManager=(await sdk.getDoc(manager)).data(),beforeSettings=(await sdk.getDoc(settings)).data();const runtime=runtimeFor(owner),p=await runtime.prepare({productId:'1001',decision:'reprint'});await runtime.confirm(p.proposalId,{explicit:true});assert.deepEqual((await sdk.getDoc(manager)).data(),beforeManager);assert.deepEqual((await sdk.getDoc(settings)).data(),beforeSettings);});
    await test('révision expirée avant confirmation refusée sans mutation',async()=>{let clock=1000;const runtime=api.createRuntime({adapter:adapterFor(owner),identity:{uid:UID,authenticated:true},now:()=>clock});const p=await runtime.prepare({productId:'expired',decision:'reprint'});clock=p.expiresAt+1;await assert.rejects(runtime.confirm(p.proposalId,{explicit:true}),/DECISION_PROPOSAL_EXPIRED/);assert.equal((await runtimeFor(owner).read()).expired,undefined);});
    await test('confirmation explicite obligatoire et double confirmation bloquée',async()=>{const runtime=runtimeFor(owner),p=await runtime.prepare({productId:'double',decision:'reprint'});await assert.rejects(runtime.confirm(p.proposalId),/DECISION_EXPLICIT_CONFIRMATION_REQUIRED/);assert.equal((await runtime.confirm(p.proposalId,{explicit:true})).status,'committed');await assert.rejects(runtime.confirm(p.proposalId,{explicit:true}),/DECISION_PROPOSAL_MISMATCH/);});
    await test('atomicité fonctionnelle : décision seule, aucun planning/création de stock',async()=>{const runtime=runtimeFor(owner),before=await runtime.read(),p=await runtime.prepare({productId:'no-side-effects',decision:'reprint'});await runtime.confirm(p.proposalId,{explicit:true});const after=await runtime.read();assert.deepEqual(Object.keys(after['no-side-effects']).sort(),['decision','lastMutationId','productId','revision','schemaVersion'].sort());assert.deepEqual(before['no-side-effects'],undefined);});
    await test('runtime mock bloque répétition après résultat incertain',async()=>{const adapter=api.createMockAdapter({ownerUid:'mock-owner'}),runtime=api.createRuntime({adapter,identity:{uid:'mock-owner',authenticated:true}});adapter.setFaultForTest('uncertain_after');const p=await runtime.prepare({productId:'mock-1',decision:'reprint'});assert.equal((await runtime.confirm(p.proposalId,{explicit:true})).status,'uncertain');await assert.rejects(runtime.prepare({productId:'mock-2',decision:'stopped'}),/DECISION_BUSY_OR_UNCERTAIN/);assert.equal(adapter.getWriteCount(),1);assert.equal((await runtime.reconcile()).status,'applied');});
    await test('le fichier complet testé est le candidat local approuvé et garde le verrou production 9C fermé',async()=>{assert.equal(candidateHash,'C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76');assert.match(match[1],/const PRODUCTION_WRITES_ENABLED=false/);assert.match(match[1],/createFirebaseEmulatorAdapter/);assert.match(match[1],/127\.0\.0\.1:8785/);});
    await test('la décision 9C ne touche pas au stock boutique, aux ventes ni aux données de caisse/finance',async()=>{
      const stockPath='fath3d/'+UID+'/fixture/stock',financePath='fath3d/'+UID+'/fixture/finance';
      await env.withSecurityRulesDisabled(async ctx=>{
        const db=ctx.firestore();
        await sdk.setDoc(sdk.doc(db,stockPath),{maison:4,marche:2,boutique:7});
        await sdk.setDoc(sdk.doc(db,financePath),{sales:123.45,tickets:['ticket-fixture-1'],urssaf:12.34});
      });
      const readProtectedFixtures=()=>env.withSecurityRulesDisabled(async ctx=>{
        const db=ctx.firestore();
        return {
          stock:(await sdk.getDoc(sdk.doc(db,stockPath))).data(),
          finance:(await sdk.getDoc(sdk.doc(db,financePath))).data()
        };
      });
      const before=await readProtectedFixtures();
      const runtime=runtimeFor(owner);
      const proposal=await runtime.prepare({productId:'side-effects',decision:'reprint'});
      const result=await runtime.confirm(proposal.proposalId,{explicit:true});
      assert.equal(result.status,'committed','La décision 9C doit être exécutée avec les permissions normales du propriétaire.');
      const after=await readProtectedFixtures();
      assert.deepEqual(after,before,'Les documents fictifs de stock et de finance doivent rester identiques.');
      const decision=await sdk.getDoc(sdk.doc(owner,pathFor('side-effects')));
      assert.equal(decision.exists(),true,'La décision 9C doit avoir été enregistrée.');
    });
  }catch(error){tests.push({testId:'DECISION_INITIALIZATION',name:'INITIALIZATION',status:'ÉCHEC',stage:error.safeStage||currentStage,category:categoryFor(error,error.safeStage||currentStage),permissionIds:Array.isArray(error.safePermissionIds)?error.safePermissionIds:undefined});}
  finally{
    if(env)await env.cleanup();
    delete global.JarvisReplenishment9C;
    if(originalWindow===undefined)delete global.window;else global.window=originalWindow;
    if(originalCrypto===undefined)delete global.crypto;else global.crypto=originalCrypto;
    const report={projectId:PROJECT,emulator:HOST+':'+PORT,emulatorOnly:true,total:tests.length,passed:tests.filter(test=>test.status==='RÉUSSI').length,failed:tests.filter(test=>test.status==='ÉCHEC').length,firebaseProductionWrites:0,tests};
    const reportPath=path.join(process.env.RUNNER_TEMP||require('node:os').tmpdir(),'9c-decisions-results.json');
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify({projectId:report.projectId,emulatorOnly:report.emulatorOnly,total:report.total,passed:report.passed,failed:report.failed,failures:tests.filter(item=>item.status==='ÉCHEC').map(item=>({testId:item.testId||'DECISION_INITIALIZATION',stageId:item.stage||'DECISION_INTEGRATION_TEST',category:item.category||'ASSERTION_FAILURE'})),firebaseProductionWrites:0,rawErrorsPublished:false}));
    if(report.failed)process.exitCode=1;
  }
})();


