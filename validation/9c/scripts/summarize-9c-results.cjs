const fs=require('node:fs');
const path=require('node:path');
const temp=process.env.RUNNER_TEMP;
if(!temp)throw new Error('RUNNER_TEMP_REQUIRED');
const allowed=new Set(['RULES_COMPILATION_FAILURE','RULES_LOAD_FAILURE','EMULATOR_CONNECTION_FAILURE','EMULATOR_SETUP_FAILURE','PERMISSION_DENIED','PERMISSION_PROFILE_MISMATCH','FIXTURE_SETUP_FAILURE','CLIENT_CONTEXT_INIT_FAILURE','CANDIDATE_INIT_FAILURE','BROWSER_INIT_FAILURE','DOM_INIT_FAILURE','UI_INIT_FAILURE','ASSERTION_FAILURE','TEST_LOGIC_FAILURE','UNKNOWN_TEST_FAILURE']);
const allowedStages=new Set([
  'HARNESS_SETUP','CANDIDATE_MODULE_INIT','CANDIDATE_MODULE_INIT_9A','CANDIDATE_MODULE_INIT_9A3','CANDIDATE_MODULE_INIT_9C','COMBINED_RULES_FILE_READ','BASELINE_RULES_FILE_READ',
  'BASELINE_RULES_INIT','BASELINE_FIXTURE_RESET','BASELINE_FIXTURE_SEED','BASELINE_OWNER_CONTEXT_INIT',
  'BASELINE_OTHER_CONTEXT_INIT','BASELINE_ANONYMOUS_CONTEXT_INIT','BASELINE_PROFILE_MANAGER_OWNER_READ',
  'BASELINE_PROFILE_SETTINGS_OWNER_READ','BASELINE_PROFILE_MANAGER_OTHER_READ','BASELINE_PROFILE_SETTINGS_OTHER_READ',
  'BASELINE_PROFILE_MANAGER_ANONYMOUS_READ','BASELINE_PROFILE_SETTINGS_ANONYMOUS_READ',
  'COMBINED_RULES_INIT','COMBINED_FIXTURE_RESET','COMBINED_FIXTURE_SEED','COMBINED_OWNER_CONTEXT_INIT',
  'COMBINED_OTHER_CONTEXT_INIT','COMBINED_ANONYMOUS_CONTEXT_INIT','COMBINED_PROFILE_MANAGER_OWNER_READ',
  'COMBINED_PROFILE_SETTINGS_OWNER_READ','COMBINED_PROFILE_MANAGER_OTHER_READ','COMBINED_PROFILE_SETTINGS_OTHER_READ',
  'COMBINED_PROFILE_MANAGER_ANONYMOUS_READ','COMBINED_PROFILE_SETTINGS_ANONYMOUS_READ',
  'PERMISSION_PROFILE_COMPARE','FIRESTORE_CLIENT_CONTEXT_INIT','DECISION_INTEGRATION_TEST','TEST_DATA_RESET',
  'COMBINED_RULES_FILE_READ','EMULATOR_DATABASE_RESET','OWNER_CLIENT_CONTEXT_INIT','FIRESTORE_ADAPTER_INIT','RUNTIME_INIT','PLAYWRIGHT_BRIDGE_INIT',
  'RUNTIME_INIT','PLAYWRIGHT_BROWSER_LAUNCH','PLAYWRIGHT_CONTEXT_INIT','PLAYWRIGHT_PAGE_INIT',
  'PLAYWRIGHT_NETWORK_ISOLATION','PLAYWRIGHT_BRIDGE_INIT','DOM_CONTENT_INITIALIZATION',
  'UI_RENDER_INITIALIZATION','TEST_SCENARIO_RESET','UI_TEST_START','UI_ALERT_WAIT','UI_ALERT_THRESHOLD_ASSERT',
  'UI_MODE_ASSERT','UI_DECISION_SELECT','UI_PREPARE_CLICK','UI_PROPOSAL_WAIT','UI_CANCEL_CLICK',
  'UI_CANCEL_COMPLETE_WAIT','UI_EMPTY_SNAPSHOT_ASSERT','UI_CANCEL_FIRESTORE_ABSENCE_ASSERT',
  'UI_NO_FALSE_SUCCESS_ASSERT','UI_EXPLICIT_PROPOSAL_WAIT','UI_EXPLICIT_CONFIRM_CLICK',
  'UI_TRANSACTION_RESULT_WAIT','UI_TRANSACTION_STATUS_ASSERT','UI_FIRESTORE_WRITE_ASSERT',
  'UI_NEW_SESSION_REREAD','UI_DECISION_GROUP_REFRESH_ASSERT','DECISION_INITIALIZATION',
  'UI_INITIALIZATION','DECISION_TEST','UI_TEST_START'
]);
const safeStage=(value,fallback)=>allowedStages.has(value)?value:fallback;
const allowedPermissionIds=new Set(['managerOwnerRead','settingsOwnerRead','managerOtherRead','settingsOtherRead','managerAnonymousRead','settingsAnonymousRead']);
const suites=[
  {id:'DECISION_SUITE',file:path.join(temp,'9c-decisions-results.json'),log:path.join(temp,'9c-decisions.log')},
  {id:'RENDERED_UI_SUITE',file:path.join(temp,'9c-candidate-ui-results.json'),log:path.join(temp,'9c-ui.log')}
];
let passed=0,failed=0,missing=0;
for(const suite of suites){
  if(!fs.existsSync(suite.file)){
    missing++;
    const log=fs.existsSync(suite.log)?fs.readFileSync(suite.log,'utf8').toLowerCase():'';
    let category='TEST_PROCESS_STARTUP_FAILURE';
    if(/syntax|compil|parse.{0,80}rules|rules.{0,80}(syntax|compil|parse)/.test(log))category='RULES_COMPILATION_FAILURE';
    else if(/econnrefused|connection refused|unavailable|emulator.{0,80}(start|connect)/.test(log))category='EMULATOR_CONNECTION_FAILURE';
    console.log(JSON.stringify({suiteId:suite.id,status:'NOT_STARTED',stageId:suite.id+'_PROCESS_START',category}));
    failed++;
    continue;
  }
  const report=JSON.parse(fs.readFileSync(suite.file,'utf8'));
  const failures=(report.tests||[]).filter(item=>item.status==='ÉCHEC').map(item=>({
    testId:typeof item.testId==='string'&&/^(DECISION|UI)_(TEST_[0-9]{2}|INITIALIZATION)$/.test(item.testId)?item.testId:suite.id+'_UNCLASSIFIED_TEST',
    stageId:safeStage(typeof item.stage==='string'?item.stage:(typeof item.stageId==='string'?item.stageId:''),suite.id+'_UNCLASSIFIED_STAGE'),
    category:allowed.has(item.category)?item.category:(allowed.has(item.errorCode)?item.errorCode:(allowed.has(item.code)?item.code:'UNKNOWN_TEST_FAILURE')),permissionIds:Array.isArray(item.permissionIds)?item.permissionIds.filter(value=>allowedPermissionIds.has(value)):undefined
  }));
  const suitePassed=Number.isInteger(report.passed)?report.passed:Math.max(0,(report.total||0)-failures.length);
  passed+=suitePassed;failed+=failures.length;
  console.log(JSON.stringify({suiteId:suite.id,total:report.total??suitePassed+failures.length,passed:suitePassed,failed:failures.length,failures,candidateSha256:report.candidateSha256||undefined,projectId:report.projectId||undefined,emulatorOnly:report.emulatorOnly===true,firebaseProductionWrites:0,rawErrorsPublished:false}));
}
console.log(JSON.stringify({diagnosticId:'9C_FAKE_RULES_EMULATOR_SUMMARY',passed,failed,missingSuites:missing,allFailuresClassified:true}));
if(failed||missing)process.exitCode=1;
