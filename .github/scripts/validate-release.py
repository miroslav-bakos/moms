"""Validate native artifacts without extracting or executing their contents."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile

TARGETS = {'linux-x64': ('linux', 'x64'), 'raspberry-pi-arm64': ('linux', 'arm64'), 'macos-apple-silicon': ('darwin', 'arm64'), 'macos-intel': ('darwin', 'x64'), 'windows-x64': ('win32', 'x64')}

def digest(stream):
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(chunk)
    return value.hexdigest()

def validate(archive, platform, arch, version, tracked, repo):
    checksum = archive.with_name(archive.name + '.sha256').read_text().split()
    with archive.open('rb') as stream:
        assert checksum == [digest(stream), archive.name], 'Archive checksum mismatch'
    members = {}
    manifest = None
    # Stream twice, never repeatedly seek backwards through compressed runtimes.
    with tarfile.open(archive, 'r|gz') as bundle:
        for member in bundle:
            assert member.name not in members, 'Duplicate archive paths'
            members[member.name] = member
            parts = PurePosixPath(member.name).parts
            assert parts and parts[0] == 'moms-bundle' and '..' not in parts, 'Unsafe archive path'
            assert member.isdir() or member.isfile(), 'Nonregular archive entry'
            if len(parts) > 1:
                assert parts[1] not in {'.git', '.beads', 'settings', 'backups', 'data', 'labels', 'recovery-snapshots'}, 'Private runtime directory'
            assert '.env' not in parts, 'Private environment file'
            if member.name == 'moms-bundle/desktop-manifest.json':
                manifest = json.load(bundle.extractfile(member))
    assert manifest is not None, 'Missing bundle manifest'
    assert (manifest['format'], manifest['platform'], manifest['arch'], manifest['version'], manifest['nodeMajor'], manifest['postgresMajor']) == (1, platform, arch, version, 22, 16), 'Unexpected native target/version'
    records = {record['path']: record for record in manifest['files']}
    assert len(records) == len(manifest['files']), 'Duplicate manifest paths'
    assert {name for name, m in members.items() if m.isfile()} == {'moms-bundle/' + p for p in records} | {'moms-bundle/desktop-manifest.json'}, 'Manifest file inventory differs'
    suffix = '.exe' if platform == 'win32' else ''
    installer = 'Install-MOMS.cmd' if platform == 'win32' else 'Install-MOMS.command' if platform == 'darwin' else 'Install-MOMS.sh'
    required = {'LICENSE', 'NOTICE', 'runtime/NODE-LICENSE', 'runtime/POSTGRESQL-LICENSE', 'scripts/desktop.js', 'scripts/install-desktop.js', 'src/server.js', 'runtime/node' + suffix, 'runtime/postgresql/bin/postgres' + suffix, installer}
    assert required <= set(records), 'Incomplete installer or licence notices'
    if platform != 'win32':
        assert members['moms-bundle/' + installer].mode & 0o111, 'Installer not executable'
    with tarfile.open(archive, 'r|gz') as bundle:
        for member in bundle:
            if not member.isfile() or member.name == 'moms-bundle/desktop-manifest.json':
                continue
            source_path = member.name[len('moms-bundle/'):]
            record = records[source_path]
            assert member.size == record['bytes'], 'File size mismatch'
            stream = bundle.extractfile(member)
            if source_path in tracked:
                data = stream.read()
                actual = hashlib.sha256(data).hexdigest()
                expected = (repo / source_path).read_bytes()
                if data != expected:
                    # Windows Git checkouts may use CRLF. Never normalize binaries.
                    assert b'\0' not in data and b'\0' not in expected, 'Bundled source differs from release source'
                    assert data.decode('utf-8').replace('\r\n', '\n') == expected.decode('utf-8').replace('\r\n', '\n'), 'Bundled source differs from release source'
            else:
                actual = digest(stream)
            assert actual == record['sha256'], 'Bundle integrity mismatch'

def main():
    root, tag = Path(sys.argv[1]), sys.argv[2]
    assert tag.startswith('v'), 'Expected version tag'
    repo = Path.cwd()
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0'))
    archives = list(root.glob('*/*.tar.gz'))
    assert {a.name for a in archives} == {'moms-' + target + '.tar.gz' for target in TARGETS}, 'Expected all five native artifacts'
    assert len(archives) == len(TARGETS), 'Duplicate native artifacts'
    for target, (platform, arch) in TARGETS.items():
        archive = next(a for a in archives if a.name == 'moms-' + target + '.tar.gz')
        validate(archive, platform, arch, tag[1:], tracked, repo)
        print('Validated ' + archive.name)

if __name__ == '__main__':
    main()
