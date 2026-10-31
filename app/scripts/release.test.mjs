import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releasePlan, preflight } from './release.mjs'

const sha = 'a'.repeat(40)
const head = 'b'.repeat(40)
const manual = {
  name: 'workflow_dispatch',
  ref: 'refs/heads/work',
  channel: 'beta',
  version: '1.2.0-beta.1',
  source: sha,
  confirm: 'true',
}
const production = {
  ...manual,
  ref: 'refs/heads/main',
  channel: 'production',
  version: '1.2.0',
}
function fixture(plan, overrides = {}) {
  const routes = {
    [`/commits/${sha}`]: { sha },
    [`/git/ref/heads/${plan.branch}`]: { object: { sha: head } },
    [`/compare/${sha}...${head}`]: { status: 'ahead' },
    [`/git/ref/tags/${plan.tag}`]: plan.manual
      ? null
      : { object: { type: 'commit', sha } },
    [`/releases/tags/${plan.tag}`]: null,
    [`/environments/${plan.environment}`]: {
      can_admins_bypass: false,
      protection_rules: [
        {
          type: 'required_reviewers',
          prevent_self_review: true,
          reviewers: [{ type: 'User', reviewer: { id: 1 } }],
        },
      ],
    },
    ...overrides,
  }
  return async (path) => {
    assert.ok(Object.hasOwn(routes, path), `Unexpected API request: ${path}`)
    return routes[path]
  }
}

test('manual beta is pinned to work and can only update beta', () => {
  const plan = releasePlan(manual)
  assert.equal(plan.image_channel, 'beta')
  assert.equal(plan.branch, 'work')
  assert.equal(plan.source_sha, sha)
  assert.equal(plan.tag, 'v1.2.0-beta.1')
})
test('manual production is pinned to main and stable versions', () => {
  const plan = releasePlan(production)
  assert.equal(plan.image_channel, 'latest')
  assert.equal(plan.environment, 'production')
})
for (const [name, changes] of [
  ['missing explicit confirmation', { confirm: 'false' }],
  ['beta from main', { ref: 'refs/heads/main' }],
  ['beta with stable version', { version: '1.2.0' }],
  ['unknown channel', { channel: 'latest' }],
  ['leading v', { version: 'v1.2.0-beta.1' }],
  ['leading zero', { version: '01.2.0-beta.1' }],
  ['build metadata', { version: '1.2.0-beta.1+build' }],
  ['arbitrary source ref', { source: 'main' }],
  ['short source SHA', { source: 'abc123' }],
  ['injected version', { version: '1.2.0-beta.1\nlatest' }],
  ['ordinary development push', { name: 'push' }],
])
  test(`rejects ${name}`, () =>
    assert.throws(() => releasePlan({ ...manual, ...changes })))

test('production cannot use the work workflow or a beta version', () => {
  assert.throws(() => releasePlan({ ...production, ref: 'refs/heads/work' }))
  assert.throws(() => releasePlan({ ...production, version: '1.2.0-beta.1' }))
})
test('intentional stable and beta tags retain semantic channel selection', () => {
  for (const [version, expected] of [
    ['1.2.0', 'latest'],
    ['1.2.0-beta.1', 'beta'],
  ]) {
    const plan = releasePlan({
      name: 'push',
      ref: `refs/tags/v${version}`,
      sha,
    })
    assert.equal(plan.image_channel, expected)
    assert.equal(plan.manual, false)
  }
})
test('source membership, unused version and non-bypassable human review permit preflight', async () => {
  for (const event of [manual, production]) {
    const plan = releasePlan(event)
    await preflight(plan, fixture(plan))
  }
})
test('production rejects a commit outside main even when it exists', async () => {
  const plan = releasePlan(production)
  await assert.rejects(
    preflight(
      plan,
      fixture(plan, { [`/compare/${sha}...${head}`]: { status: 'diverged' } }),
    ),
    /reachable from main/,
  )
})
test('manual version tags and GitHub Releases cannot be overwritten', async () => {
  const plan = releasePlan(manual)
  await assert.rejects(
    preflight(
      plan,
      fixture(plan, { [`/git/ref/tags/${plan.tag}`]: { object: { sha } } }),
    ),
    /already exists/,
  )
  await assert.rejects(
    preflight(
      plan,
      fixture(plan, { [`/releases/tags/${plan.tag}`]: { id: 1 } }),
    ),
    /already exists/,
  )
})
for (const environment of [
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
  {
    can_admins_bypass: false,
    protection_rules: [
      { type: 'required_reviewers', prevent_self_review: true, reviewers: [] },
    ],
  },
])
  test('missing or bypassable approval configuration fails closed', async () => {
    const plan = releasePlan(manual)
    await assert.rejects(
      preflight(
        plan,
        fixture(plan, { [`/environments/${plan.environment}`]: environment }),
      ),
      /human reviewers/,
    )
  })
test('annotated version tags are resolved and must still target the validated SHA', async () => {
  const plan = releasePlan({ name: 'push', ref: 'refs/tags/v1.2.0', sha })
  const routes = {
    [`/git/ref/tags/${plan.tag}`]: { object: { type: 'tag', sha: head } },
    [`/git/tags/${head}`]: { object: { type: 'commit', sha } },
  }
  await preflight(plan, fixture(plan, routes))
  routes[`/git/tags/${head}`] = { object: { type: 'commit', sha: head } }
  await assert.rejects(preflight(plan, fixture(plan, routes)), /Tag no longer/)
})
test('an unavailable API cannot establish approval or source validation', async () => {
  const plan = releasePlan(production)
  await assert.rejects(
    preflight(plan, async () => {
      throw new Error('HTTP 403')
    }),
    /403/,
  )
})

test('registry tag length and unsupported prerelease tags are rejected', () => {
  assert.throws(() =>
    releasePlan({ ...manual, version: `${'1'.repeat(130)}.2.0-beta.1` }),
  )
  assert.throws(() =>
    releasePlan({ name: 'push', ref: 'refs/tags/v1.2.0-rc.1', sha }),
  )
})
test('exact branch head is valid, but a mismatched resolved commit fails', async () => {
  const plan = releasePlan(production)
  await preflight(
    plan,
    fixture(plan, { [`/compare/${sha}...${head}`]: { status: 'identical' } }),
  )
  await assert.rejects(
    preflight(plan, fixture(plan, { [`/commits/${sha}`]: { sha: head } })),
    /resolved exactly/,
  )
})

test('trailing line terminators cannot pass end-anchored version or SHA checks', () => {
  for (const newline of ['\n', '\r', '\r\n']) {
    assert.throws(() =>
      releasePlan({ ...manual, version: manual.version + newline }),
    )
    assert.throws(() => releasePlan({ ...manual, source: sha + newline }))
  }
})
