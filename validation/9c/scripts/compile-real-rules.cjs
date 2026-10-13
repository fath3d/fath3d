const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const PROJECT='demo-jarvis-replenishment-9c';
const HOST='127.0.0.1';
const PORT=8785;
const MARKER='match /fath3d/{userId}/replenishmentDecisions/{productId}';
const temp=process.env.RUNNER_TEMP;
const results=[];
function count(text,token){return text.split(token).length-1;}
function classify(error){const code=String(error&&error.code||'').toLowerCase();const message=String(error&&error.message||'').toLowerCase();if(/econnrefused|unavailable|deadline|connection|emulator.*not.*running/.test(code+' '+message))return 'EMULATOR_CONNECTION_FAILURE';if(/syntax|compile|compil|parse|line\s+\d+|column\s+\d+|invalid.*rules|rules.*invalid/.test(message))return 'RULES_COMPILATION_FAILURE';if(code==='permission-denied'||code==='unauthenticated')return 'PERMISSION_DENIED';return 'RULES_LOAD_FAILURE';}
async function compile(stageId,envName,expectedCount){
  let emulator;
  try{
    const file=process.env[envName];
    if(!file||!fs.existsSync(file)){
      results.push({stageId,status:'FAIL',category:'RULE_FILE_MISSING'});
      return;
    }
    const rules=fs.readFileSync(file,'utf8');
    if(count(rules,MARKER)!==expectedCount){
      results.push({stageId,status:'FAIL',category:'RULE_BLOCK_COUNT_INVALID'});
      return;
    }
    emulator=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules}});
    results.push({stageId,status:'PASS',category:'RULES_COMPILED'});
  }catch(_){
    results.push({stageId,status:'FAIL',category:'RULES_COMPILE_OR_LOAD_FAILURE'});
  }finally{
    if(emulator)await emulator.cleanup().catch(()=>{});
  }
}
(async()=>{
  if(!temp||process.env.GCLOUD_PROJECT!==PROJECT||process.env.FIRESTORE_EMULATOR_HOST!==HOST+':'+PORT||!PROJECT.startsWith('demo-')){
    results.push({stageId:'ISOLATION_CONFIGURATION',status:'FAIL',category:'DEMO_EMULATOR_CONFIGURATION_REQUIRED'});
  }else{
    await compile('REAL_BASELINE_RULES_COMPILE','JARVIS_9C_DEPLOYED_RULES_PATH',0);
    await compile('REAL_COMBINED_RULES_COMPILE','JARVIS_9C_COMBINED_RULES_PATH',1);
  }
  const report={stageId:'REAL_RULES_COMPILE_SUMMARY',total:results.length,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results,projectId:PROJECT,emulatorOnly:true,rawRulesLogged:false};
  try{fs.writeFileSync(path.join(temp,'9c-real-rules-compile-results.json'),JSON.stringify(report),{mode:0o600});}
  catch(_){console.error(JSON.stringify({stageId:'REAL_RULES_COMPILE_REPORT',status:'FAIL',category:'TEMPORARY_REPORT_WRITE_FAILURE'}));process.exitCode=1;return;}
  console.log(JSON.stringify({stageId:report.stageId,total:report.total,passed:report.passed,failed:report.failed,results,projectId:PROJECT,emulatorOnly:true,rawRulesLogged:false}));
  if(report.failed||report.total!==2)process.exitCode=1;
})();
