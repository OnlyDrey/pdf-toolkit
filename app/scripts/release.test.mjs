import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { URLSearchParams, URL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { createHash } from 'node:crypto'
import {
  releaseInputs,
  nextVersion,
  resolveAndReserve,
  preflight,
  inspectImage,
  ReservationConflict,
  GitHubApiError,
  approvalPolicy,
  authorizePublication,
  github as githubRequest,
} from './release.mjs'

const work = 'a'.repeat(40),
  main = 'b'.repeat(40)
const runUrl = 'https://github.com/OnlyDrey/pdf-toolkit/actions/runs/123'
const event = { name: 'workflow_dispatch', channel: 'beta', version: '1.2.0' }
function fakeGithub(options = {}) {
  const state = {
    heads: { work, main },
    tags: [],
    releases: new Set(),
    refs: new Map(),
    objects: new Map(),
    writes: [],
    reads: [],
    jobs: [
      {
        name: 'Build and scan',
        run_attempt: 1,
        head_sha: 'c'.repeat(40),
        status: 'completed',
        conclusion: 'success',
      },
    ],
    owner: { type: 'User', id: 42 },
    run: {
      event: 'workflow_dispatch',
      html_url: runUrl,
      head_sha: 'c'.repeat(40),
      actor: { id: 42 },
      triggering_actor: { id: 42 },
      run_attempt: 1,
    },
    environment: {
      can_admins_bypass: false,
      protection_rules: [
        {
          type: 'required_reviewers',
          prevent_self_review: true,
          reviewers: [{}],
        },
      ],
    },
    conflicts: 0,
    ...options,
  }
  let sequence = 0
  const github = async (path, { method = 'GET', body } = {}) => {
    if (method === 'POST') {
      state.writes.push({ path, body })
      if (path === '/git/tags') {
        const sha = (++sequence).toString(16).padStart(40, '0')
        state.objects.set(sha, {
          tag: body.tag,
          message: body.message,
          object: { type: body.type, sha: body.object },
        })
        return { sha }
      }
      assert.equal(path, '/git/refs')
      assert.equal(body.force, undefined)
      const name = body.ref.slice('refs/tags/'.length)
      if (state.conflicts > 0) {
        state.conflicts--
        state.tags.push(name)
        state.refs.set(name, { object: { type: 'tag', sha: 'f'.repeat(40) } })
        throw new ReservationConflict('Reference already exists')
      }
      if (state.refs.has(name))
        throw new ReservationConflict('Reference already exists')
      state.tags.push(name)
      state.refs.set(name, { object: { type: 'tag', sha: body.sha } })
      return { ref: body.ref }
    }
    state.reads.push(path)
    if (path === '/') return { owner: state.owner }
    if (path.includes('/jobs?')) return { jobs: state.jobs }
    if (path.startsWith('/actions/runs/')) return state.run
    if (path.startsWith('/environments?')) {
      if (state.listingError) throw state.listingError
      return { environments: state.listing || [] }
    }
    if (path.startsWith('/environments/')) {
      if (state.environmentError) throw state.environmentError
      return state.environment
    }
    if (path.startsWith('/git/ref/heads/'))
      return {
        object: { type: 'commit', sha: state.heads[path.split('/').at(-1)] },
      }
    if (path.startsWith('/commits/')) return { sha: path.split('/').at(-1) }
    if (path.startsWith('/tags?')) {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'))
      return state.tags
        .slice((page - 1) * 100, page * 100)
        .map((name) => ({ name }))
    }
    if (path.startsWith('/git/ref/tags/'))
      return state.refs.get(path.slice('/git/ref/tags/'.length)) || null
    if (path.startsWith('/releases/tags/'))
      return state.releases.has(path.split('/').at(-1)) ? { id: 1 } : null
    if (path.startsWith('/git/tags/'))
      return state.objects.get(path.split('/').at(-1))
    throw new Error(`Unexpected API request ${path}`)
  }
  return { state, github }
}

for (const [name, change] of [
  ['automatic pushes', { name: 'push' }],
  ['unknown channel', { channel: 'latest' }],
  ['leading v', { version: 'v1.2.0' }],
  ['manual beta number', { version: '1.2.0-beta.1' }],
  ['leading zero', { version: '01.2.0' }],
  ['build metadata', { version: '1.2.0+build' }],
  ['missing version', { version: undefined }],
  ['newline', { version: '1.2.0\n' }],
  ['injected value', { version: '1.2.0\nlatest' }],
  ['oversized version', { version: `${'1'.repeat(130)}.0.0` }],
])
  test(`input validation rejects ${name}`, () =>
    assert.throws(() => releaseInputs({ ...event, ...change })))

test('only channel and base version select the application branch', async () => {
  for (const selector of [
    'refs/heads/main',
    'refs/heads/work',
    'refs/heads/another-policy-branch',
  ]) {
    for (const channel of ['beta', 'production']) {
      const fake = fakeGithub()
      const plan = await resolveAndReserve(
        { ...event, channel, ref: selector, sha: 'c'.repeat(40) },
        fake.github,
        runUrl,
      )
      assert.equal(plan.source_sha, channel === 'beta' ? work : main)
      assert.equal(plan.image_channel, channel === 'beta' ? 'beta' : 'latest')
    }
  }
})
test('beta starts at one and increments the highest number only for its base', () => {
  assert.equal(nextVersion('1.2.0', 'beta', []), '1.2.0-beta.1')
  assert.equal(
    nextVersion('1.2.0', 'beta', [
      'v1.2.0-beta.2',
      'v1.2.0-beta.10',
      'v1.2.1-beta.99',
      'v1.2.0-beta.3',
    ]),
    '1.2.0-beta.11',
  )
  assert.equal(
    nextVersion('1.2.0', 'beta', [
      'v1.2.0-beta.01',
      'v1.2.0-beta.7\n',
      'v1.2.0-rc.8',
      'v1.2.0',
    ]),
    '1.2.0-beta.1',
  )
  assert.equal(nextVersion('1.2.0', 'production', ['v1.2.0-beta.9']), '1.2.0')
})
test('beta numbering does not lose precision for large existing sequences', () => {
  assert.equal(
    nextVersion('1.2.0', 'beta', ['v1.2.0-beta.9007199254740993']),
    '1.2.0-beta.9007199254740994',
  )
})
test('all tag pages are included in beta numbering', async () => {
  const fake = fakeGithub({
    tags: [
      ...Array.from({ length: 100 }, (_, n) => `v2.0.0-beta.${n + 1}`),
      'v1.2.0-beta.42',
    ],
  })
  assert.equal(
    (await resolveAndReserve(event, fake.github, runUrl)).version,
    '1.2.0-beta.43',
  )
})
test('atomic reservation retries a beta race without overwriting the winner', async () => {
  const fake = fakeGithub({ conflicts: 1 })
  const plan = await resolveAndReserve(event, fake.github, runUrl)
  assert.equal(plan.version, '1.2.0-beta.2')
  assert.equal(fake.state.refs.get('v1.2.0-beta.1').object.sha, 'f'.repeat(40))
  assert.equal(fake.state.refs.get(plan.tag).object.sha, plan.reservation_sha)
})
test('repeated concurrent reservations fail clearly rather than forcing a ref', async () => {
  const fake = fakeGithub({ conflicts: 3 })
  await assert.rejects(
    resolveAndReserve(event, fake.github, runUrl),
    /conflicted repeatedly/,
  )
  assert.equal(
    fake.state.writes.filter((entry) => entry.path === '/git/refs').length,
    3,
  )
})
test('the annotated reservation records source, version and workflow run', async () => {
  const fake = fakeGithub()
  const plan = await resolveAndReserve(event, fake.github, runUrl)
  const record = JSON.parse(
    fake.state.objects.get(plan.reservation_sha).message,
  )
  assert.equal(record.source_sha, work)
  assert.equal(record.version, '1.2.0-beta.1')
  assert.equal(record.run_url, runUrl)
  await preflight(plan, fake.github)
})
test('failed reservations remain numbered and a later run allocates the next beta', async () => {
  const fake = fakeGithub()
  const first = await resolveAndReserve(event, fake.github, runUrl)
  const second = await resolveAndReserve(event, fake.github, runUrl)
  assert.equal(first.version, '1.2.0-beta.1')
  assert.equal(second.version, '1.2.0-beta.2')
  assert.ok(fake.state.refs.has(first.tag))
})
test('production refuses an existing stable tag before any write', async () => {
  const fake = fakeGithub({
    refs: new Map([['v1.2.0', { object: { type: 'commit', sha: main } }]]),
  })
  await assert.rejects(
    resolveAndReserve({ ...event, channel: 'production' }, fake.github, runUrl),
    /already exists/,
  )
  assert.equal(fake.state.writes.length, 0)
})
test('a versioned GitHub Release cannot be overwritten even if its ref is missing', async () => {
  const fake = fakeGithub({ releases: new Set(['v1.2.0']) })
  await assert.rejects(
    resolveAndReserve({ ...event, channel: 'production' }, fake.github, runUrl),
    /Release already exists/,
  )
  assert.equal(fake.state.writes.length, 0)
})
for (const channel of ['beta', 'production'])
  test(`${channel} stops if its source HEAD moves before publication`, async () => {
    const fake = fakeGithub()
    const plan = await resolveAndReserve(
      { ...event, channel },
      fake.github,
      runUrl,
    )
    fake.state.heads[plan.branch] = 'd'.repeat(40)
    await assert.rejects(preflight(plan, fake.github), /HEAD changed/)
    assert.ok(fake.state.refs.has(plan.tag))
  })
test('changed reservations and mismatched target commits fail closed', async () => {
  const fake = fakeGithub()
  const plan = await resolveAndReserve(event, fake.github, runUrl)
  fake.state.objects.get(plan.reservation_sha).object.sha = main
  await assert.rejects(preflight(plan, fake.github), /pinned source/)
  fake.state.refs.set(plan.tag, { object: { type: 'tag', sha: main } })
  await assert.rejects(preflight(plan, fake.github), /changed or disappeared/)
})
test('beta cannot change its moving channel or claim a production source', async () => {
  const fake = fakeGithub()
  const plan = await resolveAndReserve(event, fake.github, runUrl)
  await assert.rejects(
    preflight({ ...plan, image_channel: 'latest' }, fake.github),
    /channel policy/,
  )
  await assert.rejects(
    preflight({ ...plan, branch: 'main' }, fake.github),
    /channel policy/,
  )
})
for (const environment of [
  {
    can_admins_bypass: false,
    protection_rules: [
      { type: 'required_reviewers', prevent_self_review: true, reviewers: [] },
    ],
  },
  { can_admins_bypass: false, protection_rules: [] },
  {
    can_admins_bypass: true,
    protection_rules: [
      {
        type: 'required_reviewers',
        prevent_self_review: true,
        reviewers: [{}],
      },
    ],
  },
  {
    can_admins_bypass: false,
    protection_rules: [
      {
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{}],
      },
    ],
  },
])
  test('missing or bypassable Environment approval blocks even reservation', async () => {
    const fake = fakeGithub({ environment })
    await assert.rejects(
      resolveAndReserve(
        { ...event, channel: 'production' },
        fake.github,
        runUrl,
      ),
      /human reviewers/,
    )
    assert.equal(fake.state.writes.length, 0)
  })
