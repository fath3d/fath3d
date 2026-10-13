const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const PROJECT='demo-jarvis-replenishment-9c';
const EXPECTED_RULES_SHA256='86F10B4A042446885FA5F756E51CE510C884A10D2F2BB79DCB6674B21C50CA9C';
const EXPECTED_CANDIDATE_SHA256='C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76';
const MARKER='match /fath3d/{userId}/replenishmentDecisions/{productId}';
let stageId='REAL_RULES_PREPARATION';

function fail(category){
  process.stderr.write(JSON.stringify({stageId,category,status:'FAIL'})+'\n');
  process.exitCode=1;
}
function count(text,token){return text.split(token).length-1;}

try{
  const temp=process.env.RUNNER_TEMP;
  if(!temp||process.env.GCLOUD_PROJECT!==PROJECT||!PROJECT.startsWith('demo-')){
    stageId='ISOLATION_CONFIGURATION';
    fail('DEMO_EMULATOR_CONFIGURATION_REQUIRED');
  }else{
    stageId='PROTECTED_SECRET_INPUT';
    const rulesText=process.env.JARVIS_9C_RULES_TEMP;
    delete process.env.JARVIS_9C_RULES_TEMP;
    if(typeof rulesText!=='string'||rulesText.length===0){
      fail('PROTECTED_SECRET_MISSING');
    }else{
      stageId='REAL_RULES_SHA256';
      const actual=crypto.createHash('sha256').update(Buffer.from(rulesText,'utf8')).digest('hex').toUpperCase();
      if(actual!==EXPECTED_RULES_SHA256){
        fail('REAL_RULES_SHA256_MISMATCH');
      }else if(count(rulesText,MARKER)!==0){
        stageId='BASELINE_9C_BLOCK_CHECK';
        fail('BASELINE_ALREADY_CONTAINS_9C');
      }else{
        stageId='CANDIDATE_INTEGRITY';
        const candidatePath=process.env.JARVIS_9C_CANDIDATE_PATH;
        if(!candidatePath||!fs.existsSync(candidatePath)){
          fail('CANDIDATE_FILE_MISSING');
        }else{
          const candidateHash=crypto.createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex').toUpperCase();
          if(candidateHash!==EXPECTED_CANDIDATE_SHA256){
            fail('CANDIDATE_SHA256_MISMATCH');
          }else{
            stageId='FRAGMENT_VALIDATION';
            const repo=path.resolve(__dirname,'..');
            const fragment=fs.readFileSync(path.join(repo,'firestore.rules-9c-additive.fragment'),'utf8');
            if(count(fragment,MARKER)!==1){
              fail('9C_FRAGMENT_BLOCK_COUNT_INVALID');
            }else{
              stageId='REAL_RULES_COMBINATION';
              const insertion='match /databases/{database}/documents {';
              if(count(rulesText,insertion)!==1){
                fail('DATABASE_DOCUMENT_ROOT_MATCH_COUNT_INVALID');
              }else{
                const eol=rulesText.includes('\r\n')?'\r\n':'\n';
                const combined=rulesText.replace(insertion,()=>insertion+eol+fragment.trim().split(/\r?\n/).map(line=>'    '+line).join(eol)+eol);
                if(count(combined,MARKER)!==1){
                  fail('COMBINED_9C_BLOCK_COUNT_INVALID');
                }else{
                  stageId='TEMPORARY_RULES_WRITE';
                  const basePath=path.join(temp,'jarvis-9c-real-baseline.rules');
                  const combinedPath=path.join(temp,'jarvis-9c-real-combined.rules');
                  const configPath=path.join(temp,'jarvis-9c-real-firebase.json');
                  fs.writeFileSync(basePath,rulesText,{encoding:'utf8',mode:0o600,flag:'wx'});
                  fs.writeFileSync(combinedPath,combined,{encoding:'utf8',mode:0o600,flag:'wx'});
                  const config=JSON.parse(fs.readFileSync(path.join(repo,'firebase.json'),'utf8'));
                  config.firestore.rules=basePath;
                  fs.writeFileSync(configPath,JSON.stringify(config),{encoding:'utf8',mode:0o600,flag:'wx'});
                  const githubEnv=process.env.GITHUB_ENV;
                  if(!githubEnv)throw new Error('RUNNER_ENV_UNAVAILABLE');
                  fs.appendFileSync(githubEnv,'JARVIS_9C_DEPLOYED_RULES_PATH='+basePath+'\nJARVIS_9C_COMBINED_RULES_PATH='+combinedPath+'\nJARVIS_9C_FIREBASE_CONFIG='+configPath+'\n');
                  process.stdout.write(JSON.stringify({
                    stageId:'REAL_RULES_PREPARED',status:'PASS',projectId:PROJECT,emulatorOnly:true,
                    sourceHashVerified:true,baseline9cBlockCount:0,combined9cBlockCount:1,
                    candidateHashVerified:true,rawRulesLogged:false
                  })+'\n');
                }
              }
            }
          }
        }
      }
    }
  }
}catch(_){
  fail('TEMPORARY_PREPARATION_FAILURE');
}
