import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('gates', Path(__file__).with_name('validate-release-gates.py'))
gates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gates)
SHA = 'a' * 40
REPO = 'example/moms'


def run(workflow):
    return dict(status='completed', conclusion='success', path='.github/workflows/' + workflow,
                head_sha=SHA, head_branch='main', event='workflow_dispatch',
                repository={'full_name': REPO}, head_repository={'full_name': REPO})


class ReleaseGates(unittest.TestCase):
    def test_success(self):
        gates.validate(run('desktop.yml'), run('verify.yml'), SHA, 'v0.1.1', REPO, '0.1.1')

    def test_failed_pending_wrong_source_and_untrusted_runs(self):
        for which in range(2):
            for key, value in [('status', 'in_progress'), ('conclusion', 'failure'), ('conclusion', 'cancelled'),
                               ('head_sha', 'b' * 40), ('head_branch', 'feature'), ('event', 'pull_request'),
                               ('path', '.github/workflows/other.yml'), ('repository', {'full_name': 'other/repo'}),
                               ('head_repository', {'full_name': 'fork/moms'})]:
                with self.subTest(which=which, key=key, value=value):
                    runs = [run('desktop.yml'), run('verify.yml')]
                    runs[which][key] = value
                    with self.assertRaises(AssertionError):
                        gates.validate(*runs, SHA, 'v0.1.1', REPO, '0.1.1')

    def test_invalid_version(self):
        for tag in ['v0.1.0', 'latest', 'v0.1.1;echo bad']:
            with self.assertRaises(AssertionError):
                gates.validate(run('desktop.yml'), run('verify.yml'), SHA, tag, REPO, '0.1.1')


if __name__ == '__main__':
    unittest.main()