test('API failures are not treated as source or approval validation', async () => {
  await assert.rejects(
    resolveAndReserve(
      event,
      async () => {
        throw new Error('HTTP 403')
      },
      runUrl,
    ),
    /403/,
  )
})

for (const environment of [
  null,
  { protection_rules: [] },
  { protection_rules: [{ type: 'required_reviewers', reviewers: [{}] }] },
])
  test('beta needs dispatch only and never queries or attaches an Environment', async () => {
    const fake = fakeGithub({
      environment,
      environmentError: new GitHubApiError('GET', '/environments/beta', 404),
    })
    const plan = await resolveAndReserve(event, fake.github, runUrl)
    await authorizePublication(plan, fake.github)
    assert.equal(plan.environment, '')
    assert.equal(plan.approval_mode, 'dispatch')
    assert.ok(
      !fake.state.reads.some((path) => path.startsWith('/environments')),
    )
    assert.equal(plan.image_channel, 'beta')
  })

test('missing production Environment defaults to actionable failure before reservation', async () => {
  const fake = fakeGithub({ environment: null })
  await assert.rejects(
    resolveAndReserve({ ...event, channel: 'production' }, fake.github, runUrl),
    /PRODUCTION_APPROVAL_MODE=owner/,
  )
  assert.equal(fake.state.writes.length, 0)
})
test('explicit owner mode supports confirmed missing production Environment, then requires a second owner action', async () => {
  const fake = fakeGithub({ environment: null })
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
    'owner',
  )
  assert.equal(plan.environment, '')
  assert.equal(plan.source_sha, main)
  assert.equal(plan.approval_owner_id, 42)
  const writes = fake.state.writes.length
  await assert.rejects(
    authorizePublication(plan, fake.github, 'owner'),
    /Re-run failed jobs/,
  )
  assert.equal(fake.state.writes.length, writes)
  fake.state.run.run_attempt = 2
  await authorizePublication(plan, fake.github, 'owner')
  assert.equal(fake.state.writes.length, writes)
})
test('owner mode honors an existing unreviewed Environment and its other rules', async () => {
  const fake = fakeGithub({
    environment: {
      protection_rules: [{ type: 'wait_timer', wait_timer: 10 }],
      deployment_branch_policy: { protected_branches: true },
    },
  })
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
    'owner',
  )
  assert.equal(plan.environment, 'production')
  assert.equal(plan.approval_mode, 'owner')
})
test('configured reviewers take priority over an owner-mode preference', async () => {
  const fake = fakeGithub()
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
    'owner',
  )
  assert.equal(plan.approval_mode, 'environment')
  assert.equal(plan.environment, 'production')
  await authorizePublication(plan, fake.github, 'owner')
})
test('invalid configured reviewers cannot fall back to owner approval', async () => {
  const fake = fakeGithub()
  fake.state.environment.can_admins_bypass = true
  await assert.rejects(
    resolveAndReserve(
      { ...event, channel: 'production' },
      fake.github,
      runUrl,
      'owner',
    ),
    /fix configured protection/,
  )
  assert.equal(fake.state.writes.length, 0)
})
for (const status of [401, 403, 404])
  test(`owner mode never treats an inaccessible Environment list (${status}) as absent`, async () => {
    const fake = fakeGithub({
      environment: null,
      listingError: new GitHubApiError('GET', '/environments', status),
    })
    await assert.rejects(
      resolveAndReserve(
        { ...event, channel: 'production' },
        fake.github,
        runUrl,
        'owner',
      ),
      /Cannot establish/,
    )
    assert.equal(fake.state.writes.length, 0)
  })
