"""Require successful native and general CI runs for the exact release commit."""
import json
import re
import subprocess
import sys


def validate_run(run, workflow, sha, repository):
    assert run['status'] == 'completed' and run['conclusion'] == 'success', 'Run must have passed'
    assert run['path'] == '.github/workflows/' + workflow, 'Unexpected workflow'
    assert run['head_sha'] == sha and run['head_branch'] == 'main', 'Run must test the exact main commit'
    assert run['event'] in {'push', 'workflow_dispatch'}, 'Pull request runs cannot authorize releases'
    assert run['repository']['full_name'] == repository, 'Unexpected repository'
    assert run['head_repository']['full_name'] == repository, 'Fork builds cannot authorize releases'


def validate(build, checks, sha, tag, repository, version):
    assert re.fullmatch(r'[a-f0-9]{40}', sha), 'Expected full commit SHA'
    assert re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag), 'Expected version tag'
    assert tag == 'v' + version, 'Tag must match package version'
    validate_run(build, 'desktop.yml', sha, repository)
    validate_run(checks, 'verify.yml', sha, repository)


if __name__ == '__main__':
    build_path, checks_path, sha, tag, repository = sys.argv[1:]
    assert re.fullmatch(r'[a-f0-9]{40}', sha), 'Expected full commit SHA'
    subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'origin/main'], check=True)
    version = json.loads(subprocess.check_output(['git', 'show', sha + ':package.json'], text=True))['version']
    validate(json.load(open(build_path)), json.load(open(checks_path)), sha, tag, repository, version)
    assert subprocess.run(['git', 'show-ref', '--verify', '--quiet', 'refs/tags/' + tag]).returncode == 1, 'Release tag already exists'
    print('Exact release commit, version, main ancestry and both CI gates verified.')
