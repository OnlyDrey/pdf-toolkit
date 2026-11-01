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
export class GitHubApiError extends Error {
  constructor(method, path, status) {
    const advice =
      status === 401
        ? 'Check that GITHUB_TOKEN is present and valid.'
        : status === 403
          ? 'Check Actions/repository permissions, organization policy and API rate limits.'
          : status === 404
            ? 'GitHub may hide inaccessible resources as 404; verify repository access and Settings > Environments.'
            : 'Check GitHub service availability before retrying the failed run.'
    super(`GitHub ${method} ${path} failed (${status}). ${advice}`)
    this.status = status
    this.path = path
  }
}

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
    environment: event.channel === 'beta' ? '' : 'production',
    image_channel: event.channel === 'beta' ? 'latest-beta' : 'latest',
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
    if (key !== 'environment' && plan[key] !== value)
      throw new Error('Release plan does not match channel policy')
  if (
    plan.channel === 'beta'
      ? plan.approval_mode !== 'dispatch' ||
        plan.environment !== '' ||
        plan.approval_owner_id !== ''
      : !['environment', 'owner'].includes(plan.approval_mode) ||
        (plan.approval_mode === 'environment'
          ? plan.environment !== 'production' || plan.approval_owner_id !== ''
          : !['', 'production'].includes(plan.environment) ||
            !Number.isSafeInteger(plan.approval_owner_id) ||
            plan.approval_owner_id <= 0)
  )
    throw new Error('Invalid channel approval policy')
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
async function productionEnvironment(github) {
  const environment = await github('/environments/production', {
    allowMissing: true,
  })
  if (environment) return environment
  // A resource 404 alone cannot prove absence: GitHub also hides inaccessible resources.
  for (let page = 1; page <= 100; page++) {
    let listing
    try {
      listing = await github(`/environments?per_page=100&page=${page}`)
    } catch (error) {
      throw new Error(
        `Cannot establish whether production protection exists. ${error.message} Grant Environment read access/check plan support; never select owner mode to bypass unreadable protection.`,
        { cause: error },
      )
    }
    if (!Array.isArray(listing.environments))
      throw new Error(
        'Invalid Environment listing; protection cannot be verified',
      )
    if (listing.environments.some((item) => item.name === 'production'))
      throw new Error(
        'Production Environment is listed but its protection is inaccessible. Fix Environment read permissions; no approval fallback is allowed.',
      )
    if (listing.environments.length < 100) return null
  }
  throw new Error(
    'Environment pagination limit exceeded; protection cannot be verified',
  )
}
export function movingTags(plan) {
  validatePlan(plan)
  return plan.channel === 'beta' ? ['latest-beta', 'beta'] : ['latest']
}

