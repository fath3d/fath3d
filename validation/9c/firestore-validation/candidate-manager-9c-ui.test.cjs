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
let currentStage='test setup';
const safeError=(error)=>{
  const code=String(error&&((error.code)||(error.name))||'ASSERTION_FAILURE').replace(/[^A-Za-z0-9_.:-]/g,'').slice(0,80);
  let message=String(error&&(error.message||error)||'Unknown error').split(String.fromCharCode(10))[0];
  message=message.replaceAll(PROJECT,'[demo-project]').replaceAll(UID,'[fixture-uid]')
    .replace(/fath3d\\/[^/\\s]+\\/replenishmentDecisions/g,'fath3d/[fixture-uid]/replenishmentDecisions')
    .slice(0,220);
  return {code,message};
};
async function step(name,fn){currentStage=name;return await fn();}
async function test(name,fn){currentStage='start';try{await fn();result.tests.push({name,status:'RÉUSSI'});result.passed++;}catch(error){const safe=safeError(error);result.tests.push({name,status:'ÉCHEC',stage:currentStage,code:safe.code,error:safe.message});result.failed++;}}

(async()=>{
  const originalWindow=global.window,originalCrypto=global.crypto;
  try{
    const rulesPath=process.env.JARVIS_9C_COMBINED_RULES_PATH;
    if(!rulesPath||!fs.existsSync(rulesPath))throw new Error('EPHEMERAL_COMBINED_RULES_REQUIRED');
    env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules:fs.readFileSync(rulesPath,'utf8')}});
    await env.clearFirestore();
    ownerDb=env.authenticatedContext(UID).firestore();
    global.window=global;global.crypto=crypto.webcrypto;
    vm.runInThisContext(script('jarvis-replenishment-9a'),{filename:'candidate-9a.js'});
    vm.runInThisContext(script('jarvis-replenishment-9a3'),{filename:'candidate-9a3.js'});
    vm.runInThisContext(script('jarvis-replenishment-9c-decisions'),{filename:'candidate-9c.js'});
    api=global.JarvisReplenishment9C;
    const adapter=api.createFirebaseEmulatorAdapter({db:ownerDb,auth:{currentUser:{uid:UID}},sdk,emulatorHost:HOST+':'+PORT});
    runtime=api.createRuntime({adapter,identity:{uid:UID,authenticated:true}});
    browser=await chromium.launch({headless:true,args:['--disable-background-networking']});
    context=await browser.newContext({viewport:{width:1366,height:768}});
    page=await context.newPage();
    await page.route('**/*',route=>route.abort());
    await page.exposeFunction('__9cRead',()=>runtime.read());
    await page.exposeFunction('__9cPrepare',args=>runtime.prepare(args));
    await page.exposeFunction('__9cConfirm',async(id,options)=>{const response=await runtime.confirm(id,options);confirmTrace.push({status:response&&response.status,reason:response&&response.reason,writeApplied:response&&response.writeApplied});return response;});
    await page.exposeFunction('__9cCancel',(id,options)=>runtime.cancel(id,options));
    await page.exposeFunction('__9cPending',()=>runtime.getPending());
    await page.exposeFunction('__9cState',()=>runtime.getState());
    await page.exposeFunction('__9cReconcile',()=>runtime.reconcile());
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.setContent(html,{waitUntil:'domcontentloaded'});
    const fixture={products:[{id:101,name:'MINIMAL RENARD',categorie:'Minimaux',emoji:'🦊',stocks:{maison:3,marche:1}}]};
    await page.evaluate(async({fixture})=>{
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
    },{fixture});

    async function resetScenario(){
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
  }catch(error){const safe=safeError(error);result.failed++;result.tests.push({name:'initialisation / candidate / émulateur / navigateur',status:'ÉCHEC',stage:currentStage,code:safe.code,error:safe.message});}
  finally{
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    if(env)await env.cleanup().catch(()=>{});
    delete global.JarvisReplenishment9C;delete global.JarvisReplenishment9A3;delete global.JarvisReplenishment9A;
    if(originalWindow===undefined)delete global.window;else global.window=originalWindow;
    if(originalCrypto===undefined)delete global.crypto;else global.crypto=originalCrypto;
    const output=path.join(process.env.RUNNER_TEMP||require('node:os').tmpdir(),'9c-candidate-ui-results.json');
    fs.writeFileSync(output,JSON.stringify(result,null,2),{mode:0o600});
    console.log(JSON.stringify({candidateSha256:result.candidateSha256,projectId:result.projectId,emulatorOnly:result.emulatorOnly,total:result.passed+result.failed,passed:result.passed,failed:result.failed,failures:result.tests.filter(item=>item.status==='ÉCHEC').map(item=>({name:item.name,error:item.error})),firebaseProductionWrites:0}));
    if(result.failed)process.exitCode=1;
  }
})();

function createDecisionRuntime(){
  const adapter=api.createFirebaseEmulatorAdapter({db:ownerDb,auth:{currentUser:{uid:UID}},sdk,emulatorHost:HOST+':'+PORT});
  return api.createRuntime({adapter,identity:{uid:UID,authenticated:true}});
}
async function runtimeForNewSession(){return createDecisionRuntime().read();}