test('a resource 404 contradicting the Environment listing fails closed', async () => {
  const fake = fakeGithub({
    environment: null,
    listing: [{ name: 'production' }],
  })
  await assert.rejects(
    approvalPolicy('production', fake.github, 'owner'),
    /listed but.*inaccessible/,
  )
})
for (const status of [401, 403])
  test(`production Environment authorization failure (${status}) is fatal in either mode`, async () => {
    const fake = fakeGithub({
      environmentError: new GitHubApiError(
        'GET',
        '/environments/production',
        status,
      ),
    })
    for (const mode of ['environment', 'owner'])
      await assert.rejects(
        resolveAndReserve(
          { ...event, channel: 'production' },
          fake.github,
          runUrl,
          mode,
        ),
        new RegExp(String(status)),
      )
    assert.equal(fake.state.writes.length, 0)
  })
test('owner approval rejects a non-owner initiator, non-manual event and organization ownership', async () => {
  for (const options of [
    {
      run: { event: 'workflow_dispatch', html_url: runUrl, actor: { id: 99 } },
    },
    { run: { event: 'push', html_url: runUrl, actor: { id: 42 } } },
    { owner: { type: 'Organization', id: 42 } },
  ]) {
    const fake = fakeGithub({ environment: null, ...options })
    await assert.rejects(
      resolveAndReserve(
        { ...event, channel: 'production' },
        fake.github,
        runUrl,
        'owner',
      ),
      /owner|organizations/,
    )
    assert.equal(fake.state.writes.length, 0)
  }
})
test('a collaborator cannot confirm an owner-initiated production rerun', async () => {
  const fake = fakeGithub({ environment: null })
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
    'owner',
  )
  fake.state.run.run_attempt = 2
  fake.state.run.triggering_actor.id = 99
  await assert.rejects(
    authorizePublication(plan, fake.github, 'owner'),
    /Owner confirmation required/,
  )
})
test('configured protection changes abort a reserved owner release', async () => {
  const fake = fakeGithub({ environment: null })
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
    'owner',
  )
  fake.state.environment = {
    can_admins_bypass: false,
    protection_rules: [
      {
        type: 'required_reviewers',
        prevent_self_review: true,
        reviewers: [{}],
      },
    ],
  }
  await assert.rejects(
    preflight(plan, fake.github, 'owner'),
    /Approval policy changed/,
  )
})
test('artifact edits cannot downgrade the immutable reserved approval policy', async () => {
  const fake = fakeGithub()
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
  )
  await assert.rejects(
    preflight(
      { ...plan, approval_mode: 'owner', approval_owner_id: 42 },
      fake.github,
      'owner',
    ),
    /immutable tag reservation/,
  )
})
test('malformed protection metadata and invalid owner-mode settings fail closed', async () => {
  await assert.rejects(
    approvalPolicy(
      'production',
      fakeGithub({ environment: {} }).github,
      'owner',
    ),
    /Unreadable/,
  )
  await assert.rejects(
    approvalPolicy('production', fakeGithub().github, 'automatic'),
    /PRODUCTION_APPROVAL_MODE/,
  )
})
for (const [status, message, missing] of [
  [404, 'Not Found', true],
  [404, 'Resource not accessible by integration', false],
  [401, 'Bad credentials', false],
  [403, 'Forbidden', false],
])
  test(`GitHub adapter handles ${status}/${message} without leaking credentials or masking authorization`, async (t) => {
    const oldRepo = process.env.GITHUB_REPOSITORY,
      oldToken = process.env.GH_TOKEN
    t.after(() => {
      if (oldRepo === undefined) delete process.env.GITHUB_REPOSITORY
      else process.env.GITHUB_REPOSITORY = oldRepo
      if (oldToken === undefined) delete process.env.GH_TOKEN
      else process.env.GH_TOKEN = oldToken
    })
    process.env.GITHUB_REPOSITORY = 'OnlyDrey/pdf-toolkit'
    process.env.GH_TOKEN = 'fixture-not-a-secret'
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status,
      json: async () => ({ message }),
    }))
    if (missing)
      assert.equal(
        await githubRequest('/environments/production', { allowMissing: true }),
        null,
      )
    else
      await assert.rejects(
        githubRequest('/environments/production', { allowMissing: true }),
        (error) =>
          error instanceof GitHubApiError &&
          error.status === status &&
          !error.message.includes('fixture-not-a-secret'),
      )
  })

