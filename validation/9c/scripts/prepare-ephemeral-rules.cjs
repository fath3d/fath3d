const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const expectedSha256 = '86F10B4A042446885FA5F756E51CE510C884A10D2F2BB79DCB6674B21C50CA9C';
const deployed = process.env.JARVIS_9C_RULES_TEMP;
const runnerTemp = process.env.RUNNER_TEMP;
if (typeof deployed !== 'string' || !runnerTemp) throw new Error('TEMPORARY_RULES_SECRET_OR_RUNNER_TEMP_MISSING');
const actualSha256 = crypto.createHash('sha256').update(deployed, 'utf8').digest('hex').toUpperCase();
if (actualSha256 !== expectedSha256) throw new Error('PUBLISHED_RULES_FINGERPRINT_MISMATCH');
if (!deployed.startsWith("rules_version = '2';") || deployed.includes('replenishmentDecisions')) {
  throw new Error('PUBLISHED_RULES_BASELINE_INVALID_OR_ALREADY_CONTAINS_9C');
}
const matchPaths = [...deployed.matchAll(/^\s*match\s+(.+?)\s+\{\s*$/gm)].map(match => match[1].trim());
const expectedMatchPaths = [
  '/databases/{database}/documents',
  '/fath3d/{userId}',
  '/fath3d/{userId}/settings/replenishment',
  '/fath3d/{userId}/settings/replenishment/exceptions/{productId}'
];
if (JSON.stringify(matchPaths) !== JSON.stringify(expectedMatchPaths)) {
  throw new Error('PUBLISHED_RULES_MATCH_STRUCTURE_CHANGED_OR_OVERLAP_UNEXPECTED');
}

const repoRoot = path.resolve(__dirname, '..');
const candidatePath = process.env.JARVIS_9C_CANDIDATE_PATH;
const expectedCandidateSha256 = 'C5E7321F359835B048FB8C81D7A943555B3345E6665226693D57B28DEB897B76';
if (!candidatePath || !fs.existsSync(candidatePath)) throw new Error('EPHEMERAL_CANDIDATE_MANAGER_REQUIRED');
const candidateSha256 = crypto.createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex').toUpperCase();
if (candidateSha256 !== expectedCandidateSha256) throw new Error('CANDIDATE_MANAGER_HASH_MISMATCH');
const fragmentPath = path.join(repoRoot, 'firestore.rules-9c-additive.fragment');
const fragment = fs.readFileSync(fragmentPath, 'utf8');
const ruleBlock = fragment.slice(fragment.indexOf('match /fath3d/')).trim();
if (!ruleBlock.startsWith('match /fath3d/{userId}/replenishmentDecisions/{productId}')) {
  throw new Error('9C_RULE_FRAGMENT_INVALID');
}
const documentMatch = 'match /databases/{database}/documents {';
if (deployed.split(documentMatch).length !== 2) throw new Error('PUBLISHED_RULES_INSERTION_POINT_INVALID');
const deployedPath = path.join(runnerTemp, 'jarvis-9c-deployed.rules');
const combinedPath = path.join(runnerTemp, 'jarvis-9c-combined.rules');
const tempFirebaseConfig = path.join(runnerTemp, 'jarvis-9c-firebase.json');
fs.writeFileSync(deployedPath, deployed, { mode: 0o600, flag: 'wx' });
fs.writeFileSync(combinedPath, deployed.replace(documentMatch, documentMatch + '\n    ' + ruleBlock + '\n'), { mode: 0o600, flag: 'wx' });
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8'));
firebaseConfig.firestore.rules = combinedPath;
fs.writeFileSync(tempFirebaseConfig, JSON.stringify(firebaseConfig), { mode: 0o600, flag: 'wx' });
fs.appendFileSync(process.env.GITHUB_ENV, `JARVIS_9C_DEPLOYED_RULES_PATH=${deployedPath}\nJARVIS_9C_COMBINED_RULES_PATH=${combinedPath}\nJARVIS_9C_FIREBASE_CONFIG=${tempFirebaseConfig}\n`);
console.log('Published Rules fingerprint verified; baseline and additive 9C Rules prepared in runner-temporary files.');

