const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let stageId='FAKE_RULES_PREP_INIT';
function fail(category){process.stderr.write(JSON.stringify({stageId,category})+'\n');process.exit(1);}
function countLiteral(text,token){return text.split(token).length-1;}
function locateMatchBlock(text,marker){
  const hits=[];
  let cursor=0;
  while((cursor=text.indexOf(marker,cursor))!==-1){hits.push(cursor);cursor+=marker.length;}
  if(hits.length!==1)throw Object.assign(new Error('Expected one exact target block'),{safeCategory:'FAKE_RULE_BLOCK_COUNT_INVALID'});
  const markerAt=hits[0];
  const lineStart=text.lastIndexOf('\n',markerAt-1)+1;
  if(text.slice(lineStart,markerAt).trim()!=='')throw Object.assign(new Error('Target match is not a standalone rule line'),{safeCategory:'FAKE_RULE_BLOCK_SHAPE_INVALID'});
  let open=markerAt+marker.length;
  while(open<text.length && /\s/.test(text[open]))open++;
  if(text[open]!=='{')throw Object.assign(new Error('Target match body is missing'),{safeCategory:'FAKE_RULE_BLOCK_SHAPE_INVALID'});
  let depth=0,state='normal',quote='';
  for(let i=open;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(state==='line'){if(ch==='\n')state='normal';continue;}
    if(state==='block'){if(ch==='*'&&next==='/'){state='normal';i++;}continue;}
    if(state==='string'){
      if(ch==='\\'){i++;continue;}
      if(ch===quote)state='normal';
      continue;
    }
    if(ch==='/'&&next==='/'){state='line';i++;continue;}
    if(ch==='/'&&next==='*'){state='block';i++;continue;}
    if(ch==="'"||ch==='"'){state='string';quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'){
      depth--;
      if(depth===0){
        let end=i+1;
        if(text.slice(end,end+2)==='\r\n')end+=2;
        else if(text[end]==='\n')end++;
        return {start:lineStart,end,block:text.slice(lineStart,i+1)};
      }
    }
  }
  throw Object.assign(new Error('Target match body is unbalanced'),{safeCategory:'FAKE_RULE_BLOCK_UNBALANCED'});
}
try{
  const root=path.resolve(__dirname,'..');
  const temp=process.env.RUNNER_TEMP;
  const project=process.env.GCLOUD_PROJECT;
  if(!temp||project!=='demo-jarvis-replenishment-9c'||!project.startsWith('demo-'))fail('ISOLATION_CONFIGURATION_FAILURE');
  stageId='FAKE_RULES_INPUT_READ';
  const source=fs.readFileSync(path.join(root,'firestore.rules.proposed'),'utf8');
  const fragment=fs.readFileSync(path.join(root,'firestore.rules-9c-additive.fragment'),'utf8');
  if(source.includes('JARVIS_9C_RULES_TEMP')||source.includes('86F10B4A')||fragment.includes('JARVIS_9C_RULES_TEMP')||fragment.includes('86F10B4A'))fail('FAKE_RULES_SOURCE_INVALID');
  const marker='match /fath3d/{userId}/replenishmentDecisions/{productId}';
  stageId='FAKE_9A_BASE_EXTRACTION';
  const existing=locateMatchBlock(source,marker);
  const baseline=source.slice(0,existing.start)+source.slice(existing.end);
  if(countLiteral(baseline,marker)!==0)fail('FAKE_9A_BASE_STILL_CONTAINS_9C');
  stageId='FAKE_9C_FRAGMENT_VALIDATION';
  const addition=locateMatchBlock(fragment,marker);
  if(countLiteral(fragment,marker)!==1)fail('FAKE_9C_FRAGMENT_COUNT_INVALID');
  const block=addition.block.trimEnd();
  stageId='CANDIDATE_INTEGRITY_CHECK';
  const candidatePath=process.env.JARVIS_9C_CANDIDATE_PATH;
  const expectedCandidate='C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76';
  if(!candidatePath||!fs.existsSync(candidatePath))fail('CANDIDATE_FILE_MISSING');
  const candidateHash=crypto.createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex').toUpperCase();
  if(candidateHash!==expectedCandidate)fail('CANDIDATE_HASH_MISMATCH');
  stageId='FAKE_RULES_COMBINE';
  const insertion='match /databases/{database}/documents {';
  if(countLiteral(baseline,insertion)!==1)fail('FAKE_RULES_COMBINE_FAILURE');
  const eol=baseline.includes('\r\n')?'\r\n':'\n';
  const indented=block.split(/\r?\n/).map(line=>'    '+line).join(eol);
  const combined=baseline.replace(insertion,()=>insertion+eol+indented+eol);
  if(countLiteral(combined,marker)!==1)fail('COMBINED_9C_BLOCK_COUNT_INVALID');
  if(countLiteral(baseline,marker)!==0)fail('BASELINE_9C_BLOCK_COUNT_INVALID');
  const baselinePath=path.join(temp,'jarvis-9c-fake-baseline-9a.rules');
  const combinedPath=path.join(temp,'jarvis-9c-fake-combined.rules');
  const configPath=path.join(temp,'jarvis-9c-fake-firebase.json');
  fs.writeFileSync(baselinePath,baseline,{mode:0o600,flag:'wx'});
  fs.writeFileSync(combinedPath,combined,{mode:0o600,flag:'wx'});
  const config=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  config.firestore.rules=baselinePath;
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
  const env=process.env.GITHUB_ENV;
  if(!env)fail('RUNNER_ENV_UNAVAILABLE');
  fs.appendFileSync(env,'JARVIS_9C_DEPLOYED_RULES_PATH='+baselinePath+'\nJARVIS_9C_COMBINED_RULES_PATH='+combinedPath+'\nJARVIS_9C_FIREBASE_CONFIG='+configPath+'\n');
  process.stdout.write(JSON.stringify({
    stageId:'FAKE_RULES_PREPARED',category:'FAKE_ONLY_MODE',
    baselineSha256:crypto.createHash('sha256').update(baseline).digest('hex').toUpperCase(),
    combinedSha256:crypto.createHash('sha256').update(combined).digest('hex').toUpperCase(),
    baseline9cBlockCount:0,combined9cBlockCount:countLiteral(combined,marker),
    removedPreexisting9cBlock:true,projectId:project,candidateSha256:candidateHash
  })+'\n');
}catch(error){fail(error&&error.safeCategory||'FAKE_RULES_PREPARATION_FAILURE');}
