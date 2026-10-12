const fs=require('node:fs');
const path=require('node:path');
const temp=process.env.RUNNER_TEMP;
if(!temp)throw new Error('RUNNER_TEMP_REQUIRED');
const reports=[
  ['Firestore candidate',path.join(temp,'9c-decisions-results.json')],
  ['UI candidate + emulator',path.join(temp,'9c-candidate-ui-results.json')]
];
let any=false;
function safeFailure(test){
  const code=typeof test.errorCode==='string'?test.errorCode:'';
  if(/^[A-Za-z0-9_./-]{1,80}$/.test(code))return code;
  const message=String(test.error||'');
  const match=message.match(/\b(?:DECISION|FIRESTORE|FIREBASE|PERMISSION|AUTH|RULES|ERR)_[A-Z0-9_]+\b/);
  if(match)return match[0];
  if(/assertion/i.test(message))return 'ASSERTION_FAILURE';
  return 'TEST_FAILURE_NO_SAFE_ERROR_CODE';
}
for(const [label,file] of reports){
  if(!fs.existsSync(file)){console.log(JSON.stringify({suite:label,status:'NON_TERMINÉE',reason:'EMULATOR_OR_RULES_COMPILATION_FAILED'}));continue;}
  any=true;
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  console.log(JSON.stringify({suite:label,total:report.total??report.passed+report.failed,passed:report.passed,failed:report.failed,failures:(report.tests||[]).filter(test=>test.status==='ÉCHEC').map(test=>({name:test.name,errorCode:safeFailure(test)})),candidateSha256:report.candidateSha256||undefined,projectId:report.projectId,emulatorOnly:report.emulatorOnly,firebaseProductionWrites:0}));
}
if(!any)process.exitCode=1;

