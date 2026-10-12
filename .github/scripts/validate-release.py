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
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        names = [member.name for member in members]
        assert len(set(names)) == len(names), 'Duplicate archive paths'
        for member in members:
            parts = PurePosixPath(member.name).parts
            assert parts and parts[0] == 'moms-bundle' and '..' not in parts, 'Unsafe archive path'
            assert member.isdir() or member.isfile(), 'Nonregular archive entry'
            if len(parts) > 1:
                assert parts[1] not in {'.git', '.beads', 'settings', 'backups', 'data', 'labels', 'recovery-snapshots'}, 'Private runtime directory'
            assert '.env' not in parts, 'Private environment file'
        manifest = json.load(bundle.extractfile('moms-bundle/desktop-manifest.json'))
        assert (manifest['format'], manifest['platform'], manifest['arch'], manifest['version'], manifest['nodeMajor'], manifest['postgresMajor']) == (1, platform, arch, version, 22, 16), 'Unexpected native target/version'
        paths = [record['path'] for record in manifest['files']]
        assert len(set(paths)) == len(paths), 'Duplicate manifest paths'
        assert {m.name for m in members if m.isfile()} == {'moms-bundle/' + p for p in paths} | {'moms-bundle/desktop-manifest.json'}, 'Manifest file inventory differs'
        suffix = '.exe' if platform == 'win32' else ''
        installer = 'Install-MOMS.cmd' if platform == 'win32' else 'Install-MOMS.command' if platform == 'darwin' else 'Install-MOMS.sh'
        required = {'LICENSE', 'NOTICE', 'runtime/NODE-LICENSE', 'runtime/POSTGRESQL-LICENSE', 'scripts/desktop.js', 'scripts/install-desktop.js', 'src/server.js', 'runtime/node' + suffix, 'runtime/postgresql/bin/postgres' + suffix, installer}
        assert required <= set(paths), 'Incomplete installer or licence notices'
        if platform != 'win32':
            assert bundle.getmember('moms-bundle/' + installer).mode & 0o111, 'Installer not executable'
        for record in manifest['files']:
            member = bundle.getmember('moms-bundle/' + record['path'])
            assert member.size == record['bytes'], 'File size mismatch'
            actual = digest(bundle.extractfile(member))
            assert actual == record['sha256'], 'Bundle integrity mismatch'
            if record['path'] in tracked:
                with (repo / record['path']).open('rb') as source:
                    assert actual == digest(source), 'Bundled source differs from release source'

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
