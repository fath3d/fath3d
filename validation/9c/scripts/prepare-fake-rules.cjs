const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let stageId='FAKE_RULES_PREP_INIT';
function fail(category){process.stderr.write(JSON.stringify({stageId,category})+'\n');process.exit(1);}
try{
  const root=path.resolve(__dirname,'..');
  const temp=process.env.RUNNER_TEMP;
  const project=process.env.GCLOUD_PROJECT;
  if(!temp||project!=='demo-jarvis-replenishment-9c'||!project.startsWith('demo-'))fail('ISOLATION_CONFIGURATION_FAILURE');
  stageId='FAKE_RULES_INPUT_READ';
  const baseline=fs.readFileSync(path.join(root,'firestore.rules.proposed'),'utf8');
  const fragment=fs.readFileSync(path.join(root,'firestore.rules-9c-additive.fragment'),'utf8');
  if(baseline.includes('JARVIS_9C_RULES_TEMP')||baseline.includes('86F10B4A'))fail('FAKE_RULES_SOURCE_INVALID');
  stageId='CANDIDATE_INTEGRITY_CHECK';
  const candidatePath=process.env.JARVIS_9C_CANDIDATE_PATH;
  const expectedCandidate='C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76';
  if(!candidatePath||!fs.existsSync(candidatePath))fail('CANDIDATE_FILE_MISSING');
  const candidateHash=crypto.createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex').toUpperCase();
  if(candidateHash!==expectedCandidate)fail('CANDIDATE_HASH_MISMATCH');
  stageId='FAKE_RULES_COMBINE';
  const fragmentStart=fragment.indexOf('match /fath3d/');
  const block=fragmentStart<0?'':fragment.slice(fragmentStart).trim();
  const insertion='match /databases/{database}/documents {';
  if(!block.startsWith('match /fath3d/{userId}/replenishmentDecisions/{productId}')||baseline.split(insertion).length!==2)fail('FAKE_RULES_COMBINE_FAILURE');
  const baselinePath=path.join(temp,'jarvis-9c-fake-baseline.rules');
  const combinedPath=path.join(temp,'jarvis-9c-fake-combined.rules');
  const configPath=path.join(temp,'jarvis-9c-fake-firebase.json');
  fs.writeFileSync(baselinePath,baseline,{mode:0o600,flag:'wx'});
  fs.writeFileSync(combinedPath,baseline.replace(insertion,insertion+'\n    '+block+'\n'),{mode:0o600,flag:'wx'});
  const config=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  config.firestore.rules=combinedPath;
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
  const env=process.env.GITHUB_ENV;
  if(!env)fail('RUNNER_ENV_UNAVAILABLE');
  fs.appendFileSync(env,'JARVIS_9C_DEPLOYED_RULES_PATH='+baselinePath+'\nJARVIS_9C_COMBINED_RULES_PATH='+combinedPath+'\nJARVIS_9C_FIREBASE_CONFIG='+configPath+'\n');
  const out={stageId:'FAKE_RULES_PREPARED',category:'FAKE_ONLY_MODE',baselineSha256:crypto.createHash('sha256').update(baseline).digest('hex').toUpperCase(),combinedSha256:crypto.createHash('sha256').update(fs.readFileSync(combinedPath)).digest('hex').toUpperCase(),projectId:project,candidateSha256:candidateHash};
  process.stdout.write(JSON.stringify(out)+'\n');
}catch(_){fail('FAKE_RULES_PREPARATION_FAILURE');}
