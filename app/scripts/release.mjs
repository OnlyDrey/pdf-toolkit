import process from 'node:process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const stable = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)'
const stableVersion = new RegExp(`^${stable}$`)
const betaVersion = new RegExp(`^${stable}-beta\\.(0|[1-9][0-9]*)$`)
const fullSha = /^[a-f0-9]{40}$/

export function releasePlan(event) {
  const manual = event.name === 'workflow_dispatch'
  let channel, version, source
  if (manual) {
    if (event.confirm !== 'true')
      throw new Error('Explicit publication confirmation is required')
    channel = event.channel
    version = event.version
    source = event.source
    const branch = channel === 'beta' ? 'work' : 'main'
    if (event.ref !== `refs/heads/${branch}`)
      throw new Error(`Run this channel from ${branch}`)
  } else if (event.name === 'push' && event.ref?.startsWith('refs/tags/v')) {
    version = event.ref.slice('refs/tags/v'.length)
    channel = betaVersion.test(version) ? 'beta' : 'production'
    source = event.sha
  } else {
    throw new Error(
      'Only an intentional manual run or version-tag push can release',
    )
  }
  if (!['beta', 'production'].includes(channel))
    throw new Error('Invalid release channel')
  if (
    typeof version !== 'string' ||
    version.length > 128 ||
    version.trim() !== version ||
    !(channel === 'beta' ? betaVersion : stableVersion).test(version)
  )
    throw new Error('Version does not match the release channel')
  if (
    typeof source !== 'string' ||
    source.length !== 40 ||
    !fullSha.test(source)
  )
    throw new Error(
      'A full lowercase 40-character source commit SHA is required',
    )
  return {
    channel,
    version,
    source_sha: source,
    tag: `v${version}`,
    branch: channel === 'beta' ? 'work' : 'main',
    environment: channel === 'beta' ? 'beta' : 'production',
    image_channel: channel === 'beta' ? 'beta' : 'latest',
    manual,
  }
}

export async function preflight(plan, github) {
  const commit = await github(`/commits/${plan.source_sha}`)
  if (commit.sha !== plan.source_sha)
    throw new Error('Source commit could not be resolved exactly')
  const branch = await github(`/git/ref/heads/${plan.branch}`)
  const comparison = await github(
    `/compare/${plan.source_sha}...${branch.object.sha}`,
  )
  if (!['ahead', 'identical'].includes(comparison.status))
    throw new Error(`Source must be reachable from ${plan.branch}`)

  const tag = await github(`/git/ref/tags/${plan.tag}`, { allowMissing: true })
  if (plan.manual && tag)
    throw new Error('Version tag already exists; choose a new version')
  if (!plan.manual) {
    let object = tag?.object
    for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) {
      object = (await github(`/git/tags/${object.sha}`)).object
    }
    if (object?.type !== 'commit' || object.sha !== plan.source_sha)
      throw new Error('Tag no longer identifies the requested source commit')
  }
  if (await github(`/releases/tags/${plan.tag}`, { allowMissing: true }))
    throw new Error('GitHub Release already exists')
  const environment = await github(`/environments/${plan.environment}`)
  const reviewers = environment.protection_rules?.find(
    (rule) => rule.type === 'required_reviewers',
  )
  if (
    !reviewers?.reviewers?.length ||
    reviewers.prevent_self_review !== true ||
    environment.can_admins_bypass !== false
  ) {
    throw new Error(
      'Environment must require human reviewers, prevent self-review and disallow admin bypass',
    )
  }
}

function eventFromEnvironment() {
  return {
    name: process.env.RELEASE_EVENT,
    ref: process.env.RELEASE_REF,
    sha: process.env.RELEASE_EVENT_SHA,
    channel: process.env.RELEASE_CHANNEL,
    version: process.env.RELEASE_VERSION,
    source: process.env.RELEASE_SOURCE_SHA,
    confirm: process.env.RELEASE_CONFIRM,
  }
}

async function github(
  path,
  { method = 'GET', body, allowMissing = false } = {},
) {
  const repository = process.env.GITHUB_REPOSITORY
  if (repository?.toLowerCase() !== 'onlydrey/pdf-toolkit')
    throw new Error('Unexpected publication repository')
  if (!process.env.GH_TOKEN) throw new Error('GitHub token is required')
  const response = await globalThis.fetch(
    `https://api.github.com/repos/${repository}${path}`,
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
  if (!response.ok)
    throw new Error(`GitHub ${method} ${path} failed (${response.status})`)
  return response.json()
}

async function main() {
  const plan = releasePlan(eventFromEnvironment())
  const mode = process.argv[2]
  if (!['prepare', 'recheck', 'tag'].includes(mode))
    throw new Error('Invalid release helper mode')
  await preflight(plan, github)
  if (mode === 'tag' && plan.manual) {
    // Creating refs is atomic: an existing tag fails instead of being overwritten.
    await github('/git/refs', {
      method: 'POST',
      body: { ref: `refs/tags/${plan.tag}`, sha: plan.source_sha },
    })
  }
  if (mode === 'prepare') {
    for (const [key, value] of Object.entries(plan))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Release awaiting validation and approval\n\n- Channel: ${plan.channel}\n- Version: ${plan.tag}\n- Source: ${plan.source_sha}\n- Required source branch: ${plan.branch}\n- Approval environment: ${plan.environment}\n`,
    )
  }
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