export async function approvalPolicy(channel, github, mode = 'environment') {
  if (channel === 'beta')
    return { approval_mode: 'dispatch', environment: '', approval_owner_id: '' }
  if (!['environment', 'owner'].includes(mode))
    throw new Error(
      'Set PRODUCTION_APPROVAL_MODE to environment (default) or owner explicitly',
    )
  const environment = await productionEnvironment(github)
  if (environment && !Array.isArray(environment.protection_rules))
    throw new Error(
      'Unreadable production protection rules; no approval fallback is allowed',
    )
  const reviewers = environment?.protection_rules.find(
    (rule) => rule.type === 'required_reviewers',
  )
  if (reviewers) {
    if (
      !reviewers.reviewers?.length ||
      reviewers.prevent_self_review !== true ||
      environment.can_admins_bypass !== false
    )
      throw new Error(
        'Production Environment must require human reviewers, prevent self-review and disallow admin bypass; fix configured protection rather than falling back',
      )
    // Configured reviewer protection always wins over the owner-mode preference.
    return {
      approval_mode: 'environment',
      environment: 'production',
      approval_owner_id: '',
    }
  }
  if (mode !== 'owner')
    throw new Error(
      'Production requires human reviewers. Configure the production Environment (prevent self-review/admin bypass), or explicitly set repository variable PRODUCTION_APPROVAL_MODE=owner when reviewers are unavailable. Beta needs no Environment.',
    )
  const repository = await github('/')
  if (
    repository.owner?.type !== 'User' ||
    !Number.isSafeInteger(repository.owner.id) ||
    repository.owner.id <= 0
  )
    throw new Error(
      'Owner approval requires a personally owned repository; organizations must use protected Environment approval',
    )
  return {
    approval_mode: 'owner',
    environment: environment ? 'production' : '',
    approval_owner_id: repository.owner.id,
  }
}
async function verifyOwner(plan, github, confirmation = false) {
  const match =
    /^https:\/\/github\.com\/OnlyDrey\/pdf-toolkit\/actions\/runs\/([1-9][0-9]*)$/.exec(
      plan.run_url,
    )
  if (!match) throw new Error('Invalid owner approval workflow-run URL')
  const run = await github(`/actions/runs/${match[1]}`)
  if (
    run.event !== 'workflow_dispatch' ||
    run.html_url !== plan.run_url ||
    run.actor?.id !== plan.approval_owner_id
  )
    throw new Error(
      'Owner mode requires the repository owner to initiate this exact manual production run',
    )
  if (
    confirmation &&
    (run.triggering_actor?.id !== plan.approval_owner_id ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 2)
  )
    throw new Error(
      `Owner confirmation required for ${plan.tag} at ${plan.source_sha}. Review successful CI, both scans and the recorded digest, then the repository owner must choose Re-run failed jobs on this same run. Do not rerun all jobs or dispatch the reserved version again.`,
    )
  if (confirmation) {
    const builds = []
    for (let page = 1; page <= 100; page++) {
      const listing = await github(
        `/actions/runs/${match[1]}/jobs?filter=all&per_page=100&page=${page}`,
      )
      if (!Array.isArray(listing.jobs))
        throw new Error(
          'Cannot verify successful build/scans before owner confirmation',
        )
      builds.push(
        ...listing.jobs.filter((job) => job.name === 'Build and scan'),
      )
      if (listing.jobs.length < 100) break
      if (page === 100)
        throw new Error('Job pagination limit prevents owner confirmation')
    }
    builds.sort((left, right) => right.run_attempt - left.run_attempt)
    const build = builds[0]
    if (
      !build ||
      !Number.isSafeInteger(build.run_attempt) ||
      build.run_attempt >= run.run_attempt ||
      build.status !== 'completed' ||
      build.conclusion !== 'success' ||
      !run.head_sha ||
      build.head_sha !== run.head_sha
    )
      throw new Error(
        'Owner confirmation must occur after successful build/scans in an earlier attempt of this same workflow run. Review the finished artifacts, then choose Re-run failed jobs; a retry that rebuilds artifacts is not confirmation.',
      )
  }
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
export async function resolveAndReserve(
  event,
  github,
  runUrl,
  approvalMode = 'environment',
) {
  const policy = releaseInputs(event)
  const source = await branchHead(policy.branch, github)
  const commit = await github(`/commits/${source}`)
  if (commit.sha !== source)
    throw new Error('Source commit could not be resolved exactly')
  Object.assign(
    policy,
    await approvalPolicy(policy.channel, github, approvalMode),
  )
  if (policy.approval_mode === 'owner')
    await verifyOwner({ ...policy, run_url: runUrl }, github)
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
export async function preflight(plan, github, approvalMode = 'environment') {
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
  let record
  try {
    record = JSON.parse(tag.message)
  } catch {
    throw new Error(
      'Reserved tag has no readable release plan; start a new release',
    )
  }
  const { reservation_sha: reservation, ...expected } = plan
  if (
    !reservation ||
    !record ||
    Object.keys(record).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => record[key] !== value)
  )
    throw new Error('Release plan differs from its immutable tag reservation')
  const approval = await approvalPolicy(plan.channel, github, approvalMode)
  if (Object.entries(approval).some(([key, value]) => plan[key] !== value))
    throw new Error(
      'Approval policy changed after reservation; start a new release without weakening configured protection',
    )
  if (plan.approval_mode === 'owner') await verifyOwner(plan, github)
}

export async function authorizePublication(
  plan,
  github,
  approvalMode = 'environment',
) {
  await preflight(plan, github, approvalMode)
  if (plan.approval_mode === 'owner') await verifyOwner(plan, github, true)
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
export async function github(
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
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    if (
      allowMissing &&
      response.status === 404 &&
      !/not accessible|credentials|authentication|permission/i.test(
        detail.message || '',
      )
    )
      return null
    if (
      path === '/git/refs' &&
      method === 'POST' &&
      [409, 422].includes(response.status) &&
      /reference already exists/i.test(detail.message || '')
    )
      throw new ReservationConflict('Version reservation already exists')
    throw new GitHubApiError(method, path, response.status)
  }
  return response.json()
}
async function main() {
  const mode = process.argv[2]
  const approvalMode = process.env.PRODUCTION_APPROVAL_MODE || 'environment'
  if (mode === 'prepare') {
    const plan = await resolveAndReserve(
      {
        name: process.env.RELEASE_EVENT,
        channel: process.env.RELEASE_CHANNEL,
        version: process.env.RELEASE_VERSION,
      },
      github,
      `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      approvalMode,
    )
    writeFileSync('release-plan.json', JSON.stringify(plan, null, 2))
    for (const [key, value] of Object.entries(plan))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Reserved ${plan.tag}\n\n- Source: ${plan.branch} at ${plan.source_sha}\n- Approval: ${plan.approval_mode}\n- Environment: ${plan.environment || 'none'}\n- Reservation: ${plan.reservation_sha}\n- Run: ${plan.run_url}\n\nThe tag remains reserved if validation or publication fails.\n`,
    )
    return
  }
  const plan = JSON.parse(readFileSync('release-plan.json'))
  validatePlan(plan)
  if (
    plan.source_sha !== process.env.EXPECTED_SOURCE_SHA ||
    plan.tag !== process.env.EXPECTED_TAG ||
    plan.run_url !==
      `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  )
    throw new Error('Artifact plan does not match this run')
  if (mode === 'tags') process.stdout.write(movingTags(plan).join('\n') + '\n')
  else if (mode === 'recheck') await preflight(plan, github, approvalMode)
  else if (mode === 'publish-check')
    await authorizePublication(plan, github, approvalMode)
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
