const fs=require('node:fs');
const path=require('node:path');
const temp=process.env.RUNNER_TEMP;
const suites=[
  {suiteId:'DECISION_SUITE',file:'9c-decisions-results.json'},
  {suiteId:'RENDERED_UI_SUITE',file:'9c-candidate-ui-results.json'}
];
const safeCategories=new Set([
  'RULES_COMPILED','RULE_FILE_MISSING','RULE_BLOCK_COUNT_INVALID','RULES_COMPILATION_FAILURE','RULES_LOAD_FAILURE',
  'DEMO_EMULATOR_CONFIGURATION_REQUIRED','TEMPORARY_REPORT_WRITE_FAILURE',
  'PERMISSION_DENIED','PERMISSION_PROFILE_MISMATCH','FIXTURE_SETUP_FAILURE',
  'CLIENT_CONTEXT_INIT_FAILURE','CANDIDATE_INIT_FAILURE','UI_INIT_FAILURE','ASSERTION_FAILURE',
  'TEST_LOGIC_FAILURE','UNKNOWN_TEST_FAILURE','EMULATOR_CONNECTION_FAILURE','EMULATOR_SETUP_FAILURE'
]);
const safeStages=new Set([
  'REAL_BASELINE_RULES_COMPILE','REAL_COMBINED_RULES_COMPILE','ISOLATION_CONFIGURATION','COMBINED_RULES_FILE_READ','BASELINE_RULES_FILE_READ','CANDIDATE_MODULE_INIT','CANDIDATE_MODULE_INIT_9A','CANDIDATE_MODULE_INIT_9A3','CANDIDATE_MODULE_INIT_9C','FIRESTORE_CLIENT_CONTEXT_INIT','OWNER_CLIENT_CONTEXT_INIT','FIRESTORE_ADAPTER_INIT','RUNTIME_INIT','PLAYWRIGHT_BROWSER_LAUNCH','PLAYWRIGHT_CONTEXT_INIT','PLAYWRIGHT_PAGE_INIT','PLAYWRIGHT_NETWORK_ISOLATION','PLAYWRIGHT_BRIDGE_INIT','DOM_CONTENT_INITIALIZATION','UI_RENDER_INITIALIZATION','EMULATOR_DATABASE_RESET','BASELINE_FIXTURE_RESET','BASELINE_FIXTURE_SEED','BASELINE_OWNER_CONTEXT_INIT','BASELINE_OTHER_CONTEXT_INIT','BASELINE_ANONYMOUS_CONTEXT_INIT','COMBINED_FIXTURE_RESET','COMBINED_FIXTURE_SEED','COMBINED_OWNER_CONTEXT_INIT','COMBINED_OTHER_CONTEXT_INIT','COMBINED_ANONYMOUS_CONTEXT_INIT',
  'PERMISSION_PROFILE_COMPARE','BASELINE_RULES_INIT','COMBINED_RULES_INIT',
  'BASELINE_PROFILE_MANAGER_OWNER_READ','BASELINE_PROFILE_SETTINGS_OWNER_READ',
  'BASELINE_PROFILE_MANAGER_OTHER_READ','BASELINE_PROFILE_SETTINGS_OTHER_READ',
  'BASELINE_PROFILE_MANAGER_ANONYMOUS_READ','BASELINE_PROFILE_SETTINGS_ANONYMOUS_READ',
  'COMBINED_PROFILE_MANAGER_OWNER_READ','COMBINED_PROFILE_SETTINGS_OWNER_READ',
  'COMBINED_PROFILE_MANAGER_OTHER_READ','COMBINED_PROFILE_SETTINGS_OTHER_READ',
  'COMBINED_PROFILE_MANAGER_ANONYMOUS_READ','COMBINED_PROFILE_SETTINGS_ANONYMOUS_READ',
  'DECISION_INTEGRATION_TEST','TEST_DATA_RESET','DECISION_INITIALIZATION',
  'UI_INITIALIZATION','UI_TEST_START','UI_ALERT_WAIT','UI_ALERT_THRESHOLD_ASSERT','UI_MODE_ASSERT',
  'UI_DECISION_SELECT','UI_PREPARE_CLICK','UI_PROPOSAL_WAIT','UI_CANCEL_CLICK',
  'UI_CANCEL_COMPLETE_WAIT','UI_EMPTY_SNAPSHOT_ASSERT','UI_CANCEL_FIRESTORE_ABSENCE_ASSERT',
  'UI_NO_FALSE_SUCCESS_ASSERT','UI_EXPLICIT_PROPOSAL_WAIT','UI_EXPLICIT_CONFIRM_CLICK',
  'UI_TRANSACTION_RESULT_WAIT','UI_TRANSACTION_STATUS_ASSERT','UI_FIRESTORE_WRITE_ASSERT',
  'UI_NEW_SESSION_REREAD','UI_DECISION_GROUP_REFRESH_ASSERT'
]);
function safeFailure(item,fallback){
  const stage=item.stage||item.stageId||fallback;
  const category=item.category||item.errorCode||item.code;
  return {
    testId:typeof item.testId==='string'?item.testId:fallback,
    stageId:safeStages.has(stage)?stage:fallback+'_UNCLASSIFIED_STAGE',
    category:safeCategories.has(category)?category:'UNKNOWN_TEST_FAILURE'
  };
}
function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return null;}
}
if(!temp){
  console.log(JSON.stringify({stageId:'REAL_RULES_RESULT_SUMMARY',status:'FAIL',category:'RUNNER_TEMP_MISSING',rawRulesLogged:false}));
  process.exit(1);
}
const emulatorExit=Number(process.argv[2]||0);
const compile=readJson(path.join(temp,'9c-real-rules-compile-results.json'));
let passed=compile&&Number.isInteger(compile.passed)?compile.passed:0;
let failed=compile&&Number.isInteger(compile.failed)?compile.failed:0;
const compileResults=compile&&Array.isArray(compile.results)?compile.results.map(x=>({
  stageId:safeStages.has(x.stageId)?x.stageId:'REAL_RULES_COMPILE_UNCLASSIFIED',
  status:x.status==='PASS'?'PASS':'FAIL',
  category:safeCategories.has(x.category)?x.category:'UNKNOWN_TEST_FAILURE'
})):[];
if(!compile){failed++;compileResults.push({stageId:emulatorExit?'EMULATOR_START_OR_COMPILE_INIT':'REAL_RULES_COMPILE_REPORT',status:'FAIL',category:emulatorExit?'EMULATOR_SETUP_FAILURE':'TEMPORARY_REPORT_WRITE_FAILURE'});}
const suiteReports=[];
let missing=0;
for(const suite of suites){
  const report=readJson(path.join(temp,suite.file));
  if(!report){
    missing++;
    suiteReports.push({suiteId:suite.suiteId,status:'NOT_RUN',total:0,passed:0,failed:0,failures:[]});
    continue;
  }
  const failures=(report.tests||[]).filter(x=>x.status==='ÉCHEC').map(x=>safeFailure(x,suite.suiteId));
  const suitePassed=Number.isInteger(report.passed)?report.passed:Math.max(0,(report.total||0)-failures.length);
  const total=Number.isInteger(report.total)?report.total:suitePassed+failures.length;
  passed+=suitePassed;failed+=failures.length;
  suiteReports.push({suiteId:suite.suiteId,status:failures.length?'FAIL':'PASS',total,passed:suitePassed,failed:failures.length,failures});
}
if(emulatorExit&&missing===suites.length&&!compile){
  // The CLI failed before any validator could run; details remain only in a private temp log.
  if(!compileResults.length){failed=Math.max(failed,1);}
}
const report={stageId:'REAL_RULES_EMULATOR_SUMMARY',projectId:'demo-jarvis-replenishment-9c',emulatorOnly:true,compilation:{total:compile?.total||2,passed:compile?.passed||0,failed:compile?.failed||1,results:compileResults},suites:suiteReports,passed,failed,notRun:missing,firebaseProductionWrites:0,rawRulesLogged:false};
console.log(JSON.stringify(report));
if(failed||missing||emulatorExit)process.exitCode=1;