function imageFixture(t, plan, options = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'pdf-release-oci-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const layout = resolve(root, 'layout'),
    scans = resolve(root, 'scans')
  mkdirSync(resolve(layout, 'blobs/sha256'), { recursive: true })
  const blob = (value, mediaType, extra = {}) => {
    const bytes = JSON.stringify(value)
    const hash = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(resolve(layout, 'blobs/sha256', hash), bytes)
    return { mediaType, digest: `sha256:${hash}`, size: bytes.length, ...extra }
  }
  const manifests = (options.arches || ['amd64', 'arm64']).map((arch) => {
    const config = blob(
      {
        architecture: arch,
        os: 'linux',
        config: {
          Labels: {
            'org.opencontainers.image.revision':
              options.source || plan.source_sha,
            'org.opencontainers.image.version': options.version || plan.version,
          },
        },
      },
      'application/vnd.oci.image.config.v1+json',
    )
    return blob(
      { schemaVersion: 2, config, layers: [] },
      'application/vnd.oci.image.manifest.v1+json',
      {
        platform: { os: 'linux', architecture: options.descriptorArch || arch },
      },
    )
  })
  if (options.attestation)
    manifests.push(
      blob({ config: {} }, 'application/vnd.oci.image.manifest.v1+json', {
        annotations: { 'vnd.docker.reference.type': 'attestation-manifest' },
        platform: { os: 'unknown', architecture: 'unknown' },
      }),
    )
  const descriptor = blob(
    { schemaVersion: 2, manifests },
    'application/vnd.oci.image.index.v1+json',
  )
  writeFileSync(
    resolve(layout, 'index.json'),
    JSON.stringify({ schemaVersion: 2, manifests: [descriptor] }),
  )
  return { layout, scans, descriptor }
}
async function planFixture() {
  return resolveAndReserve(event, fakeGithub().github, runUrl)
}
test('the exact multi-platform digest is preserved while scans get one architecture each', async (t) => {
  const plan = await planFixture()
  const fixture = imageFixture(t, plan, { attestation: true })
  const metadata = inspectImage(fixture.layout, fixture.scans, plan)
  assert.equal(metadata.image_digest, fixture.descriptor.digest)
  for (const arch of ['amd64', 'arm64']) {
    const index = JSON.parse(
      readFileSync(resolve(fixture.scans, arch, 'index.json')),
    )
    assert.equal(index.manifests.length, 1)
    assert.equal(index.manifests[0].platform.architecture, arch)
  }
})
for (const options of [
  { arches: ['amd64'] },
  { arches: ['amd64', 'amd64'] },
  { descriptorArch: 'arm64' },
  { source: main },
  { version: 'unrelated' },
])
  test('missing/mismatched platforms and unrelated source/version images are rejected', async (t) => {
    const plan = await planFixture()
    const fixture = imageFixture(t, plan, options)
    assert.throws(() => inspectImage(fixture.layout, fixture.scans, plan))
  })
