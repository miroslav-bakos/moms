import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('validation', Path(__file__).with_name('validate-release.py'))
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)

class ReleaseValidation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / 'moms-linux-x64.tar.gz'
        (self.root / 'src').mkdir()
        (self.root / 'src/server.js').write_bytes(b'fixture')

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, extra=None, corrupt=False, executable=True):
        files = {p: b'fixture' for p in ['LICENSE', 'NOTICE', 'runtime/NODE-LICENSE', 'runtime/POSTGRESQL-LICENSE', 'scripts/desktop.js', 'scripts/install-desktop.js', 'src/server.js', 'runtime/node', 'runtime/postgresql/bin/postgres', 'Install-MOMS.sh']}
        manifest = {'format': 1, 'platform': 'linux', 'arch': 'x64', 'version': '0.1.0', 'nodeMajor': 22, 'postgresMajor': 16, 'files': [{'path': p, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for p, data in files.items()]}
        if corrupt:
            files['src/server.js'] = b'changed'
        files['desktop-manifest.json'] = json.dumps(manifest).encode()
        if extra:
            files[extra] = b'not for publication'
        with tarfile.open(self.archive, 'w:gz') as archive:
            for p, data in files.items():
                member = tarfile.TarInfo('moms-bundle/' + p)
                member.size = len(data)
                member.mode = 0o755 if executable and p == 'Install-MOMS.sh' else 0o644
                archive.addfile(member, io.BytesIO(data))
        self.archive.with_name(self.archive.name + '.sha256').write_text(hashlib.sha256(self.archive.read_bytes()).hexdigest() + '  ' + self.archive.name + '\n')

    def validate(self, version='0.1.0'):
        validation.validate(self.archive, 'linux', 'x64', version, {'src/server.js'}, self.root)

    def test_valid_bundle(self):
        self.fixture(); self.validate()

    def test_private_environment_rejected(self):
        self.fixture(extra='.env')
        with self.assertRaisesRegex(AssertionError, 'Private environment'): self.validate()

    def test_private_data_rejected(self):
        self.fixture(extra='backups/example.moms.gz')
        with self.assertRaisesRegex(AssertionError, 'Private runtime'): self.validate()

    def test_traversal_rejected(self):
        self.fixture(extra='../outside')
        with self.assertRaisesRegex(AssertionError, 'Unsafe archive'): self.validate()

    def test_corrupt_file_rejected(self):
        self.fixture(corrupt=True)
        with self.assertRaisesRegex(AssertionError, 'File size|integrity'): self.validate()

    def test_wrong_version_rejected(self):
        self.fixture()
        with self.assertRaisesRegex(AssertionError, 'target/version'): self.validate('0.2.0')

    def test_nonexecutable_installer_rejected(self):
        self.fixture(executable=False)
        with self.assertRaisesRegex(AssertionError, 'not executable'): self.validate()

    def test_source_difference_rejected(self):
        self.fixture(); (self.root / 'src/server.js').write_bytes(b'different source')
        with self.assertRaisesRegex(AssertionError, 'source differs'): self.validate()

if __name__ == '__main__': unittest.main()
