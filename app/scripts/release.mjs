import process from 'node:process'
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath, URL } from 'node:url'
import { execFileSync } from 'node:child_process'

const basePattern = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)'
const baseVersion = new RegExp(`^${basePattern}$`)
const shaPattern = /^[a-f0-9]{40}$/
export class ReservationConflict extends Error {}

function assertSha(sha) {
  if (typeof sha !== 'string' || sha.length !== 40 || !shaPattern.test(sha))
    throw new Error('Invalid resolved commit SHA')
}
export function releaseInputs(event) {
  if (event.name !== 'workflow_dispatch')
    throw new Error('Only manual release requests are accepted')
  if (!['beta', 'production'].includes(event.channel))
    throw new Error('Invalid release channel')
  if (
    typeof event.version !== 'string' ||
    event.version.trim() !== event.version ||
    event.version.length > 128 ||
    !baseVersion.test(event.version)
  ) {
    throw new Error(
      'Enter a base semantic version such as 1.2.0, without v or a beta suffix',
    )
  }
  return {
    channel: event.channel,
    base_version: event.version,
    branch: event.channel === 'beta' ? 'work' : 'main',
    environment: event.channel === 'beta' ? 'beta' : 'production',
    image_channel: event.channel === 'beta' ? 'beta' : 'latest',
  }
}
export function nextVersion(base, channel, tags) {
  releaseInputs({ name: 'workflow_dispatch', channel, version: base })
  const python =
    process.env.RELEASE_PYTHON ||
    (process.platform === 'win32' ? 'python' : 'python3')
  const result = execFileSync(
    python,
    [
      fileURLToPath(new URL('./release.py', import.meta.url)),
      '--resolve-version',
    ],
    {
      input: JSON.stringify({
        base_version: base,
        channel,
        // GitHub lists Git tags; local manifests are handled by the same Python engine.
        tags: tags.filter(
          (tag) => typeof tag === 'string' && tag.startsWith('v'),
        ),
      }),
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  return JSON.parse(result).version
}
export function validatePlan(plan) {
  const expected = releaseInputs({
    name: 'workflow_dispatch',
    channel: plan.channel,
    version: plan.base_version,
  })
  for (const [key, value] of Object.entries(expected))
    if (plan[key] !== value)
      throw new Error('Release plan does not match channel policy')
  assertSha(plan.source_sha)
  assertSha(plan.reservation_sha)
  const pattern = new RegExp(
    `^${plan.base_version.replaceAll('.', '\\.')}\\-beta\\.[1-9][0-9]*$`,
  )
  if (
    typeof plan.version !== 'string' ||
    plan.version.length > 128 ||
    plan.version.trim() !== plan.version ||
    (plan.channel === 'beta'
      ? !pattern.test(plan.version)
      : plan.version !== plan.base_version) ||
    plan.tag !== `v${plan.version}`
  )
    throw new Error('Invalid reserved version')
}
async function requireApproval(plan, github) {
  const environment = await github(`/environments/${plan.environment}`)
  const reviewers = environment.protection_rules?.find(
    (rule) => rule.type === 'required_reviewers',
  )
  if (
    !reviewers?.reviewers?.length ||
    reviewers.prevent_self_review !== true ||
    environment.can_admins_bypass !== false
  )
    throw new Error(
      'Environment must require human reviewers, prevent self-review and disallow admin bypass',
    )
}
async function branchHead(branch, github) {
  const ref = await github(`/git/ref/heads/${branch}`)
  if (ref.object?.type !== 'commit')
    throw new Error('Source branch must resolve to a commit')
  assertSha(ref.object.sha)
  return ref.object.sha
}
async function requireUnchangedSource(plan, github) {
  const current = await branchHead(plan.branch, github)
  if (current !== plan.source_sha)
    throw new Error(
      `${plan.branch} HEAD changed: reserved ${plan.source_sha}, now ${current}. Start a new release; the reserved tag is retained.`,
    )
}
async function allTags(github) {
  const tags = []
  for (let page = 1; page <= 1000; page++) {
    const batch = await github(`/tags?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('Invalid tag listing')
    tags.push(...batch.map((tag) => tag.name))
    if (batch.length < 100) return tags
  }
  throw new Error(
    'Tag pagination limit exceeded; refusing an incomplete version calculation',
  )
}
export async function resolveAndReserve(event, github, runUrl) {
  const policy = releaseInputs(event)
  const source = await branchHead(policy.branch, github)
  const commit = await github(`/commits/${source}`)
  if (commit.sha !== source)
    throw new Error('Source commit could not be resolved exactly')
  await requireApproval(policy, github)
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = nextVersion(
      policy.base_version,
      policy.channel,
      policy.channel === 'beta' ? await allTags(github) : [],
    )
    const plan = {
      ...policy,
      version,
      tag: `v${version}`,
      source_sha: source,
      run_url: runUrl,
    }
    if (await github(`/git/ref/tags/${plan.tag}`, { allowMissing: true })) {
      if (policy.channel === 'beta') continue
      throw new Error('Stable version tag already exists')
    }
    if (await github(`/releases/tags/${plan.tag}`, { allowMissing: true }))
      throw new Error('Versioned GitHub Release already exists')
    await requireUnchangedSource(plan, github)
    const tag = await github('/git/tags', {
      method: 'POST',
      body: {
        tag: plan.tag,
        message: JSON.stringify(plan, null, 2),
        object: source,
        type: 'commit',
      },
    })
    assertSha(tag.sha)
    try {
      await github('/git/refs', {
        method: 'POST',
        body: { ref: `refs/tags/${plan.tag}`, sha: tag.sha },
      })
      return { ...plan, reservation_sha: tag.sha }
    } catch (error) {
      if (!(error instanceof ReservationConflict) || policy.channel !== 'beta')
        throw error
    }
  }
  throw new Error(
    'Version reservation conflicted repeatedly; no existing tag was overwritten',
  )
}
export async function preflight(plan, github) {
  validatePlan(plan)
  await requireUnchangedSource(plan, github)
  const ref = await github(`/git/ref/tags/${plan.tag}`)
  if (ref.object?.type !== 'tag' || ref.object.sha !== plan.reservation_sha)
    throw new Error('Reserved tag changed or disappeared')
  const tag = await github(`/git/tags/${plan.reservation_sha}`)
  if (
    tag.object?.type !== 'commit' ||
    tag.object.sha !== plan.source_sha ||
    tag.tag !== plan.tag
  )
    throw new Error('Reserved tag does not identify the pinned source')
  if (await github(`/releases/tags/${plan.tag}`, { allowMissing: true }))
    throw new Error('Versioned GitHub Release already exists')
  await requireApproval(plan, github)
}

// Inspect the built OCI graph and give Trivy a single-platform layout for each scan.
// No image is uploaded before approval, and the original multi-platform archive is preserved.
export function inspectImage(layout, scanRoot, plan) {
  validatePlan(plan)
  const blob = (digest) => {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new Error('Invalid OCI digest')
    const bytes = readFileSync(resolve(layout, 'blobs/sha256', digest.slice(7)))
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== digest)
      throw new Error('OCI blob digest mismatch')
    return JSON.parse(bytes)
  }
  const index = JSON.parse(readFileSync(resolve(layout, 'index.json')))
  if (index.manifests?.length !== 1)
    throw new Error('Expected one named multi-platform OCI index')
  const root = index.manifests[0]
  const manifest = blob(root.digest)
  if (!manifest.manifests || !root.mediaType.endsWith('image.index.v1+json'))
    throw new Error('Expected a multi-platform OCI image index')
  const platforms = new Map()
  for (const descriptor of manifest.manifests) {
    if (
      descriptor.annotations?.['vnd.docker.reference.type'] ===
      'attestation-manifest'
    )
      continue
    const image = blob(descriptor.digest)
    const config = blob(image.config.digest)
    const arch = config.architecture
    if (
      config.os !== 'linux' ||
      !['amd64', 'arm64'].includes(arch) ||
      platforms.has(arch)
    )
      throw new Error('Unexpected or duplicate image platform')
    if (
      descriptor.platform?.os !== 'linux' ||
      descriptor.platform.architecture !== arch
    )
      throw new Error('OCI platform does not match its image config')
    const labels = config.config?.Labels
    if (
      labels?.['org.opencontainers.image.revision'] !== plan.source_sha ||
      labels?.['org.opencontainers.image.version'] !== plan.version
    )
      throw new Error(
        'Image source/version metadata does not match the reserved release',
      )
    platforms.set(arch, descriptor)
  }
  if (platforms.size !== 2)
    throw new Error('Both amd64 and arm64 images are required')
  for (const [arch, descriptor] of platforms) {
    const target = resolve(scanRoot, arch)
    mkdirSync(target, { recursive: true })
    writeFileSync(
      resolve(target, 'oci-layout'),
      '{"imageLayoutVersion":"1.0.0"}\n',
    )
    writeFileSync(
      resolve(target, 'index.json'),
      JSON.stringify({ schemaVersion: 2, manifests: [descriptor] }),
    )
    symlinkSync(resolve(layout, 'blobs'), resolve(target, 'blobs'), 'dir')
  }
  return {
    source_sha: plan.source_sha,
    version: plan.version,
    tag: plan.tag,
    image_digest: root.digest,
  }
}
async function github(
  path,
  { method = 'GET', body, allowMissing = false } = {},
) {
  if (process.env.GITHUB_REPOSITORY?.toLowerCase() !== 'onlydrey/pdf-toolkit')
    throw new Error('Unexpected publication repository')
  if (!process.env.GH_TOKEN) throw new Error('GitHub token is required')
  const response = await globalThis.fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  )
  if (allowMissing && response.status === 404) return null
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    if (
      path === '/git/refs' &&
      method === 'POST' &&
      [409, 422].includes(response.status) &&
      /reference already exists/i.test(detail.message || '')
    )
      throw new ReservationConflict('Version reservation already exists')
    throw new Error(`GitHub ${method} ${path} failed (${response.status})`)
  }
  return response.json()
}
async function main() {
  const mode = process.argv[2]
  if (mode === 'prepare') {
    const plan = await resolveAndReserve(
      {
        name: process.env.RELEASE_EVENT,
        channel: process.env.RELEASE_CHANNEL,
        version: process.env.RELEASE_VERSION,
      },
      github,
      `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    )
    writeFileSync('release-plan.json', JSON.stringify(plan, null, 2))
    for (const [key, value] of Object.entries(plan))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Reserved ${plan.tag}\n\n- Source: ${plan.branch} at ${plan.source_sha}\n- Reservation: ${plan.reservation_sha}\n- Run: ${plan.run_url}\n\nThe tag remains reserved if validation or publication fails.\n`,
    )
    return
  }
  const plan = JSON.parse(readFileSync('release-plan.json'))
  validatePlan(plan)
  if (
    plan.source_sha !== process.env.EXPECTED_SOURCE_SHA ||
    plan.tag !== process.env.EXPECTED_TAG
  )
    throw new Error('Artifact plan does not match this run')
  if (mode === 'recheck') await preflight(plan, github)
  else if (['image', 'verify-image'].includes(mode)) {
    const metadata = inspectImage('image-layout', 'scans', plan)
    if (mode === 'verify-image') {
      const recorded = JSON.parse(readFileSync('image-metadata.json'))
      if (
        JSON.stringify(recorded) !== JSON.stringify(metadata) ||
        metadata.image_digest !== process.env.EXPECTED_DIGEST
      )
        throw new Error('Scanned image digest or release metadata changed')
    } else {
      writeFileSync('image-metadata.json', JSON.stringify(metadata, null, 2))
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `image_digest=${metadata.image_digest}\n`,
      )
    }
  } else throw new Error('Invalid release helper mode')
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