test('OCI content tampering cannot preserve a claimed digest', async (t) => {
  const plan = await planFixture()
  const fixture = imageFixture(t, plan)
  writeFileSync(
    resolve(fixture.layout, 'blobs/sha256', fixture.descriptor.digest.slice(7)),
    '{}',
  )
  assert.throws(
    () => inspectImage(fixture.layout, fixture.scans, plan),
    /digest mismatch/,
  )
})

test('source movement during preparation is rejected before any tag write', async () => {
  const fake = fakeGithub()
  const github = async (path, options) => {
    const result = await fake.github(path, options)
    if (path.startsWith('/tags?')) fake.state.heads.work = main
    return result
  }
  await assert.rejects(resolveAndReserve(event, github, runUrl), /HEAD changed/)
  assert.equal(fake.state.writes.length, 0)
})
test('a Production reservation collision is never incremented or overwritten', async () => {
  const fake = fakeGithub({ conflicts: 1 })
  await assert.rejects(
    resolveAndReserve({ ...event, channel: 'production' }, fake.github, runUrl),
    ReservationConflict,
  )
  assert.equal(
    fake.state.writes.filter((entry) => entry.path === '/git/refs').length,
    1,
  )
})

test('workflow publication condition requires validation/scans and any selected Environment gate', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/release.yml', import.meta.url),
    'utf8',
  )
  const publication = workflow.split('  publish:\n')[1].split('  summary:\n')[0]
  const expression = publication
    .match(/ {4}if: >-\n((?: {6}[^\n]*\n)+)/)[1]
    .trim()
  const evaluate = new Function(
    'needs',
    'always',
    'cancelled',
    `return (${expression})`,
  )
  const statuses = ['success', 'failure', 'skipped', 'cancelled']
  for (const environment of ['', 'production', 'unexpected'])
    for (const prepare of statuses)
      for (const validate of statuses)
        for (const build of statuses)
          for (const approval of statuses)
            for (const cancelled of [false, true]) {
              const needs = {
                prepare: { result: prepare, outputs: { environment } },
                validate: { result: validate },
                build: { result: build },
                approval: { result: approval },
              }
              const expected =
                !cancelled &&
                [prepare, validate, build].every(
                  (value) => value === 'success',
                ) &&
                (environment === 'production'
                  ? approval === 'success'
                  : environment === '' && approval === 'skipped')
              assert.equal(
                evaluate(
                  needs,
                  () => true,
                  () => cancelled,
                ),
                expected,
              )
            }
  const gate = workflow.split('  approval:\n')[1].split('  publish:\n')[0]
  assert.match(gate, /needs: \[prepare, validate, build\]/)
  assert.match(gate, /environment: production/)
  assert.match(gate, /permissions: \{\}/)
  assert.doesNotMatch(publication, /\n {4}environment:/)
  assert.ok(
    publication.indexOf('publish-check') <
      publication.indexOf('docker/login-action'),
  )
  assert.match(publication, /verify-image/)
  assert.match(publication, /EXPECTED_ARCHIVE_SHA256/)
  assert.match(publication, /EXPECTED_BUNDLE_SHA256/)
  assert.equal(
    (publication.match(/release\.mjs publish-check/g) || []).length,
    3,
  )
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/)
  assert.match(workflow, /input: scans\/amd64/)
  assert.match(workflow, /input: scans\/arm64/)
})

