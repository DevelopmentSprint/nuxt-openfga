import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const name = '@developmentsprint/nuxt-openfga'
const repository = 'git+https://github.com/DevelopmentSprint/nuxt-openfga.git'

export function verifyIdentity(pkg, tag) {
  assert.equal(pkg.name, name, 'Unexpected package identity')
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable versions are supported')
  assert.ok(tag === `v${pkg.version}` || tag === `${name}@${pkg.version}`, 'Release tag must match package version')
  assert.equal(pkg.private, false, 'Package must be public')
  assert.equal(pkg.repository?.url, repository, 'Unexpected source repository')
  assert.equal(pkg.publishConfig?.access, 'public', 'Package access must be public')
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/', 'Unexpected publish registry')
}

export function verifyFiles(files) {
  const required = new Set(['package.json', 'README.md', 'LICENSE', 'dist/module.mjs', 'dist/module.d.ts', 'dist/types.mjs', 'dist/types.d.ts'])
  const seen = new Set()
  const privateNames = new Set(['.beads', '.beadroad', '.dolt', 'dolt', 'doltdb', 'embeddeddolt', 'proxieddb', '.cass', '.npmrc', '.beads-credential-key', '.beads.gate.lock'])
  for (const file of files) {
    assert.ok(typeof file === 'string' && file.length > 0 && !file.includes('\\'), 'Invalid package path')
    const parts = file.split('/')
    assert.ok(parts.every(part => part && part !== '.' && part !== '..' && !privateNames.has(part) && !part.startsWith('.env')), 'Private or unsafe package path')
    assert.ok(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'].includes(file) ||
      (file.startsWith('dist/') && /\.(?:mjs|cjs|js|mts|cts|ts|vue|json|map)$/.test(file)), 'Unexpected package content')
    assert.ok(!seen.has(file), 'Duplicate package path')
    seen.add(file)
    required.delete(file)
  }
  assert.equal(required.size, 0, 'Required public package files are missing')
}

export function verifySource(tag, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'))
  verifyIdentity(pkg, tag)
  assert.equal(git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`), git('rev-parse', 'HEAD'), 'Release tag moved or checkout does not match')
  git('merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main')
}

export function verifyArchive(tag, cwd = process.cwd()) {
  const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'))
  verifyIdentity(pkg, tag)
  const manifests = JSON.parse(readFileSync(path.join(cwd, 'release/manifest.json'), 'utf8'))
  assert.equal(manifests.length, 1, 'Expected exactly one package archive')
  const manifest = manifests[0]
  assert.equal(manifest.name, pkg.name)
  assert.equal(manifest.version, pkg.version)
  assert.match(manifest.filename, /^[a-zA-Z0-9._-]+\.tgz$/, 'Invalid archive filename')
  verifyFiles(manifest.files.map(file => file.path))
  const archive = path.join(cwd, 'release', manifest.filename)
  const tar = (...args) => execFileSync('tar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const entries = tar('-tzf', archive).trim().split('\n')
  assert.ok(entries.every(entry => entry.startsWith('package/')), 'Unexpected archive root')
  const paths = entries.map(entry => entry.slice('package/'.length))
  verifyFiles(paths)
  assert.deepEqual([...paths].sort(), manifest.files.map(file => file.path).sort(), 'Archive differs from manifest')
  assert.ok(tar('-tvzf', archive).trim().split('\n').every(line => line.startsWith('-')), 'Only regular files are allowed in the archive')
  const packed = JSON.parse(tar('-xOf', archive, 'package/package.json'))
  verifyIdentity(packed, tag)
  assert.equal(packed.version, pkg.version)
  renameSync(archive, path.join(cwd, 'release/package.tgz'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'source') verifySource(process.env.RELEASE_TAG)
  else if (process.argv[2] === 'archive') verifyArchive(process.env.RELEASE_TAG)
  else throw new Error('Expected source or archive verification mode')
}
