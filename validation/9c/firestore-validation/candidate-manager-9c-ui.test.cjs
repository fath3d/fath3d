const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore');
const {chromium}=require('playwright');
const PROJECT='demo-jarvis-replenishment-9c',HOST='127.0.0.1',PORT=8785,UID='owner-9c-ui-test';
if(process.env.FIRESTORE_EMULATOR_HOST!==HOST+':'+PORT||process.env.GCLOUD_PROJECT!==PROJECT||!PROJECT.startsWith('demo-'))throw new Error('ISOLATION_REQUIRED');
const repo=path.resolve(__dirname,'..'),htmlPath=process.env.JARVIS_9C_CANDIDATE_PATH;
if(!htmlPath||!fs.existsSync(htmlPath))throw new Error('EPHEMERAL_CANDIDATE_MANAGER_REQUIRED');
const source=fs.readFileSync(htmlPath,'utf8'),hash=crypto.createHash('sha256').update(source).digest('hex').toUpperCase();
if(hash!=='C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76')throw new Error('CANDIDATE_MANAGER_HASH_MISMATCH');
const script=id=>{const re=new RegExp('<script id="'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'">([\\s\\S]*?)<\\/script>');const match=source.match(re);assert(match,'Candidate script absent: '+id);return match[1];};
const style=id=>{const re=new RegExp('<style id="'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'">([\\s\\S]*?)<\\/style>');const match=source.match(re);assert(match,'Candidate style absent: '+id);return match[1];};
const baseCss=(source.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)||[])[1]||'';
const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseCss}\n${style('jarvis-replenishment-9a4-style')}</style></head><body><div class="app"><div class="main"><div class="topbar"><h1 class="page-title">Règles de réapprovisionnement — test isolé</h1><div class="topbar-actions" id="actions"></div></div><div class="content" id="content"></div></div></div><script>${script('jarvis-replenishment-9a')}</script><script>${script('jarvis-replenishment-9a3')}</script><script>${script('jarvis-replenishment-9c-decisions')}</script><script>${script('jarvis-replenishment-9a4')}</script></body></html>`;

let env,browser,context,ownerDb,runtime,api,page;
const confirmTrace=[];
const result={candidateSha256:hash,projectId:PROJECT,emulatorOnly:true,passed:0,failed:0,tests:[],firebaseProductionWrites:0};
let currentStage='HARNESS_SETUP';
const SAFE_CATEGORIES=new Set(['RULES_COMPILATION_FAILURE','RULES_LOAD_FAILURE','EMULATOR_CONNECTION_FAILURE','EMULATOR_SETUP_FAILURE','PERMISSION_DENIED','CLIENT_CONTEXT_INIT_FAILURE','CANDIDATE_INIT_FAILURE','BROWSER_INIT_FAILURE','DOM_INIT_FAILURE','UI_INIT_FAILURE','ASSERTION_FAILURE','TEST_LOGIC_FAILURE','UNKNOWN_TEST_FAILURE']);
const STEP_IDS=new Map([
  ['attente de la carte d’alerte','UI_ALERT_WAIT'],['vérification du seuil rendu','UI_ALERT_THRESHOLD_ASSERT'],['vérification du mode émulateur','UI_MODE_ASSERT'],
  ['sélection À réimprimer','UI_DECISION_SELECT'],['clic Préparer','UI_PREPARE_CLICK'],['attente de la proposition','UI_PROPOSAL_WAIT'],
  ['clic Annuler','UI_CANCEL_CLICK'],['attente de la fin de l’annulation','UI_CANCEL_COMPLETE_WAIT'],['vérification du snapshot vide','UI_EMPTY_SNAPSHOT_ASSERT'],
  ['vérification directe du document Firestore absent','UI_CANCEL_FIRESTORE_ABSENCE_ASSERT'],['vérification absence de faux succès','UI_NO_FALSE_SUCCESS_ASSERT'],
  ['attente de la proposition explicite','UI_EXPLICIT_PROPOSAL_WAIT'],['clic de confirmation explicite','UI_EXPLICIT_CONFIRM_CLICK'],
  ['attente du retour de transaction','UI_TRANSACTION_RESULT_WAIT'],['vérification du statut de transaction','UI_TRANSACTION_STATUS_ASSERT'],
  ['vérification directe de l’écriture Firestore','UI_FIRESTORE_WRITE_ASSERT'],['relecture par un runtime neuf','UI_NEW_SESSION_REREAD'],
  ['actualisation du rendu et vérification du groupe À réimprimer','UI_DECISION_GROUP_REFRESH_ASSERT']
]);
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
  if(stage.includes('CANDIDATE'))return 'CANDIDATE_INIT_FAILURE';
  if(stage.includes('BROWSER')||stage.includes('PLAYWRIGHT'))return 'BROWSER_INIT_FAILURE';
  if(stage.includes('DOM'))return 'DOM_INIT_FAILURE';
  if(stage.includes('UI'))return 'UI_INIT_FAILURE';
  if(stage.includes('RULES_INIT'))return 'RULES_LOAD_FAILURE';
  return 'UNKNOWN_TEST_FAILURE';
}
async function atStage(id,fn){currentStage=id;try{return await fn();}catch(error){const wrapped=new Error('SAFE_DIAGNOSTIC');wrapped.safeStage=id;wrapped.safeCategory=categoryFor(error,id);throw wrapped;}}
async function step(name,fn){const id=STEP_IDS.get(name)||'UI_STEP_UNMAPPED';return await atStage(id,fn);}
async function test(name,fn){const testId='UI_TEST_'+String(result.tests.length+1).padStart(2,'0');currentStage='UI_TEST_START';try{await fn();result.tests.push({testId,name,status:'RÉUSSI'});result.passed++;}catch(error){const stage=error.safeStage||currentStage;result.tests.push({testId,name,status:'ÉCHEC',stageId:stage,category:categoryFor(error,stage)});result.failed++;}}
(async()=>{
  const originalWindow=global.window,originalCrypto=global.crypto;
  try{
    const rulesPath=process.env.JARVIS_9C_COMBINED_RULES_PATH;
    const combinedRules=await atStage('COMBINED_RULES_FILE_READ',async()=>{
      if(!rulesPath||!fs.existsSync(rulesPath))throw Object.assign(new Error('missing combined rules file'),{name:'AssertionError'});
      return fs.readFileSync(rulesPath,'utf8');
    });
    env=await atStage('COMBINED_RULES_INIT',()=>initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules:combinedRules}}));
    await atStage('EMULATOR_DATABASE_RESET',()=>env.clearFirestore());
    ownerDb=await atStage('OWNER_CLIENT_CONTEXT_INIT',async()=>env.authenticatedContext(UID).firestore());
    global.window=global;global.crypto=crypto.webcrypto;
    await atStage('CANDIDATE_MODULE_INIT_9A',async()=>vm.runInThisContext(script('jarvis-replenishment-9a'),{filename:'candidate-9a.js'}));
    await atStage('CANDIDATE_MODULE_INIT_9A3',async()=>vm.runInThisContext(script('jarvis-replenishment-9a3'),{filename:'candidate-9a3.js'}));
    await atStage('CANDIDATE_MODULE_INIT_9C',async()=>vm.runInThisContext(script('jarvis-replenishment-9c-decisions'),{filename:'candidate-9c.js'}));
    api=global.JarvisReplenishment9C;
    if(!api)throw Object.assign(new Error('candidate module unavailable'),{name:'AssertionError'});
    const adapter=await atStage('FIRESTORE_ADAPTER_INIT',async()=>api.createFirebaseEmulatorAdapter({db:ownerDb,auth:{currentUser:{uid:UID}},sdk,emulatorHost:HOST+':'+PORT}));
    runtime=await atStage('RUNTIME_INIT',async()=>api.createRuntime({adapter,identity:{uid:UID,authenticated:true}}));
    browser=await atStage('PLAYWRIGHT_BROWSER_LAUNCH',()=>chromium.launch({headless:true,args:['--disable-background-networking']}));
    context=await atStage('PLAYWRIGHT_CONTEXT_INIT',()=>browser.newContext({viewport:{width:1366,height:768}}));
    page=await atStage('PLAYWRIGHT_PAGE_INIT',()=>context.newPage());
    await atStage('PLAYWRIGHT_NETWORK_ISOLATION',()=>page.route('**/*',route=>route.abort()));
    await atStage('PLAYWRIGHT_BRIDGE_INIT',async()=>{
await page.exposeFunction('__9cRead',()=>runtime.read());
await page.exposeFunction('__9cPrepare',args=>runtime.prepare(args));
await page.exposeFunction('__9cConfirm',async(id,options)=>{const response=await runtime.confirm(id,options);confirmTrace.push({status:response&&response.status,reason:response&&response.reason,writeApplied:response&&response.writeApplied});return response;});
await page.exposeFunction('__9cCancel',(id,options)=>runtime.cancel(id,options));
await page.exposeFunction('__9cPending',()=>runtime.getPending());
await page.exposeFunction('__9cState',()=>runtime.getState());
await page.exposeFunction('__9cReconcile',()=>runtime.reconcile());
    });
    const pageErrors=[];page.on('pageerror',()=>pageErrors.push('PAGE_ERROR'));
    await atStage('DOM_CONTENT_INITIALIZATION',()=>page.setContent(html,{waitUntil:'domcontentloaded'}));
    const fixture={products:[{id:101,name:'MINIMAL RENARD',categorie:'Minimaux',emoji:'🦊',stocks:{maison:3,marche:1}}]};
    await atStage('UI_RENDER_INITIALIZATION',()=>page.evaluate(async({fixture})=>{
      const rules={root:{schemaVersion:1,revision:1,categoryRules:{minimaux:{alertThreshold:{value:5,scope:'maison_marche'}}},lastMutationId:'fixture-initial-revision-0001'},exceptions:{}};
      const settingsAdapter=JarvisReplenishment9A3.createMockAdapter(rules);
      window.JarvisReplenishment9A3Runtime=JarvisReplenishment9A3.createRuntime({adapter:settingsAdapter,identity:{authenticated:true,uid:'synthetic-settings-owner'}});
      window.__testDb=fixture;window.__decisionPending=null;window.__decisionState={mode:'FIRESTORE_EMULATOR_ONLY',writesEnabled:true,blockedUncertain:false};
      window.JarvisReplenishment9CRuntime={
        read:()=>window.__9cRead(),getState:()=>window.__decisionState,getPending:()=>window.__decisionPending,
        prepare:async args=>{const proposal=await window.__9cPrepare(args);window.__decisionPending=proposal;window.__decisionState=await window.__9cState();return proposal;},
        confirm:async(id,options)=>{const response=await window.__9cConfirm(id,options);window.__decisionPending=await window.__9cPending();window.__decisionState=await window.__9cState();return response;},
        cancel:async(id,options)=>{const response=await window.__9cCancel(id,options);window.__decisionPending=await window.__9cPending();window.__decisionState=await window.__9cState();return response;},
        reconcile:async()=>{const response=await window.__9cReconcile();window.__decisionPending=await window.__9cPending();window.__decisionState=await window.__9cState();return response;}
      };
      JarvisReplenishment9A4.render(document.getElementById('content'),document.getElementById('actions'),()=>window.__testDb);
      await JarvisReplenishment9A4.refresh();
    },{fixture}));

    async function resetScenario(){
      currentStage='TEST_SCENARIO_RESET';
      await env.clearFirestore();
      confirmTrace.length=0;
      runtime=createDecisionRuntime();
      await page.evaluate(async({fixture})=>{
        window.__decisionPending=null;
        window.__decisionState={mode:'FIRESTORE_EMULATOR_ONLY',writesEnabled:true,blockedUncertain:false};
        window.__testDb=fixture;
        JarvisReplenishment9A4.render(document.getElementById('content'),document.getElementById('actions'),()=>window.__testDb);
        await JarvisReplenishment9A4.refresh();
      },{fixture});
    }

    await test('alerte candidate complète visible avec données fictives',async()=>{
      await step('attente de la carte d’alerte',()=>page.getByTestId('r9-alert-101').waitFor({state:'visible',timeout:5000}));
      await step('vérification du seuil rendu',async()=>assert.match(await page.getByTestId('r9-alert-101').innerText(),/Stock seuil : 4 · seuil ≤ 5/));
      await step('vérification du mode émulateur',async()=>assert.match(await page.getByTestId('r9-decision-storage').innerText(),/ÉMULATEUR Firestore 9C/));
    });
    await test('annulation depuis le vrai rendu 9A4 ne crée aucune décision',async()=>{
      await resetScenario();
      await step('sélection À réimprimer',()=>page.getByTestId('r9-decision-choice-101').selectOption('reprint'));
      await step('clic Préparer',()=>page.getByTestId('r9-prepare-decision-101').click());
      await step('attente de la proposition',()=>page.getByTestId('r9-decision-proposal').waitFor({state:'visible'}));
      await step('clic Annuler',()=>page.getByTestId('r9-cancel-decision').click());
      await step('attente de la fin de l’annulation',()=>page.waitForFunction(()=>window.__decisionPending===null,{timeout:5000}));
      await step('vérification du snapshot vide',async()=>{
        const snapshot=await runtime.read();
        assert.equal(Object.keys(snapshot).length,0,'Le snapshot doit rester sans décision après annulation.');
      });
      await step('vérification directe du document Firestore absent',async()=>{
        const ref=sdk.doc(ownerDb,'fath3d',UID,'replenishmentDecisions','101');
        const stored=await sdk.getDoc(ref);
        assert.equal(stored.exists(),false,'Aucun document de décision ne doit être créé après annulation.');
      });
      await step('vérification absence de faux succès',async()=>{
        assert.doesNotMatch(await page.getByTestId('r9-alert-101').innerText(),/Décision enregistrée/);
      });
    });
    await test('confirmation depuis le vrai rendu 9A4 enregistre puis relit dans Firestore Emulator',async()=>{
      await resetScenario();
      await step('sélection À réimprimer',()=>page.getByTestId('r9-decision-choice-101').selectOption('reprint'));
      await step('clic Préparer',()=>page.getByTestId('r9-prepare-decision-101').click());
      await step('attente de la proposition explicite',()=>page.getByTestId('r9-decision-proposal').waitFor({state:'visible'}));
      await step('clic de confirmation explicite',()=>page.getByTestId('r9-confirm-decision').click());
      await step('attente du retour de transaction',()=>page.waitForFunction(()=>window.__decisionPending===null,{timeout:10000}));
      await step('vérification du statut de transaction',async()=>{
        assert.equal(confirmTrace.at(-1)?.status,'committed','La transaction Firestore doit retourner committed.');
      });
      await step('vérification directe de l’écriture Firestore',async()=>{
        const ref=sdk.doc(ownerDb,'fath3d',UID,'replenishmentDecisions','101');
        const stored=await sdk.getDoc(ref);
        assert.equal(stored.exists(),true,'Le document décision doit exister après confirmation.');
        assert.equal(stored.data().decision,'reprint');
        assert.equal(stored.data().revision,1);
      });
      await step('relecture par un runtime neuf',async()=>{
        const reread=await runtimeForNewSession();
        assert.equal(reread['101'].decision,'reprint');
        assert.equal(reread['101'].revision,1);
      });
      await step('actualisation du rendu et vérification du groupe À réimprimer',async()=>{
        await page.evaluate(()=>JarvisReplenishment9A4.refresh());
        const card=page.locator('[data-testid="r9-group-reprint"] [data-testid="r9-alert-101"]');
        await card.waitFor({state:'visible',timeout:5000});
        assert.match(await card.innerText(),/Décision enregistrée : À réimprimer/);
        assert.equal(await page.locator('[data-testid="r9-group-undecided"] [data-testid="r9-alert-101"]').count(),0);
      });
    });
  }catch(error){const stage=error.safeStage||currentStage;result.failed++;result.tests.push({testId:'UI_INITIALIZATION',name:'INITIALIZATION',status:'ÉCHEC',stageId:stage,category:categoryFor(error,stage)});}
  finally{
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    if(env)await env.cleanup().catch(()=>{});
    delete global.JarvisReplenishment9C;delete global.JarvisReplenishment9A3;delete global.JarvisReplenishment9A;
    if(originalWindow===undefined)delete global.window;else global.window=originalWindow;
    if(originalCrypto===undefined)delete global.crypto;else global.crypto=originalCrypto;
    const output=path.join(process.env.RUNNER_TEMP||require('node:os').tmpdir(),'9c-candidate-ui-results.json');
    fs.writeFileSync(output,JSON.stringify(result,null,2),{mode:0o600});
    console.log(JSON.stringify({candidateSha256:result.candidateSha256,projectId:result.projectId,emulatorOnly:result.emulatorOnly,total:result.passed+result.failed,passed:result.passed,failed:result.failed,failures:result.tests.filter(item=>item.status==='ÉCHEC').map(item=>({testId:item.testId||'UI_INITIALIZATION',stageId:item.stageId||item.stage||'UI_TEST_START',category:item.category||'ASSERTION_FAILURE'})),firebaseProductionWrites:0,rawErrorsPublished:false}));
    if(result.failed)process.exitCode=1;
  }
})();

function createDecisionRuntime(){
  const adapter=api.createFirebaseEmulatorAdapter({db:ownerDb,auth:{currentUser:{uid:UID}},sdk,emulatorHost:HOST+':'+PORT});
  return api.createRuntime({adapter,identity:{uid:UID,authenticated:true}});
}
async function runtimeForNewSession(){return createDecisionRuntime().read();}