function cliFixture(t, changes = {}) {
  const folder = mkdtempSync(resolve(tmpdir(), 'pdf-approval-cli-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const stateFile = resolve(folder, 'api.json')
  const state = {
    calls: [],
    heads: { work, main },
    jobs: [
      {
        name: 'Build and scan',
        run_attempt: 1,
        head_sha: 'c'.repeat(40),
        status: 'completed',
        conclusion: 'success',
      },
    ],
    environment: null,
    owner: { type: 'User', id: 42 },
    run: {
      event: 'workflow_dispatch',
      html_url: runUrl,
      head_sha: 'c'.repeat(40),
      actor: { id: 42 },
      triggering_actor: { id: 42 },
      run_attempt: 1,
    },
    ...changes,
  }
  writeFileSync(stateFile, JSON.stringify(state))
  const stub = resolve(folder, 'github-fixture.mjs')
  writeFileSync(
    stub,
    `
import { readFileSync, writeFileSync } from 'node:fs'
import { URL } from 'node:url'
globalThis.fetch = async (url, options) => {
 const state = JSON.parse(readFileSync('api.json'))
 const path = new URL(url).pathname.replace('/repos/OnlyDrey/pdf-toolkit', '')
 const method = options.method
 const body = options.body ? JSON.parse(options.body) : null
 state.calls.push({ path, method })
 const reply = (data, status = 200) => { writeFileSync('api.json', JSON.stringify(state)); return new Response(JSON.stringify(data), { status }) }
 if (method === 'POST' && path === '/git/tags') { state.annotation = { tag: body.tag, message: body.message, object: { type: 'commit', sha: body.object } }; return reply({ sha: '1'.repeat(40) }) }
 if (method === 'POST' && path === '/git/refs') { state.ref = body; return reply({ ref: body.ref }, 201) }
 if (method !== 'GET') throw new Error('Unexpected fixture write')
 if (path === '/') return reply({ owner: state.owner })
 if (path.includes('/jobs')) return reply({ jobs: state.jobs })
 if (path.startsWith('/actions/runs/')) return reply(state.run)
 if (path.startsWith('/git/ref/heads/')) return reply({ object: { type: 'commit', sha: state.heads[path.split('/').at(-1)] } })
 if (path.startsWith('/commits/')) return reply({ sha: path.split('/').at(-1) })
 if (path === '/environments/production') return state.environment ? reply(state.environment) : reply({ message: 'Not Found' }, 404)
 if (path === '/environments') return state.listingError ? reply({ message: 'Forbidden' }, state.listingError) : reply({ environments: [] })
 if (path === '/tags') return reply([])
 if (path.startsWith('/git/ref/tags/')) return state.ref ? reply({ object: { type: 'tag', sha: state.ref.sha } }) : reply({ message: 'Not Found' }, 404)
 if (path.startsWith('/git/tags/')) return reply(state.annotation)
 if (path.startsWith('/releases/tags/')) return reply({ message: 'Not Found' }, 404)
 throw new Error('Unexpected fixture path: ' + path)
}
`,
  )
  const script = fileURLToPath(new URL('./release.mjs', import.meta.url))
  const run = (mode, channel = 'beta', approval = '') =>
    spawnSync(process.execPath, ['--import', stub, script, mode], {
      cwd: folder,
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_TOKEN: 'fixture-not-a-secret',
        GITHUB_REPOSITORY: 'OnlyDrey/pdf-toolkit',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '123',
        GITHUB_OUTPUT: resolve(folder, 'outputs'),
        GITHUB_STEP_SUMMARY: resolve(folder, 'summary'),
        RELEASE_EVENT: 'workflow_dispatch',
        RELEASE_CHANNEL: channel,
        RELEASE_VERSION: '1.2.0',
        PRODUCTION_APPROVAL_MODE: approval,
        EXPECTED_SOURCE_SHA: channel === 'beta' ? work : main,
        EXPECTED_TAG: channel === 'beta' ? 'v1.2.0-beta.1' : 'v1.2.0',
      },
    })
  return {
    folder,
    run,
    read: () => JSON.parse(readFileSync(stateFile)),
    update: (change) => {
      const value = JSON.parse(readFileSync(stateFile))
      change(value)
      writeFileSync(stateFile, JSON.stringify(value))
    },
  }
}
test('CLI integration: beta prepares and authorizes with no Environment API access', (t) => {
  const fixture = cliFixture(t)
  for (const mode of ['prepare', 'recheck', 'publish-check']) {
    const result = fixture.run(mode)
    assert.equal(result.status, 0, result.stderr)
  }
  assert.ok(
    !fixture.read().calls.some((call) => call.path.startsWith('/environments')),
  )
  const plan = JSON.parse(
    readFileSync(resolve(fixture.folder, 'release-plan.json')),
  )
  assert.equal(plan.environment, '')
  assert.equal(plan.approval_mode, 'dispatch')
  fixture.update((state) => {
    state.heads.work = main
  })
  assert.match(fixture.run('publish-check').stderr, /HEAD changed/)
})
test('CLI integration: production owner confirmation preserves the original reservation and denies other actors', (t) => {
  const fixture = cliFixture(t)
  assert.equal(fixture.run('prepare', 'production', 'owner').status, 0)
  const initial = fixture.run('publish-check', 'production', 'owner')
  assert.equal(initial.status, 1)
  assert.match(initial.stderr, /Owner confirmation required/)
  const writes = fixture
    .read()
    .calls.filter((call) => call.method === 'POST').length
  fixture.update((state) => {
    state.run.run_attempt = 2
  })
  const confirmed = fixture.run('publish-check', 'production', 'owner')
  assert.equal(confirmed.status, 0, confirmed.stderr)
  assert.equal(
    fixture.read().calls.filter((call) => call.method === 'POST').length,
    writes,
  )
  fixture.update((state) => {
    state.run.triggering_actor.id = 99
  })
  assert.equal(fixture.run('publish-check', 'production', 'owner').status, 1)
})
test('CLI integration: production permission failures never reserve a tag or select fallback', (t) => {
  const fixture = cliFixture(t, { listingError: 403 })
  const result = fixture.run('prepare', 'production', 'owner')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Cannot establish.*403/)
  assert.equal(
    fixture.read().calls.filter((call) => call.method === 'POST').length,
    0,
  )
})

