"""验证配置隔离、链接边界及依赖归档可复用性。"""
import importlib.util
import os
import pathlib
import tarfile
import tempfile
import unittest

MODULE = pathlib.Path(__file__).with_name('deploy.py')
SPEC = importlib.util.spec_from_file_location('ntfs_deploy', MODULE)
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


def directory_link(source, target):
    """Windows junction 不要求管理员权限，覆盖实际 pnpm 链接形式。"""
    if os.name == 'nt':
        import _winapi
        _winapi.CreateJunction(str(source), str(target))
    else:
        target.symlink_to(source, target_is_directory=True)


class DeploymentSafetyTest(unittest.TestCase):
    def test_archive_is_stable_when_only_file_times_change(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            context = base / 'context'
            context.mkdir()
            file = context / 'index.js'
            file.write_text('export const value = 1;', encoding='utf-8')
            DEPLOY.pack_context(context, base / 'first.tar')
            os.utime(file, (1900000000, 1900000000))
            DEPLOY.pack_context(context, base / 'second.tar')
            self.assertEqual((base / 'first.tar').read_bytes(), (base / 'second.tar').read_bytes())

    def test_private_files_are_excluded_and_internal_links_are_relative(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            context = base / 'context'
            package = context / 'api/node_modules/package'
            package.mkdir(parents=True)
            (package / 'index.js').write_text('export const value = 1;', encoding='utf-8')
            (context / '.env.production.local').write_text('PRIVATE_VALUE', encoding='utf-8')
            (package / 'key.pem').write_text('PRIVATE_VALUE', encoding='utf-8')
            directory_link(package, package.parent / 'alias')
            archive = base / 'context.tar'
            DEPLOY.pack_context(context, archive)
            with tarfile.open(archive) as result:
                names = result.getnames()
                self.assertNotIn('.env.production.local', names)
                self.assertNotIn('api/node_modules/package/key.pem', names)
                link = result.getmember('api/node_modules/alias')
                self.assertTrue(link.issym())
                self.assertEqual(link.linkname, 'package')
            self.assertNotIn(b'PRIVATE_VALUE', archive.read_bytes())

    def test_external_directory_link_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            context = base / 'context'
            outside = base / 'outside'
            context.mkdir()
            outside.mkdir()
            directory_link(outside, context / 'escape')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                DEPLOY.pack_context(context, base / 'context.tar')

    def test_empty_template_cannot_be_deployed(self):
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            DEPLOY.configuration(DEPLOY.ROOT / 'deploy/production.env.example')

    def test_remote_config_uses_linux_newlines_without_ssh_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            DEPLOY.write_configs(root, {'DB_HOST': 'db.invalid', 'DB_PORT': '3306', 'DB_USERNAME': 'example',
                                       'DB_PASSWORD': 'test-only', 'NODE_ENV': 'production', 'DEPLOY_PASSWORD': 'ssh-test-only'})
            for name in ['production.env', 'mysql.cnf']:
                data = (root / name).read_bytes()
                self.assertNotIn(b'\r', data)
                self.assertNotIn(b'ssh-test-only', data)


if __name__ == '__main__':
    unittest.main()
