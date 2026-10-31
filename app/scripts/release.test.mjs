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
import { URLSearchParams } from 'node:url'
import { createHash } from 'node:crypto'
import {
  releaseInputs,
  nextVersion,
  resolveAndReserve,
  preflight,
  inspectImage,
  ReservationConflict,
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
    if (path.startsWith('/git/ref/heads/'))
      return {
        object: { type: 'commit', sha: state.heads[path.split('/').at(-1)] },
      }
    if (path.startsWith('/commits/')) return { sha: path.split('/').at(-1) }
    if (path.startsWith('/environments/')) return state.environment
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
      resolveAndReserve(event, fake.github, runUrl),
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