test('owner retry that rebuilds an image is not post-scan confirmation', async () => {
  const fake = fakeGithub({ environment: null })
  const plan = await resolveAndReserve(
    { ...event, channel: 'production' },
    fake.github,
    runUrl,
    'owner',
  )
  fake.state.run.run_attempt = 2
  fake.state.jobs[0].run_attempt = 2
  await assert.rejects(
    authorizePublication(plan, fake.github, 'owner'),
    /earlier attempt/,
  )
  fake.state.run.run_attempt = 3
  await authorizePublication(plan, fake.github, 'owner')
})
test('owner confirmation rejects missing, failed or unrelated build/scans', async () => {
  for (const jobs of [
    [],
    [
      {
        name: 'Build and scan',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'failure',
        head_sha: 'c'.repeat(40),
      },
    ],
    [
      {
        name: 'Build and scan',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'success',
        head_sha: 'd'.repeat(40),
      },
    ],
  ]) {
    const fake = fakeGithub({ environment: null, jobs })
    const plan = await resolveAndReserve(
      { ...event, channel: 'production' },
      fake.github,
      runUrl,
      'owner',
    )
    fake.state.run.run_attempt = 2
    await assert.rejects(
      authorizePublication(plan, fake.github, 'owner'),
      /earlier attempt/,
    )
  }
})
