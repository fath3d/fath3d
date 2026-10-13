const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const PROJECT='demo-jarvis-replenishment-9c',HOST='127.0.0.1',PORT=8785;
const temp=process.env.RUNNER_TEMP;
const results=[];
const marker='match /fath3d/{userId}/replenishmentDecisions/{productId}';
function countLiteral(text,token){return text.split(token).length-1;}
function safeMessage(error){return String(error&&error.message||error||'Unknown compiler error').slice(0,4000);}
async function compile(stageId,file,expectedCount){
  let env;
  try{
    const rules=fs.readFileSync(file,'utf8');
    if(countLiteral(rules,marker)!==expectedCount)throw Object.assign(new Error('9C block count invariant failed'),{code:'LOCAL_RULES_BLOCK_COUNT_INVALID'});
    env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules}});
    results.push({stageId,status:'PASS'});
    console.log(JSON.stringify({stageId,status:'PASS',category:'RULES_COMPILED',projectId:PROJECT,emulatorOnly:true}));
  }catch(error){
    const message=safeMessage(error);
    const code=String(error&&error.code||'');
    const category=code==='LOCAL_RULES_BLOCK_COUNT_INVALID'?'RULES_BLOCK_COUNT_FAILURE':
      /compile|syntax|parse|invalid rules/i.test(message)?'RULES_COMPILATION_FAILURE':
      /ECONNREFUSED|unavailable|deadline|connection/i.test(message)||code==='ECONNREFUSED'?'EMULATOR_CONNECTION_FAILURE':'RULES_LOAD_FAILURE';
    results.push({stageId,status:'FAIL',category,diagnostic:message});
    console.error(JSON.stringify({stageId,status:'FAIL',category,diagnostic:message,projectId:PROJECT,emulatorOnly:true}));
  }finally{if(env)await env.cleanup().catch(()=>{});}
}
(async()=>{
  try{
    if(!temp||process.env.GCLOUD_PROJECT!==PROJECT||process.env.FIRESTORE_EMULATOR_HOST!==HOST+':'+PORT||!PROJECT.startsWith('demo-'))throw Object.assign(new Error('Explicit demo project and emulator endpoint required'),{code:'ISOLATION_CONFIGURATION_INVALID'});
    const baseline=process.env.JARVIS_9C_DEPLOYED_RULES_PATH,combined=process.env.JARVIS_9C_COMBINED_RULES_PATH;
    if(!baseline||!combined)throw Object.assign(new Error('Prepared fake Rules paths missing'),{code:'FAKE_RULES_PATHS_MISSING'});
    await compile('BASELINE_RULES_COMPILE',baseline,0);
    await compile('COMBINED_RULES_COMPILE',combined,1);
  }catch(error){
    const message=safeMessage(error);
    results.push({stageId:'FAKE_RULES_COMPILE_CHECK_INIT',status:'FAIL',category:'EMULATOR_SETUP_FAILURE',diagnostic:message});
    console.error(JSON.stringify({stageId:'FAKE_RULES_COMPILE_CHECK_INIT',status:'FAIL',category:'EMULATOR_SETUP_FAILURE',diagnostic:message,projectId:PROJECT,emulatorOnly:true}));
  }
  const report={stageId:'FAKE_RULES_COMPILE_CHECK_SUMMARY',total:results.length,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results};
  if(temp)fs.writeFileSync(path.join(temp,'9c-rules-compile-results.json'),JSON.stringify(report,null,2),{mode:0o600});
  if(report.failed||report.total!==2)process.exitCode=1;
})();
